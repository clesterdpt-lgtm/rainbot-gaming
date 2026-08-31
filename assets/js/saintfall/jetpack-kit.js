/* ============================================================
   SAINTFALL - jetpack construction kit

   Shared vocabulary for the reliquary packs. Every playable figure
   wears a different one and they must not be three unrelated piles of
   boxes: the family read comes from all of them being built out of
   the same primitives - chamfered enclosures rather than cubes, lathed
   bells rather than cylinders, merged detail so a rivet is not a draw
   call - and from every one of them driving the SAME plume program.

   Nothing here knows about flight state. `jetpack.js` owns the
   articulation loop and `jetpacks.js` owns the three designs; this
   file only knows how to make the parts.
   ============================================================ */

import { patchMaterial } from "saintfall/art.js";
import { flareTexture } from "saintfall/weapons.js";

/* ------------------------------------------------------------
   MATERIALS
   ------------------------------------------------------------ */

export function makeMaterial(ctx, name, color, roughness, metalness, emissive = 0) {
  const { THREE } = ctx;
  const mat = new THREE.MeshStandardMaterial({
    name,
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity: emissive ? 1 : 0,
    flatShading: true,
  });
  patchMaterial(mat, ctx.atmos, { rim: emissive ? 0.35 : 0.9, glitter: 0 });
  return mat;
}

/** Glazed plate: the ceramic every reliquary shares, tinted per pack. */
export function makeCeramicMaterial(ctx, name = "jetpack-ceramic", color = 0xd9c9a6, opts = {}) {
  const { THREE } = ctx;
  const mat = new THREE.MeshPhysicalMaterial({
    name,
    color,
    roughness: opts.roughness ?? 0.24,
    metalness: opts.metalness ?? 0.18,
    clearcoat: opts.clearcoat ?? 0.72,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.20,
    flatShading: true,
  });
  patchMaterial(mat, ctx.atmos, { rim: opts.rim ?? 1.15, glitter: 0 });
  return mat;
}

/** The additive sheet a wing veil or a heat bloom is drawn on. */
export function makeEnergyMaterial(ctx, name, color, opacity = 0.28) {
  const { THREE } = ctx;
  return new THREE.MeshBasicMaterial({
    name,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
}

/* ------------------------------------------------------------
   GEOMETRY
   ------------------------------------------------------------ */

/**
 * A compact aerospace enclosure: broad planar faces for the sacred
 * hardware read, clipped corners so it never falls back to a plain
 * debug box, and a shallow bevel that catches the key light.
 */
export function chamferedRectGeometry(THREE, width, height, depth, corner = 0.035) {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const c = Math.min(corner, hw * 0.45, hh * 0.45);
  const shape = new THREE.Shape([
    new THREE.Vector2(-hw + c, hh),
    new THREE.Vector2(hw - c, hh),
    new THREE.Vector2(hw, hh - c),
    new THREE.Vector2(hw, -hh + c),
    new THREE.Vector2(hw - c, -hh),
    new THREE.Vector2(-hw + c, -hh),
    new THREE.Vector2(-hw, -hh + c),
    new THREE.Vector2(-hw, hh - c),
  ]);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: Math.min(0.008, c * 0.28),
    bevelThickness: Math.min(0.006, depth * 0.14),
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth * 0.5);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A faceted, tapered mechanical feather authored around its hinge.
 * Separate mirrored contours preserve front-face winding on both
 * wings without relying on a negative object scale.
 */
export function wingPlateGeometry(THREE, side, length, width, drop, depth = 0.026) {
  const x = (n) => side * n;
  const points = [
    new THREE.Vector2(0, width * 0.42),
    new THREE.Vector2(x(length * 0.20), width * 0.62),
    new THREE.Vector2(x(length * 0.63), width * 0.24 - drop * 0.28),
    new THREE.Vector2(x(length), -drop),
    new THREE.Vector2(x(length * 0.90), -drop - width * 0.22),
    new THREE.Vector2(x(length * 0.54), -drop * 0.62 - width * 0.48),
    new THREE.Vector2(x(length * 0.15), -width * 0.54),
    new THREE.Vector2(0, -width * 0.32),
  ];
  const shape = new THREE.Shape(points);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.008,
    bevelThickness: 0.006,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth * 0.5);
  geometry.computeVertexNormals();
  return geometry;
}

export function wingVeinGeometry(THREE, side, length, drop) {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(side * length * 0.10, 0, -0.025),
    new THREE.Vector3(side * length * 0.53, 0.015 - drop * 0.30, -0.025),
    new THREE.Vector3(side * length * 0.86, -drop * 0.76, -0.025)
  );
  return new THREE.TubeGeometry(curve, 7, 0.006, 5, false);
}

export function shieldGeometry(THREE) {
  const shape = new THREE.Shape([
    new THREE.Vector2(0, 0.20),
    new THREE.Vector2(0.12, 0.10),
    new THREE.Vector2(0.095, -0.14),
    new THREE.Vector2(0, -0.23),
    new THREE.Vector2(-0.095, -0.14),
    new THREE.Vector2(-0.12, 0.10),
  ]);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.055,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.012,
    bevelThickness: 0.009,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -0.0275);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A SWEPT SURVEY VANE. The scout's answer to a feather: a thin blade
 * with a straight leading edge, a raked tip and a hollow trailing
 * notch, authored around its hinge at the origin like every other
 * articulated plate here so the same fold table drives it.
 */
export function vaneGeometry(THREE, side, length, rootWidth, tipWidth, sweep, depth = 0.016) {
  const x = (n) => side * n;
  const shape = new THREE.Shape([
    new THREE.Vector2(0, rootWidth * 0.50),
    new THREE.Vector2(x(length * 0.72), rootWidth * 0.34 - sweep * 0.55),
    new THREE.Vector2(x(length), -sweep - tipWidth * 0.18),
    new THREE.Vector2(x(length * 0.96), -sweep - tipWidth * 0.92),
    new THREE.Vector2(x(length * 0.58), -sweep * 0.52 - rootWidth * 0.60),
    new THREE.Vector2(x(length * 0.30), -rootWidth * 0.34),
    new THREE.Vector2(x(length * 0.16), -rootWidth * 0.62),
    new THREE.Vector2(0, -rootWidth * 0.46),
  ]);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.005,
    bevelThickness: 0.004,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth * 0.5);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A HEAT-SHIELD LOUVRE. A thick slat raked to a CHISEL POINT - the
 * opposite read to a feather or a vane on purpose: this is armour
 * being held open to dump heat, not a wing.
 *
 * The first version ended in a wide flat nose running from +0.28 to
 * -0.30 of the width, chamfered back at 84% of the length and then
 * softened again by a two-segment bevel on every edge. Three
 * roundings on one end: the bank fanned open into eight butter
 * knives. A bulwark's plate should end the way the rest of this
 * figure ends - in an angle you could cut yourself on - so the tip is
 * now two raked facets converging just below the centreline, and the
 * bevel is a single hard chamfer rather than a curve.
 */
export function louvreGeometry(THREE, side, length, width, thickness = 0.030) {
  const x = (n) => side * n;
  const shape = new THREE.Shape([
    new THREE.Vector2(0, width * 0.50),
    new THREE.Vector2(x(length * 0.70), width * 0.44),
    new THREE.Vector2(x(length * 0.92), width * 0.15),
    new THREE.Vector2(x(length), -width * 0.02),
    new THREE.Vector2(x(length * 0.90), -width * 0.26),
    new THREE.Vector2(x(length * 0.68), -width * 0.47),
    new THREE.Vector2(0, -width * 0.52),
  ]);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.005,
    bevelThickness: 0.005,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -thickness * 0.5);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The brass SHOE over a louvre's point. Follows the same two rakes so
 * it caps the chisel instead of sitting across it - the flat bar that
 * used to live here was 86% of the plate's width laid over the tip,
 * which blunted the silhouette all by itself even before the bevels
 * got to it.
 */
export function louvreCapGeometry(THREE, side, length, width, thickness = 0.036) {
  const x = (n) => side * n;
  const shape = new THREE.Shape([
    new THREE.Vector2(x(length * 0.845), width * 0.26),
    new THREE.Vector2(x(length * 0.925), width * 0.145),
    new THREE.Vector2(x(length * 1.005), -width * 0.02),
    new THREE.Vector2(x(length * 0.905), -width * 0.265),
    new THREE.Vector2(x(length * 0.820), -width * 0.170),
  ]);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.004,
    bevelThickness: 0.004,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -thickness * 0.5);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A lathed solid from a half-profile in the XY plane, x being radius.
 * Flat-shaded on purpose: every hard surface in this game is faceted,
 * and a smooth-shaded drum beside a faceted pauldron reads as a
 * different game's asset.
 */
export function latheProfile(THREE, points, segments = 12) {
  const geometry = new THREE.LatheGeometry(
    points.map((p) => new THREE.Vector2(p[0], p[1])), segments
  );
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  flat.computeBoundingBox();
  flat.computeBoundingSphere();
  return flat;
}

/**
 * One broad, open rectangular exhaust sheet. Four tapered walls keep
 * the plume readable from rear, profile and low angles without the
 * tubular-rocket silhouette a cone pair produces.
 */
export function rectangularPlumeGeometry(THREE, width, depth, length, taper = 0.42) {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const tw = hw * taper;
  const td = hd * taper;
  const positions = new Float32Array([
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
    -tw, -length, -td, tw, -length, -td,
    tw, -length, td, -tw, -length, td,
  ]);
  const indices = [
    0, 4, 1, 1, 4, 5,
    1, 5, 2, 2, 5, 6,
    2, 6, 3, 3, 6, 7,
    3, 7, 0, 0, 7, 4,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A RING OF RIVETS as one geometry. Rivets are what separates plate
 * from a painted box, and there are dozens of them; at one mesh each
 * they would cost more draw calls than the rest of the pack together.
 */
export function rivetRing(THREE, radius, count, size, y = 0, z = 0, axis = "y") {
  const parts = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    const head = new THREE.OctahedronGeometry(size, 0);
    head.scale(1, 0.62, 1);
    if (axis === "z") head.translate(Math.cos(a) * radius, Math.sin(a) * radius + y, z);
    else head.translate(Math.cos(a) * radius, y, Math.sin(a) * radius + z);
    parts.push(head);
  }
  return mergeGeometryList(THREE, parts);
}

/**
 * These pieces share a solid-colour material, so UVs and groups are
 * unnecessary. Collapsing them keeps every plate articulated while
 * avoiding a draw call for each tiny quill, light and inset.
 */
export function mergeGeometryList(THREE, geometries) {
  const list = geometries.map((geometry) => {
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    return geometry.index ? geometry.toNonIndexed() : geometry;
  });
  const vertexCount = list.reduce(
    (sum, geometry) => sum + geometry.getAttribute("position").count,
    0
  );
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  let cursor = 0;
  for (const geometry of list) {
    const p = geometry.getAttribute("position");
    const n = geometry.getAttribute("normal");
    positions.set(p.array, cursor * 3);
    normals.set(n.array, cursor * 3);
    cursor += p.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

export function mesh(THREE, geometry, material, name, parent, position, rotation = null) {
  const out = new THREE.Mesh(geometry, material);
  out.name = name;
  out.position.set(position[0], position[1], position[2]);
  if (rotation) out.rotation.set(rotation[0], rotation[1], rotation[2]);
  out.castShadow = !material.transparent && !(material.emissive?.getHex?.() > 0);
  out.receiveShadow = !material.transparent;
  parent.add(out);
  return out;
}

/* ------------------------------------------------------------
   THE PLUME

   THE PLUME IS A SHADER, NOT A TINTED BOX. Two translucent boxes at
   fixed opacity read as exactly that - a pair of orange lampshades
   hanging off the pack. A rocket plume is read from three things the
   boxes could not do: a white-hot throat that goes gold and then
   transparent down its length, a fast turbulence running away from
   the nozzle, and the bright ladder of shock diamonds just outside
   the throat. Both sheets share one program; the inner one is hotter
   and carries the diamonds.

   Every pack in the game shares this program - the cache key is a
   constant, not derived from the palette - so three designs with
   three different flame colours still compile it once.
   ------------------------------------------------------------ */

const FLAME_VERT = /* glsl */`
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLAME_FRAG = /* glsl */`
  uniform vec3 uHot;
  uniform vec3 uCold;
  uniform float uTime;
  uniform float uThrottle;
  uniform float uLength;
  uniform vec2 uHalf;
  uniform float uTaper;
  uniform float uGain;
  uniform float uInner;
  varying vec3 vLocal;
  void main() {
    float t = clamp(-vLocal.y / uLength, 0.0, 1.0);
    float w = mix(1.0, uTaper, t);
    // Across each wall: 0 at the wall's middle, 1 at the corner, so
    // the box reads as a rounded column of gas.
    float sx = abs(vLocal.x) / max(0.001, uHalf.x * w);
    float sz = abs(vLocal.z) / max(0.001, uHalf.y * w);
    float across = 1.0 - pow(clamp(min(sx, sz), 0.0, 1.0), 2.0);
    // Turbulence running away from the throat, two rates.
    float turb = 0.72 + 0.28 * sin(t * 38.0 - uTime * 58.0 + sin(t * 9.0 + uTime * 13.0));
    float turb2 = 0.85 + 0.15 * sin(t * 71.0 - uTime * 97.0);
    float throat = exp(-t * t * 9.0);
    float tail = pow(1.0 - t, 1.6);
    float diamonds = pow(sin(t * 26.0 - uTime * 3.0) * 0.5 + 0.5, 7.0) * exp(-t * 5.0) * uInner;
    float ends = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.85, 1.0, t));
    float lum = (tail * (0.28 + across * 0.9) * turb * turb2 + throat * 0.9 + diamonds * 1.2)
      * ends * (0.35 + uThrottle * 0.65) * uGain;
    vec3 c = mix(uCold, uHot, clamp(throat * 1.2 + diamonds + across * 0.25 * (1.0 - t), 0.0, 1.0));
    gl_FragColor = vec4(c * lum, 1.0);
  }
`;

/**
 * `spec` is {width, depth, length, taper, gain} for each sheet plus
 * the two colours. Defaults reproduce the Seraph's original numbers
 * exactly, so a pack that only wants a different colour says only
 * that.
 */
export function plumeMaterials(ctx, spec = {}) {
  const { THREE } = ctx;
  const hotOuter = spec.hotOuter ?? 0xffe7b0;
  const coldOuter = spec.coldOuter ?? 0xff8a2a;
  const hotInner = spec.hotInner ?? 0xfff8ea;
  const coldInner = spec.coldInner ?? 0xffb545;
  const outer = spec.outer ?? { width: 0.142, depth: 0.068, length: 0.44, taper: 0.38, gain: 0.85 };
  const inner = spec.inner ?? { width: 0.074, depth: 0.036, length: 0.29, taper: 0.30, gain: 1.35 };
  const build = (isInner, sheet, hot, cold) => {
    const mat = new THREE.ShaderMaterial({
      name: isInner ? "jetpack-flame-inner" : "jetpack-flame-outer",
      uniforms: {
        uHot: { value: new THREE.Color(hot) },
        uCold: { value: new THREE.Color(cold) },
        uTime: { value: 0 },
        uThrottle: { value: 0 },
        uLength: { value: sheet.length },
        uHalf: { value: new THREE.Vector2(sheet.width * 0.5, sheet.depth * 0.5) },
        uTaper: { value: sheet.taper },
        uGain: { value: sheet.gain },
        uInner: { value: isInner ? 1 : 0 },
      },
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      toneMapped: true,
    });
    mat.customProgramCacheKey = () => "sf-jet-flame";
    return mat;
  };
  return {
    outer: build(false, outer, hotOuter, coldOuter),
    inner: build(true, inner, hotInner, coldInner),
    outerSpec: outer,
    innerSpec: inner,
  };
}

export function flareMaterial(ctx, color = 0xffd08a) {
  const { THREE } = ctx;
  return new THREE.MeshBasicMaterial({
    name: "jetpack-throat-flare",
    color,
    map: flareTexture(THREE),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

/**
 * A THRUST APERTURE: the locator the exhaust is spawned from, the two
 * plume sheets, and the throat glare.
 *
 * The glare is three crossed flare cards rather than one, because the
 * plume sheet is a sliver seen end on and end on is exactly how the
 * chase camera sees it. A pack needs a hot point that blooms from any
 * bearing.
 *
 * Returns the record `jetpack.js` expects in `visual.flames[]`, and
 * pushes its locator into `nozzles`.
 */
export function buildThruster(ctx, opts) {
  const { THREE } = ctx;
  const {
    parent, name, position, rotation = null, plume, flareSize = 0.30,
    flareMat, scale = 1, flareGain = 1,
  } = opts;
  const locator = new THREE.Object3D();
  locator.name = name;
  locator.position.set(position[0], position[1], position[2]);
  if (rotation) locator.rotation.set(rotation[0], rotation[1], rotation[2]);
  parent.add(locator);

  const outer = mesh(
    THREE,
    rectangularPlumeGeometry(
      THREE,
      plume.outerSpec.width, plume.outerSpec.depth,
      plume.outerSpec.length, plume.outerSpec.taper
    ),
    plume.outer, `${name}-flame-outer`, locator, [0, -0.006, 0]
  );
  const inner = mesh(
    THREE,
    rectangularPlumeGeometry(
      THREE,
      plume.innerSpec.width, plume.innerSpec.depth,
      plume.innerSpec.length, plume.innerSpec.taper
    ),
    plume.inner, `${name}-flame-inner`, locator, [0, -0.004, 0]
  );
  outer.castShadow = false;
  inner.castShadow = false;
  outer.visible = false;
  inner.visible = false;
  if (scale !== 1) {
    outer.scale.setScalar(scale);
    inner.scale.setScalar(scale);
  }

  const flareRig = new THREE.Group();
  flareRig.name = `${name}-throat-flare`;
  const flareGeo = new THREE.PlaneGeometry(flareSize, flareSize);
  for (let i = 0; i < 3; i += 1) {
    const quad = new THREE.Mesh(flareGeo, flareMat);
    quad.rotation.set(Math.PI * 0.5, 0, (i / 3) * Math.PI);
    quad.renderOrder = 890;
    flareRig.add(quad);
  }
  flareRig.position.set(0, -0.05, 0);
  flareRig.visible = false;
  locator.add(flareRig);

  /* `flareGain` scales the throat glare per pack, and a twin-engine
     design needs it: two apertures at the single-engine's opacity is
     twice the bloom on screen for the same thrust, and on a small pod
     the card is also proportionally larger than the engine it is
     supposed to be coming out of. */
  return {
    locator,
    flame: { outer, inner, flare: flareRig, flareMat, baseScale: scale, flareGain },
  };
}

/**
 * Seat a finished pack on the figure.
 *
 * Author in figure-root METRE space, then preserve that transform
 * while reparenting to the imported Spine. Direct bone-local metre
 * values are wrong because the GLB armature is centimetre-scaled, and
 * every pack in this game has been authored against the root.
 */
export function mountPack(figure, root, position) {
  root.position.set(position[0], position[1], position[2]);
  figure.root.add(root);
  figure.root.updateMatrixWorld(true);
  if (figure.chest) figure.chest.attach(root);
  figure.root.updateMatrixWorld(true);
  /* The chest is animated after the pack is built. Keep the exact
     post-attach local transform so player.js can begin every frame
     from the authored seat before applying its carry-yaw stabiliser;
     otherwise that small correction would accumulate indefinitely. */
  root.userData.mountBindPosition = root.position.toArray();
  root.userData.mountBindQuaternion = root.quaternion.toArray();
  return root;
}
