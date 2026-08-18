/* ============================================================
   SAINTFALL - Reliquary vector jetpack

   A finite traversal tool, not free flight. The player controller
   owns movement and collision; this module owns charge, state,
   presentation and the small public contract used by the HUD/QA.
   ============================================================ */

import { clamp, clamp01, damp, lerp } from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { flareTexture } from "saintfall/weapons.js";

export const JETPACK_CONFIG = Object.freeze({
  maxFuel: 100,
  ignitionCost: 5,
  minIgnitionFuel: 10,
  /* 16 -> 10.7, which is 50% MORE GROUND per tank rather than 50%
     more speed. The two are not the same request and only one of
     them is what a traversal tool is for: raising `cruiseSpeed`
     would cover more distance per second and still strand the
     player in the same place, because the tank is what runs out.
     Burning slower makes the same 95 usable units last 8.9s instead
     of 5.93, and the gauge still reads 0-100 so nothing in the HUD
     or the recharge maths has to know. */
  burnRate: 10.7,
  rechargeDelay: 2.5,
  depletedDelay: 4.0,
  rechargeRate: 10,
  cruiseSpeed: 30,
  glideSpeed: 13,
  acceleration: 20,
  glideDrag: 5.5,
  cruiseAltitude: 7.0,
  softAltitude: 8.0,
  maxAltitude: 10.0,
  maxRiseFromLaunch: 12.0,
  climbSpeed: 9.0,
  descendSpeed: 11.0,
  gravity: 14.0,
  terminalFall: 20.0,
  sweepStep: 0.20,
});

function makeMaterial(ctx, name, color, roughness, metalness, emissive = 0) {
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

function makeCeramicMaterial(ctx) {
  const { THREE } = ctx;
  const mat = new THREE.MeshPhysicalMaterial({
    name: "jetpack-seraph-ceramic",
    color: 0xd9c9a6,
    roughness: 0.24,
    metalness: 0.18,
    clearcoat: 0.72,
    clearcoatRoughness: 0.20,
    flatShading: true,
  });
  patchMaterial(mat, ctx.atmos, { rim: 1.15, glitter: 0 });
  return mat;
}

function wingPlateGeometry(THREE, side, length, width, drop, depth = 0.026) {
  /* A faceted, tapered mechanical feather authored around its hinge.
     Separate mirrored contours preserve front-face winding on both
     wings without relying on a negative object scale. */
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

function wingVeinGeometry(THREE, side, length, drop) {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(side * length * 0.10, 0, -0.025),
    new THREE.Vector3(side * length * 0.53, 0.015 - drop * 0.30, -0.025),
    new THREE.Vector3(side * length * 0.86, -drop * 0.76, -0.025)
  );
  return new THREE.TubeGeometry(curve, 7, 0.006, 5, false);
}

function shieldGeometry(THREE) {
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

function chamferedRectGeometry(THREE, width, height, depth, corner = 0.035) {
  /* A compact aerospace enclosure: broad planar faces for the sacred
     hardware read, clipped corners so it never falls back to a plain
     debug box, and a shallow bevel that catches the desert key light. */
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

function rectangularPlumeGeometry(THREE, width, depth, length, taper = 0.42) {
  /* One broad, open rectangular exhaust sheet. Four tapered walls keep
     the plume readable from rear, profile and low angles without the
     tubular-rocket silhouette the former cone pair produced. */
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const tw = hw * taper;
  const td = hd * taper;
  const positions = new Float32Array([
    -hw, 0, -hd,   hw, 0, -hd,   hw, 0, hd,   -hw, 0, hd,
    -tw, -length, -td,   tw, -length, -td,
    tw, -length, td,   -tw, -length, td,
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

function mergeGeometryList(THREE, geometries) {
  /* These pieces share a solid-colour material, so UVs and groups are
     unnecessary. Collapsing them here keeps every feather articulated
     while avoiding a draw call for each tiny quill, light and inset. */
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

function mesh(THREE, geometry, material, name, parent, position, rotation = null) {
  const out = new THREE.Mesh(geometry, material);
  out.name = name;
  out.position.set(position[0], position[1], position[2]);
  if (rotation) out.rotation.set(rotation[0], rotation[1], rotation[2]);
  out.castShadow = !material.transparent && !(material.emissive?.getHex?.() > 0);
  out.receiveShadow = !material.transparent;
  parent.add(out);
  return out;
}

function buildPack(ctx, player) {
  const { THREE } = ctx;
  const figure = player.figure;
  const root = new THREE.Group();
  root.name = "jetpack-root";
  root.userData.equipment = "jetpack";

  const iron = makeMaterial(ctx, "jetpack-seraph-iron", 0x17130e, 0.30, 0.86);
  const ivory = makeCeramicMaterial(ctx);
  const bronze = makeMaterial(ctx, "jetpack-seraph-alloy", 0xb18435, 0.24, 0.82);
  const amber = makeMaterial(ctx, "jetpack-seraph-ion", 0xffcf67, 0.15, 0.18, 0xb76b18);
  const chargeMaterial = amber.clone();
  chargeMaterial.name = "jetpack-seraph-charge";
  const energy = new THREE.MeshBasicMaterial({
    name: "jetpack-seraph-energy",
    color: 0xffbd4a,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: true,
  });

  /* A narrow load-bearing gold spine is the only fixed solid between
     the hinges. A broad static box occupies the feather sweep and the
     landing-compressed torso no matter how carefully it is beveled;
     breadth instead comes from the articulated gold root fairings.
     This keeps the engine visibly close without hiding intersections. */
  mesh(THREE, chamferedRectGeometry(THREE, 0.080, 0.300, 0.045, 0.018), bronze,
    "jetpack-central-thruster-housing", root, [0, -0.005, -0.080]);
  const shieldInset = new THREE.Mesh(shieldGeometry(THREE), iron);
  shieldInset.name = "jetpack-reliquary-inset";
  shieldInset.position.set(0, 0.005, -0.082);
  shieldInset.scale.set(0.73, 0.74, 0.20);
  shieldInset.castShadow = false;
  root.add(shieldInset);

  mesh(THREE, new THREE.BoxGeometry(0.31, 0.038, 0.075), bronze,
    "jetpack-upper-yoke", root, [0, 0.145, -0.005]);
  const halo = mesh(THREE, new THREE.TorusGeometry(0.148, 0.009, 5, 28), bronze,
    "jetpack-seraph-halo", root, [0, 0.045, -0.095]);
  const haloLight = mesh(THREE, new THREE.TorusGeometry(0.132, 0.004, 4, 24), amber,
    "jetpack-seraph-halo-light", root, [0, 0.045, -0.105]);
  halo.castShadow = false;
  haloLight.castShadow = false;
  mesh(THREE, new THREE.BoxGeometry(0.018, 0.255, 0.014), amber,
    "jetpack-core-rail-l", root, [-0.039, -0.01, -0.088]);
  mesh(THREE, new THREE.BoxGeometry(0.018, 0.255, 0.014), amber,
    "jetpack-core-rail-r", root, [0.039, -0.01, -0.088]);
  const chargeWindow = mesh(THREE, new THREE.OctahedronGeometry(0.060, 1), chargeMaterial,
    "jetpack-charge-window", root, [0, -0.012, -0.115]);
  chargeWindow.scale.set(0.70, 1.28, 0.40);

  const wings = [];
  const featherLengths = [0.70, 0.67, 0.62, 0.56, 0.50];
  const featherWidths = [0.145, 0.140, 0.132, 0.122, 0.110];
  const featherDrops = [0.015, 0.035, 0.065, 0.095, 0.125];
  const foldedAngles = [-75, -79, -83, -87, -91];
  const poweredAngles = [32, 16, 0, -18, -24];
  /* The lowest glide feather stays slightly higher than its powered
     counterpart. Besides sharpening the trailing silhouette, this
     keeps the drawn lance clear through the full low-throttle flutter
     cycle instead of grazing the left tip plate. */
  const glideAngles = [12, 2, -8, -20, -18];

  for (let i = 0; i < 2; i += 1) {
    const side = i === 0 ? -1 : 1;
    const wing = new THREE.Group();
    wing.name = side < 0 ? "jetpack-wing-l" : "jetpack-wing-r";
    /* Hinges pulled forward from z -0.075. The saddle that used to
       bridge this gap is gone: the fix is the wings actually being
       closer, not a plate filling the space where they were not. */
    wing.position.set(side * 0.135, 0.105, -0.042);
    wing.rotation.y = side * 0.46;
    root.add(wing);

    const rootFairing = new THREE.Mesh(
      wingPlateGeometry(THREE, side, 0.255, 0.135, 0.015, 0.035), bronze
    );
    rootFairing.name = `${wing.name}-root-fairing`;
    rootFairing.position.z = -0.050;
    rootFairing.castShadow = true;
    rootFairing.receiveShadow = true;
    wing.add(rootFairing);

    const hinge = mesh(THREE, new THREE.TorusGeometry(0.050, 0.012, 5, 12), bronze,
      `${wing.name}-hinge`, wing, [0, 0, -0.038]);
    const hingeLight = mesh(THREE, new THREE.TorusGeometry(0.031, 0.005, 4, 12), amber,
      `${wing.name}-hinge-light`, wing, [0, 0, -0.052]);
    hinge.castShadow = false;
    hingeLight.castShadow = false;
    const feathers = [];

    for (let f = 0; f < featherLengths.length; f += 1) {
      const feather = new THREE.Group();
      feather.name = `${wing.name}-feather-${f}`;
      feather.position.set(side * (0.014 + f * 0.008), 0.055 - f * 0.030, -0.012 - f * 0.004);
      wing.add(feather);

      const plate = new THREE.Mesh(
        wingPlateGeometry(THREE, side, featherLengths[f], featherWidths[f], featherDrops[f]),
        ivory
      );
      plate.name = `${feather.name}-ceramic-blade`;
      plate.castShadow = true;
      plate.receiveShadow = true;
      feather.add(plate);

      const insetGeometry = wingPlateGeometry(
        THREE,
        side,
        featherLengths[f] * 0.72,
        featherWidths[f] * 0.48,
        featherDrops[f] * 0.58,
        0.008
      );
      insetGeometry.translate(0, 0, -0.018);
      const frontInsetGeometry = wingPlateGeometry(
        THREE,
        side,
        featherLengths[f] * 0.72,
        featherWidths[f] * 0.48,
        featherDrops[f] * 0.58,
        0.008
      );
      frontInsetGeometry.translate(0, 0, 0.018);
      const quillGeometry = new THREE.CylinderGeometry(
        0.012, 0.018, featherLengths[f] * 0.30, 6, 1
      );
      quillGeometry.rotateZ(-side * Math.PI / 2);
      quillGeometry.translate(
        side * featherLengths[f] * 0.15,
        -featherDrops[f] * 0.10,
        -0.006
      );
      const mechanism = new THREE.Mesh(
        mergeGeometryList(THREE, [insetGeometry, frontInsetGeometry, quillGeometry]), iron
      );
      mechanism.name = `${feather.name}-recessed-mechanism`;
      mechanism.castShadow = false;
      feather.add(mechanism);

      const veinGeometry = wingVeinGeometry(
        THREE, side, featherLengths[f], featherDrops[f]
      );
      const frontVeinGeometry = wingVeinGeometry(
        THREE, side, featherLengths[f], featherDrops[f]
      );
      frontVeinGeometry.translate(0, 0, 0.050);
      const tipGeometry = new THREE.OctahedronGeometry(0.015, 0);
      tipGeometry.scale(1.45, 0.62, 0.40);
      tipGeometry.translate(
        side * featherLengths[f] * 0.86,
        -featherDrops[f] * 0.74,
        -0.029
      );
      const frontTipGeometry = new THREE.OctahedronGeometry(0.015, 0);
      frontTipGeometry.scale(1.45, 0.62, 0.40);
      frontTipGeometry.translate(
        side * featherLengths[f] * 0.86,
        -featherDrops[f] * 0.74,
        0.029
      );
      const ionDetails = new THREE.Mesh(
        mergeGeometryList(
          THREE,
          [veinGeometry, frontVeinGeometry, tipGeometry, frontTipGeometry]
        ),
        amber
      );
      ionDetails.name = `${feather.name}-ion-details`;
      ionDetails.castShadow = false;
      feather.add(ionDetails);

      feather.userData.foldAngle = side * foldedAngles[f] * Math.PI / 180;
      feather.userData.poweredAngle = side * poweredAngles[f] * Math.PI / 180;
      feather.userData.glideAngle = side * glideAngles[f] * Math.PI / 180;
      feather.userData.phase = f * 0.63 + (side < 0 ? 0.35 : 0);
      feather.rotation.z = feather.userData.foldAngle;
      feathers.push(feather);
    }

    /* A restrained ion veil supports the wing read without replacing
       the modeled feather silhouette with transparent glow. */
    const veilShape = new THREE.Shape([
      new THREE.Vector2(0, 0.035),
      new THREE.Vector2(side * 0.50, 0.20),
      new THREE.Vector2(side * 0.44, -0.18),
      new THREE.Vector2(side * 0.08, -0.20),
    ]);
    const veil = new THREE.Mesh(new THREE.ShapeGeometry(veilShape), energy);
    veil.name = `${wing.name}-ion-veil`;
    veil.position.z = -0.038;
    veil.scale.set(0.10, 0.35, 1);
    veil.renderOrder = 2;
    wing.add(veil);

    wings.push({
      side,
      root: wing,
      feathers,
      hinge,
      hingeLight,
      veil,
      wallTuck: 0,
      visualSpread: 0,
      deployCant: 0,
      plumeThrottle: 0,
    });
  }

  const nozzles = [];
  const flames = [];
  /* THE PLUME IS A SHADER, NOT A TINTED BOX.
     Two translucent boxes at fixed opacity read as exactly that - a
     pair of orange lampshades hanging off the pack. A rocket plume is
     read from three things the boxes could not do: a white-hot throat
     that goes gold and then transparent down its length, a fast
     turbulence running away from the nozzle, and the bright ladder of
     shock diamonds just outside the throat. Both sheets share one
     program; the inner one is hotter and carries the diamonds. */
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
  const flameMat = (inner) => {
    const mat = new THREE.ShaderMaterial({
      name: inner ? "jetpack-flame-inner" : "jetpack-flame-outer",
      uniforms: {
        uHot: { value: new THREE.Color(inner ? 0xfff8ea : 0xffe7b0) },
        uCold: { value: new THREE.Color(inner ? 0xffb545 : 0xff8a2a) },
        uTime: { value: 0 },
        uThrottle: { value: 0 },
        uLength: { value: inner ? 0.29 : 0.44 },
        uHalf: { value: new THREE.Vector2(inner ? 0.037 : 0.071, inner ? 0.018 : 0.034) },
        uTaper: { value: inner ? 0.30 : 0.38 },
        uGain: { value: inner ? 1.35 : 0.85 },
        uInner: { value: inner ? 1 : 0 },
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
  const outerFlameMat = flameMat(false);
  const innerFlameMat = flameMat(true);

  /* ONE CENTRAL VECTOR CELL.

     The old pair sat almost thirty centimetres behind the armour and
     created the visible backpack void in profile. The fixed gold spine
     above is the housing; this group supplies its dark rear recess,
     reactor vanes and single rectangular thrust aperture. */
  const centralThruster = new THREE.Group();
  centralThruster.name = "jetpack-central-thruster";
  centralThruster.position.set(0, 0, 0);
  root.add(centralThruster);
  mesh(
    THREE,
    chamferedRectGeometry(THREE, 0.162, 0.215, 0.012, 0.022),
    iron,
    "jetpack-central-thruster-recess",
    centralThruster,
    [0, -0.005, -0.108]
  );
  const reactorBars = [];
  for (let i = -1; i <= 1; i += 1) {
    const bar = new THREE.BoxGeometry(0.018, i === 0 ? 0.154 : 0.126, 0.012);
    bar.translate(i * 0.050, i === 0 ? 0.004 : -0.010, 0);
    reactorBars.push(bar);
  }
  mesh(
    THREE,
    mergeGeometryList(THREE, reactorBars),
    amber,
    "jetpack-central-thruster-reactor-grid",
    centralThruster,
    [0, -0.005, -0.118]
  );
  mesh(
    THREE,
    new THREE.BoxGeometry(0.100, 0.018, 0.090),
    iron,
    "jetpack-central-thruster-aperture",
    centralThruster,
    [0, -0.245, -0.095]
  );

  const locator = new THREE.Object3D();
  locator.name = "jetpack-nozzle-center";
  locator.position.set(0, -0.258, -0.095);
  centralThruster.add(locator);
  nozzles.push(locator);

  const outer = mesh(
    THREE,
    rectangularPlumeGeometry(THREE, 0.142, 0.068, 0.44, 0.38),
    outerFlameMat,
    "jetpack-nozzle-center-flame-outer",
    locator,
    [0, -0.006, 0]
  );
  const inner = mesh(
    THREE,
    rectangularPlumeGeometry(THREE, 0.074, 0.036, 0.29, 0.30),
    innerFlameMat,
    "jetpack-nozzle-center-flame-inner",
    locator,
    [0, -0.004, 0]
  );
  outer.castShadow = false;
  inner.castShadow = false;
  outer.visible = false;
  inner.visible = false;
  /* The throat's glare: three crossed flare cards at the aperture, so
     the pack has a hot point that blooms from any bearing - the plume
     sheet is a sliver seen end on, and end on is exactly how the
     chase camera sees it. */
  const flareMat = new THREE.MeshBasicMaterial({
    name: "jetpack-throat-flare",
    color: 0xffd08a,
    map: flareTexture(THREE),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const flareRig = new THREE.Group();
  flareRig.name = "jetpack-throat-flare";
  const flareGeo = new THREE.PlaneGeometry(0.30, 0.30);
  for (let i = 0; i < 3; i += 1) {
    const quad = new THREE.Mesh(flareGeo, flareMat);
    quad.rotation.set(Math.PI * 0.5, 0, (i / 3) * Math.PI);
    quad.renderOrder = 890;
    flareRig.add(quad);
  }
  flareRig.position.set(0, -0.05, 0);
  flareRig.visible = false;
  locator.add(flareRig);
  flames.push({ outer, inner, flare: flareRig, flareMat });

  /* Author in figure-root metre space, then preserve that transform
     while reparenting to the imported Spine. Direct bone-local metre
     values are wrong because the GLB armature is centimetre-scaled. */
  /* Brought 0.10m forward. A finely-sampled per-node sweep put the
     CLOSEST part of the pack 122mm off the back and the farthest at
     212mm - it was not near the trooper at all. An earlier coarse
     probe reported 3mm and sent two rounds of work chasing a contact
     that did not exist. */
  root.position.set(0, 1.40, -0.100);
  figure.root.add(root);
  figure.root.updateMatrixWorld(true);
  if (figure.chest) figure.chest.attach(root);
  figure.root.updateMatrixWorld(true);

  return {
    root,
    wings,
    nozzles,
    flames,
    centralThruster,
    halo,
    haloLight,
    chargeWindow: root.getObjectByName("jetpack-charge-window"),
    materials: [
      iron, ivory, bronze, amber, chargeMaterial, energy, outerFlameMat, innerFlameMat,
    ],
  };
}

function buildExhaust(ctx) {
  const { THREE } = ctx;
  const COUNT = 112;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const ages = new Float32Array(COUNT);
  const lives = new Float32Array(COUNT);
  const velocities = new Float32Array(COUNT * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.ShaderMaterial({
    name: "jetpack-exhaust",
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(72.0 / max(1.0, -mv.z), 2.0, 13.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        // A cinder: hot point, short halo - not a soft disc.
        vec2 d = gl_PointCoord - vec2(0.5);
        float r2 = dot(d, d);
        float a = exp(-r2 * 24.0) * 1.1 + pow(1.0 - smoothstep(0.0, 0.5, sqrt(r2)), 3.0) * 0.4;
        a = clamp(a, 0.0, 1.0);
        if (a <= 0.01) discard;
        gl_FragColor = vec4(vColor * 1.45 * a, a * 0.8);
      }
    `,
  });
  const points = new THREE.Points(geo, material);
  points.name = "jetpack-exhaust-pool";
  points.frustumCulled = false;
  /* Dynamic positions begin parked far below the world. Supplying the
     known pool envelope prevents Three from recomputing a sphere in
     the middle of a partial attribute update. */
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12000);
  for (let i = 0; i < COUNT; i += 1) {
    positions[i * 3 + 1] = -9999;
    colors[i * 3] = 1.0;
    colors[i * 3 + 1] = 0.72;
    colors[i * 3 + 2] = 0.24;
  }
  (ctx.vfx?.group || ctx.scene).add(points);
  return { COUNT, points, geo, positions, colors, ages, lives, velocities, cursor: 0, alive: 0 };
}

export function buildJetpack(ctx, player) {
  const { THREE } = ctx;
  const config = JETPACK_CONFIG;
  const visual = buildPack(ctx, player);
  const exhaust = buildExhaust(ctx);
  const nozzlePosition = [new THREE.Vector3()];
  const nozzleQuaternion = [new THREE.Quaternion()];
  const plumeDirection = new THREE.Vector3();
  const wallProbePosition = new THREE.Vector3();
  const wallProbeRight = new THREE.Vector3();
  const wallProbeCorner = new THREE.Vector3();
  const exhaustCullMatrix = new THREE.Matrix4();
  const exhaustLocalPosition = new THREE.Vector3();
  let spawnAccumulator = 0;
  let flameWasOn = false;
  let lastRawRequested = false;
  let wingSpread = 0;
  let boostVisualThrottle = 0;

  const state = {
    fuel: config.maxFuel,
    requested: false,
    active: false,
    inFlight: false,
    exhausted: false,
    needsRelease: false,
    cooldownRemaining: 0,
    rechargeDelayRemaining: 0,
    recharging: false,
    throttle: 0,
    pose: 0,
    horizontalSpeed: 0,
    landingAssist: null,
    landingAssistRetry: 0,
    takeoffClearing: false,
    takeoffGround: 0,
    landPulse: 0,
    ignitions: 0,
    exhaustions: 0,
    landings: 0,
    distance: 0,
    blockedFrames: 0,
    lastLandingSpeed: 0,
  };

  function clearExhaustPool() {
    spawnAccumulator = 0;
    exhaust.alive = 0;
    exhaust.cursor = 0;
    exhaust.ages.fill(0);
    exhaust.lives.fill(0);
    exhaust.velocities.fill(0);
    for (let i = 0; i < exhaust.COUNT; i += 1) {
      exhaust.positions[i * 3 + 1] = -9999;
    }
    exhaust.geo.attributes.position.needsUpdate = true;
    exhaust.points.visible = false;
  }

  function reset(full = true) {
    const keys = player.input?.keys;
    const chordHeld = !!(keys?.has("Space")
      && (keys.has("ShiftLeft") || keys.has("ShiftRight")));
    if (full) state.fuel = config.maxFuel;
    state.requested = false;
    state.active = false;
    state.inFlight = false;
    state.exhausted = false;
    /* Spawn/teleport is not a key-up event. Preserve the physical
       latch so holding the chord across a respawn cannot manufacture
       a fresh ignition on the next frame. */
    state.needsRelease = chordHeld;
    state.cooldownRemaining = 0;
    state.rechargeDelayRemaining = 0;
    state.recharging = false;
    state.throttle = 0;
    state.pose = 0;
    state.horizontalSpeed = 0;
    state.landingAssist = null;
    state.landingAssistRetry = 0;
    state.takeoffClearing = false;
    state.landPulse = 0;
    boostVisualThrottle = 0;
    wingSpread = 0;
    visual.root.userData.wingSpread = 0;
    for (const wing of visual.wings) {
      wing.wallTuck = 0;
      wing.visualSpread = 0;
      wing.deployCant = 0;
      wing.plumeThrottle = 0;
      wing.root.userData.wallTuck = 0;
      wing.root.rotation.set(0.035, wing.side * 0.46, 0);
      wing.veil.scale.set(0.10, 0.35, 1);
      for (const feather of wing.feathers) {
        feather.rotation.set(0, wing.side * 0.08, feather.userData.foldAngle);
      }
    }
    for (const flame of visual.flames) {
      flame.outer.visible = false;
      flame.inner.visible = false;
    }
    clearExhaustPool();
    lastRawRequested = chordHeld;
  }

  function ignite(playerState, groundY) {
    const wasGrounded = !!playerState.grounded;
    const fuelBefore = state.fuel;
    state.fuel = Math.max(0, state.fuel - config.ignitionCost);
    state.active = true;
    state.inFlight = true;
    state.exhausted = false;
    state.recharging = false;
    state.rechargeDelayRemaining = config.rechargeDelay;
    state.takeoffGround = groundY;
    state.landingAssist = null;
    state.landingAssistRetry = 0;
    state.takeoffClearing = true;
    state.ignitions += 1;
    playerState.grounded = false;
    playerState.vy = Math.max(playerState.vy, 5.2);
    ctx.progression?.noteVerb?.("jet", {
      verb: "jet",
      x: playerState.x,
      y: playerState.y,
      z: playerState.z,
      groundY,
      wasGrounded,
      fuelBefore,
      fuel: state.fuel,
      ignitionCost: config.ignitionCost,
      ignitionIndex: state.ignitions,
    });
    ctx.audio?.jetIgnite?.();
  }

  function cutoff(depleted = false) {
    if (!state.active && !depleted) return;
    state.active = false;
    state.rechargeDelayRemaining = depleted ? config.depletedDelay : config.rechargeDelay;
    if (depleted) {
      state.fuel = 0;
      state.exhausted = true;
      state.needsRelease = true;
      state.cooldownRemaining = config.depletedDelay;
      state.exhaustions += 1;
      ctx.audio?.jetEmpty?.();
    } else {
      ctx.audio?.jetCutoff?.();
    }
  }

  function beginFrame(dt, playerState, inputState) {
    const dead = !!ctx.combat?.player?.dead;
    const blockedByAction = !!player.action || !!ctx.mission?.entry?.active
      || !!ctx.boost?.state?.active
      || !!ctx.shield?.state?.active
      /* Committing to the fall CUTS the pack. Both are on the same
         reliquary charge and both want the vertical axis; leaving the
         pack lit would have it fighting the plunge for the whole
         descent, and the plunge would win slowly. */
      || !!ctx.slam?.state?.active
      || (ctx.weapons?.carry?.venting || 0) > 0;
    const rawRequested = !!inputState.jetpack;
    const requested = rawRequested && !playerState.free && !dead && !blockedByAction;
    state.requested = requested;

    if (state.cooldownRemaining > 0) {
      state.cooldownRemaining = Math.max(0, state.cooldownRemaining - dt);
    }
    if (!requested) {
      if (state.active) cutoff(false);
    }
    /* A lockout is armed by the physical key chord, not by the
       software-gated request. Entering free camera, an interaction or
       a death while the keys remain held must not manufacture a new
       press when that gate reopens. */
    if (!rawRequested && state.cooldownRemaining <= 0) state.needsRelease = false;

    const pressed = requested && rawRequested && !lastRawRequested;
    /* Pinned to the ground by a web (player.applyRoot) is pinned: the
       pack does not light from a standing start while it holds. A
       pack already in the air is left alone - the root zeroes its
       horizontal travel through the player's own speed, which reads
       as being caught, without cutting the burn. */
    const pinned = (playerState.rootFor || 0) > 0 && playerState.grounded;
    if (pressed && !state.active && !state.needsRelease && !pinned
      && state.fuel >= config.minIgnitionFuel && state.cooldownRemaining <= 0) {
      const gy = ctx.collide?.groundHeight(playerState.x, playerState.z)
        ?? ctx.terrain.heightAt(playerState.x, playerState.z);
      ignite(playerState, gy);
    }

    if (state.active) {
      if (!requested) cutoff(false);
      else {
        state.fuel = Math.max(0, state.fuel - config.burnRate * dt);
        if (state.fuel <= 1e-6) cutoff(true);
      }
    }

    state.recharging = false;
    if (playerState.grounded && !state.inFlight && !rawRequested && !state.active
      && !ctx.boost?.state?.active && !ctx.shield?.state?.requested) {
      state.rechargeDelayRemaining = Math.max(0, state.rechargeDelayRemaining - dt);
      if (state.cooldownRemaining <= 0 && state.rechargeDelayRemaining <= 0
        && state.fuel < config.maxFuel) {
        state.fuel = Math.min(config.maxFuel, state.fuel + config.rechargeRate * dt);
        state.recharging = state.fuel < config.maxFuel;
        if (state.fuel >= config.maxFuel) state.exhausted = false;
      }
    } else if (!playerState.grounded) {
      state.recharging = false;
    }

    state.throttle = damp(state.throttle, state.active ? 1 : 0, state.active ? 15 : 8, dt);
    const poseTarget = state.inFlight ? (state.active ? 1 : 0.58) : state.landPulse * 0.3;
    state.pose = damp(state.pose, poseTarget, state.inFlight ? 9 : 13, dt);
    state.landPulse = Math.max(0, state.landPulse - dt * 3.5);
    state.landingAssistRetry = Math.max(0, state.landingAssistRetry - dt);
    lastRawRequested = rawRequested;
    return state;
  }

  function noteMotion(distance, blocked = false) {
    state.distance += Math.max(0, distance || 0);
    if (blocked) state.blockedFrames += 1;
  }

  function land(playerState, impactSpeed = 0) {
    if (!state.inFlight) return;
    state.inFlight = false;
    state.active = false;
    state.horizontalSpeed = 0;
    state.landingAssist = null;
    state.landingAssistRetry = 0;
    state.takeoffClearing = false;
    state.landPulse = 1;
    state.landings += 1;
    state.lastLandingSpeed = Math.max(0, impactSpeed);
    state.rechargeDelayRemaining = Math.max(
      state.rechargeDelayRemaining,
      state.exhausted ? config.depletedDelay : config.rechargeDelay
    );
    state.needsRelease = state.needsRelease || state.requested;
    ctx.audio?.jetLand?.(impactSpeed);
    playerState.vy = 0;
  }

  function setState(next = {}) {
    if (Number.isFinite(next.fuel)) {
      state.fuel = clamp(next.fuel, 0, config.maxFuel);
      state.exhausted = state.fuel <= 0;
    }
    if (Number.isFinite(next.cooldownRemaining)) {
      state.cooldownRemaining = Math.max(0, next.cooldownRemaining);
    }
    if (Number.isFinite(next.rechargeDelayRemaining)) {
      state.rechargeDelayRemaining = Math.max(0, next.rechargeDelayRemaining);
    }
    return status(player.state);
  }

  /**
   * Spend reliquary charge on a grounded auxiliary system.
   *
   * Charge belongs here even when the movement does not: writing fuel
   * directly from the boost module would bypass recharge delay and the
   * depleted-flight lockout, making the two jet abilities disagree
   * about how much energy the same pack contains.
   */
  /**
   * Draw charge for something that is not flight.
   *
   * `ground` opts out of the post-flight lockout. That lockout exists
   * to stop the pack being re-lit the instant it lands; it has no
   * business stopping a GROUND boost, and once Shift became the main
   * mobility verb an unexplained half-second where it did nothing
   * after every landing read as the key being broken.
   *
   * `airborne` opts out of the in-flight refusal. That refusal is
   * there so nothing can quietly drain the tank the pack is currently
   * burning - but the ground slam is only ever committed to IN the
   * air, and it CUTS the pack in the same breath, so refusing it made
   * the one ability that has to be airborne the one ability that could
   * never pay for itself. Cost is taken first and the pack goes out
   * immediately after; nothing shares the tank across that frame.
   */
  function spend(amount, ground = false, airborne = false) {
    const cost = Math.max(0, Number(amount) || 0);
    if (cost <= 0) return true;
    if (!airborne && (state.inFlight || state.active)) return false;
    if (!ground && state.cooldownRemaining > 0) return false;
    if (state.fuel + 1e-6 < cost) return false;
    state.fuel = Math.max(0, state.fuel - cost);
    state.recharging = false;
    state.rechargeDelayRemaining = Math.max(state.rechargeDelayRemaining, config.rechargeDelay);
    if (state.fuel < config.minIgnitionFuel) state.exhausted = true;
    return true;
  }

  /**
   * Continuously draw from the reliquary charge for auxiliary gear.
   * Unlike `spend`, this returns a partial final draw so a held device
   * reaches a true zero instead of marooning a fraction of one frame's
   * fuel in the pack. Recharge delay and depletion lockout still live
   * here, alongside every other consumer of the same meter.
   */
  function drain(amount) {
    const request = Math.max(0, Number(amount) || 0);
    if (request <= 0) return 0;
    if (state.inFlight || state.active || state.cooldownRemaining > 0) return 0;
    const used = Math.min(state.fuel, request);
    if (used <= 1e-6) return 0;
    state.fuel = Math.max(0, state.fuel - used);
    state.recharging = false;
    state.rechargeDelayRemaining = Math.max(state.rechargeDelayRemaining, config.rechargeDelay);
    if (state.fuel < config.minIgnitionFuel) state.exhausted = true;
    if (state.fuel <= 1e-6) {
      state.fuel = 0;
      state.cooldownRemaining = Math.max(state.cooldownRemaining, config.depletedDelay);
      state.rechargeDelayRemaining = Math.max(state.rechargeDelayRemaining, config.depletedDelay);
      state.exhausted = true;
      state.exhaustions += 1;
      ctx.audio?.jetEmpty?.();
    }
    return used;
  }

  /**
   * Return Reliquary charge from a doctrine effect. This deliberately does
   * not shorten cooldown or recharge delay: a refund changes the shared
   * resource, not the timing gates owned by flight and recharge.
   */
  function restoreCharge(amount, reason = "external") {
    const requested = Math.max(0, Number(amount) || 0);
    if (requested <= 0) return 0;
    const before = state.fuel;
    state.fuel = clamp(before + requested, 0, config.maxFuel);
    const restored = state.fuel - before;
    if (state.fuel >= config.minIgnitionFuel) state.exhausted = false;
    state.recharging = false;
    // Exposed for diagnostics without coupling this low-level resource to a
    // progression event bus or interpreting the refund's rule.
    state.lastRestoreReason = String(reason || "external");
    return restored;
  }

  function spawnParticle(origin, direction, indexSeed, throttle = state.throttle) {
    const i = exhaust.cursor;
    exhaust.cursor = (i + 1) % exhaust.COUNT;
    const k = i * 3;
    const a = indexSeed * 12.9898 + i * 78.233;
    const sx = Math.sin(a) * 0.23;
    const sz = Math.sin(a * 1.731 + 2.1) * 0.23;
    exhaust.positions[k] = origin.x + sx * 0.08;
    exhaust.positions[k + 1] = origin.y;
    exhaust.positions[k + 2] = origin.z + sz * 0.08;
    const speed = 5.4 + 2.8 * throttle + (Math.sin(a * 0.37) * 0.5 + 0.5) * 1.5;
    exhaust.velocities[k] = direction.x * speed + sx;
    exhaust.velocities[k + 1] = direction.y * speed - 0.5;
    exhaust.velocities[k + 2] = direction.z * speed + sz;
    exhaust.ages[i] = 0;
    exhaust.lives[i] = 0.48 + (Math.sin(a * 0.71) * 0.5 + 0.5) * 0.34;
  }

  function updateVisual(dt) {
    /* A ground boost is propulsion from this same reliquary pack. Keep
       flight state authoritative for physics, while the presentation
       reads the auxiliary boost and drives the identical wings, central
       ribbon and exhaust pool. */
    const boostThrust = !!ctx.boost?.state?.active && !!player.state.grounded;
    boostVisualThrottle = damp(boostVisualThrottle, boostThrust ? 1 : 0,
      boostThrust ? 15 : 8, dt);
    const throttle = Math.max(state.throttle, boostVisualThrottle);
    const powered = state.active || boostThrust;
    const deployed = state.inFlight || boostThrust;
    const stowPhase = clamp01(ctx.weapons?.stowPhase ?? 0);
    /* Let the lance clear the shoulder plane before the blades fan.
       Thrust still begins immediately; only the decorative wing sweep
       is delayed until the authored 0.42s weapon draw is complete. */
    const weaponClear = stowPhase <= 0.0001 ? 1 : 0;
    const wingTarget = deployed ? weaponClear : state.landPulse * 0.24;
    wingSpread = damp(wingSpread, wingTarget, deployed ? 12.5 : 5.5, dt);
    const clock = player.state.clock || 0;
    const spreadEase = wingSpread * wingSpread * (3 - 2 * wingSpread);
    /* The weapon clears first, then the hinges cant the folded blades
       out of its swept volume before fanning. The cant is shared by
       both sides and returns exactly to zero once the slowest feather
       has nearly settled, preserving the authored endpoint poses. */
    const drawProgressT = clamp01((1 - stowPhase) / 0.10);
    const drawProgressEase = drawProgressT * drawProgressT * (3 - 2 * drawProgressT);
    /* Feather rotation is deliberately damped and staggered, so its
       real progress trails the scalar wingSpread during the opening
       sweep. Measure the slowest actual blade instead of releasing
       the clearance cant from the desired spread too early. The more
       open side wins when masonry has tucked its opposite wing. */
    let slowestProgress = 0;
    for (const wing of visual.wings) {
      let wingSlowest = 1;
      for (const feather of wing.feathers) {
        const range = feather.userData.poweredAngle - feather.userData.foldAngle;
        const progress = Math.abs(range) > 1e-6
          ? clamp01((feather.rotation.z - feather.userData.foldAngle) / range)
          : 1;
        wingSlowest = Math.min(wingSlowest, progress);
      }
      slowestProgress = Math.max(slowestProgress, wingSlowest);
    }
    const settleT = clamp01((slowestProgress - 0.92) / (0.99 - 0.92));
    const settleEase = settleT * settleT * (3 - 2 * settleT);
    const deploymentCant = powered
      ? (14 * Math.PI / 180) * drawProgressEase * (1 - settleEase)
      : 0;
    /* The lance remains drawn for a short beat after touchdown. Its
       grounded carry twist used to pull the closing left feathers
       through the torso before auto-stow relaxed the pose. Retain a
       restrained five-degree flare while the hands still own the
       weapon, then hand that clearance back continuously through the
       existing release blend. The true fully-stowed endpoint is
       therefore unchanged. */
    const handRelease = clamp01(ctx.weapons?.carry?.handRelease ?? 0);
    const landingCant = !deployed
      ? (5.5 * Math.PI / 180) * (1 - handRelease)
      : 0;
    const clearanceCant = deploymentCant + landingCant;

    /* The seraph span is intentionally wider than the player's
       collision capsule. Probe the authored full-height collision
       intervals and fold either wing independently before it cuts
       through nearby masonry. This is presentation-only: traversal
       collision and player clearance remain exactly as authored. */
    visual.root.updateWorldMatrix(true, false);
    wallProbePosition.set(0, 0.026, -0.136).applyMatrix4(visual.root.matrixWorld);
    wallProbeRight.set(1, 0, 0).transformDirection(visual.root.matrixWorld);
    wallProbeRight.y = 0;
    if (wallProbeRight.lengthSq() > 1e-8) wallProbeRight.normalize();
    else wallProbeRight.set(1, 0, 0);
    let wingBandLo = Infinity;
    let wingBandHi = -Infinity;
    for (let yi = 0; yi < 2; yi += 1) {
      const localY = yi === 0 ? -0.58 : 0.64;
      for (let zi = 0; zi < 2; zi += 1) {
        const localZ = zi === 0 ? -0.32 : 0.05;
        wallProbeCorner.set(0, localY, localZ).applyMatrix4(visual.root.matrixWorld);
        wingBandLo = Math.min(wingBandLo, wallProbeCorner.y);
        wingBandHi = Math.max(wingBandHi, wallProbeCorner.y);
      }
    }

    for (const wing of visual.wings) {
      let obstructionRadius = Infinity;
      for (let ri = 0; ri < 3; ri += 1) {
        const radius = ri === 0 ? 0.50 : (ri === 1 ? 0.70 : 0.90);
        const qx = wallProbePosition.x + wallProbeRight.x * wing.side * radius;
        const qz = wallProbePosition.z + wallProbeRight.z * wing.side * radius;
        const spans = ctx.collide?.flightCellAt?.(qx, qz);
        let blocked = false;
        if (spans) {
          for (let si = 0; si < spans.length; si += 2) {
            if (spans[si + 1] > wingBandLo && spans[si] < wingBandHi) {
              blocked = true;
              break;
            }
          }
        }
        if (!blocked && ctx.terrain?.groundHeightAt) {
          blocked = ctx.terrain.groundHeightAt(qx, qz) > wingBandLo + 0.02;
        }
        if (blocked) {
          obstructionRadius = radius;
          break;
        }
      }
      /* Partial span estimates are not conservative while the body
         turns beside a wall: a fifteen-degree yaw can sweep the long
         ceramic tips across a neighbouring cell even though the
         lateral sample distance has not changed. Any occupied probe
         therefore commands the compact endpoint on that side. The
         opposite wing remains fully expressive, while the threatened
         wing stays inside the player's nominal capsule envelope. */
      const tuckTarget = Number.isFinite(obstructionRadius) ? 1 : 0;
      const forcedWallClose = tuckTarget > wing.wallTuck + 0.0001;
      /* A 30 m/s collision can move the capsule half a metre in one
         rendered frame. Close immediately when a newly sampled wall
         removes span, including the articulated transforms below;
         reopening stays damped so cell boundaries never make the
         silhouette chatter. */
      wing.wallTuck = forcedWallClose
        ? tuckTarget
        : damp(wing.wallTuck, tuckTarget, 7, dt);
      const sideSpread = spreadEase * (1 - wing.wallTuck);
      wing.visualSpread = sideSpread;
      wing.root.userData.wallTuck = wing.wallTuck;
      const modeAngleY = wing.side * (
        deployed ? (powered ? 0.34 : 0.20) : 0.46
      );
      const rootYawTarget = lerp(wing.side * 0.46, modeAngleY, sideSpread);
      wing.root.rotation.y = forcedWallClose
        ? rootYawTarget
        : damp(wing.root.rotation.y, rootYawTarget, 9, dt);
      const rootPitchTarget = lerp(
        0.035,
        powered ? -0.075 : -0.025,
        sideSpread
      );
      wing.root.rotation.x = forcedWallClose
        ? rootPitchTarget + clearanceCant
        : damp(wing.root.rotation.x - wing.deployCant, rootPitchTarget, 9, dt)
          + clearanceCant;
      wing.deployCant = clearanceCant;
      for (let f = 0; f < wing.feathers.length; f += 1) {
        const feather = wing.feathers[f];
        const delay = f * 0.038;
        const localSpread = clamp01((sideSpread - delay) / Math.max(0.01, 1 - delay));
        const deployedAngle = powered
          ? feather.userData.poweredAngle
          : feather.userData.glideAngle;
        const flutter = powered
          ? Math.sin(clock * 7.4 + feather.userData.phase) * 0.012 * localSpread * throttle
          : Math.sin(clock * 2.6 + feather.userData.phase) * 0.004 * localSpread;
        const featherAngleTarget = lerp(
          feather.userData.foldAngle,
          deployedAngle,
          localSpread
        ) + flutter;
        feather.rotation.z = forcedWallClose
          ? featherAngleTarget
          : damp(feather.rotation.z, featherAngleTarget, 13, dt);
        const featherYawTarget = wing.side
          * lerp(0.08, powered ? 0.015 : 0.055, localSpread);
        feather.rotation.y = forcedWallClose
          ? featherYawTarget
          : damp(feather.rotation.y, featherYawTarget, 11, dt);
      }
      wing.veil.scale.x = lerp(0.10, 1, sideSpread);
      wing.veil.scale.y = lerp(0.35, powered ? 0.92 : 1, sideSpread);
      wing.hinge.rotation.z = clock * wing.side * 0.18;
      wing.hingeLight.rotation.z = -clock * wing.side * 0.28;
    }
    visual.root.userData.wingSpread = wingSpread;
    visual.root.userData.wallTuckL = visual.wings[0]?.wallTuck || 0;
    visual.root.userData.wallTuckR = visual.wings[1]?.wallTuck || 0;
    if (visual.halo) visual.halo.rotation.z = Math.sin(clock * 0.72) * 0.035 * spreadEase;
    if (visual.haloLight) visual.haloLight.rotation.z = -Math.sin(clock * 0.92) * 0.055 * spreadEase;
    const energyMat = visual.wings[0]?.veil?.material;
    if (energyMat) energyMat.opacity = lerp(0.035, powered ? 0.24 : 0.13, spreadEase);

    const centralNozzle = visual.nozzles[0];
    centralNozzle.getWorldPosition(nozzlePosition[0]);
    centralNozzle.getWorldQuaternion(nozzleQuaternion[0]);
    const flicker = 0.92 + Math.sin(player.state.clock * 37) * 0.08;
    /* The central aperture does not belong to either wing. Delay its
       solid ribbon through the opening sweep, then keep it alive when
       one side folds beside masonry; a one-sided wall tuck must not
       make the only engine appear to cut out. */
    const flameThrottle = throttle * clamp01((spreadEase - 0.76) / 0.14);
    const wallPlumeTuck = Math.max(
      visual.wings[0]?.wallTuck || 0,
      visual.wings[1]?.wallTuck || 0
    );
    /* The compact endpoint necessarily closes across the centerline
       exhaust envelope. Keep a short, readable pilot ribbon at a wall,
       but remove the long sheet and free particles before either can
       pass through the folding feathers. */
    const wallPlumeLength = lerp(1, 0.26, wallPlumeTuck);
    for (const wing of visual.wings) wing.plumeThrottle = flameThrottle;
    const centralFlame = visual.flames[0];
    /* A tucked feather crosses the rectangular aperture footprint, not
       merely the ribbon's length. Preserve the gold reactor glow beside
       masonry, but hide the free exhaust sheet until both wings are back
       outside that footprint. */
    const flameOn = flameThrottle > 0.025 && wallPlumeTuck <= 0.02;
    /* Ignition: the first frame the plume lights is a burst, not a
       fade-in - a throat of gas catching. */
    if (flameOn && !flameWasOn && ctx.vfx?.jetIgnite) {
      plumeDirection.set(0, -1, 0).applyQuaternion(nozzleQuaternion[0]).normalize();
      ctx.vfx.jetIgnite(nozzlePosition[0].x, nozzlePosition[0].y, nozzlePosition[0].z,
        plumeDirection.x, plumeDirection.y, plumeDirection.z, flameThrottle);
    }
    flameWasOn = flameOn;
    centralFlame.outer.visible = flameOn;
    centralFlame.inner.visible = flameOn;
    if (centralFlame.flare) {
      centralFlame.flare.visible = flameOn;
      const g = flameThrottle * (0.55 + 0.45 * flicker);
      centralFlame.flareMat.opacity = flameOn ? 0.55 + g * 0.65 : 0;
      centralFlame.flare.scale.setScalar(0.7 + g * 0.6);
    }
    for (const m of [centralFlame.outer.material, centralFlame.inner.material]) {
      if (!m.uniforms) continue;
      m.uniforms.uTime.value = player.state.clock || 0;
      m.uniforms.uThrottle.value = flameThrottle;
    }
    centralFlame.outer.scale.set(
      lerp(0.62, 1, flameThrottle),
      lerp(0.38, 1, flameThrottle) * flicker * wallPlumeLength,
      lerp(0.62, 1, flameThrottle)
    );
    centralFlame.inner.scale.set(
      lerp(0.66, 1, flameThrottle),
      lerp(0.46, 1, flameThrottle) * (2 - flicker) * wallPlumeLength,
      lerp(0.66, 1, flameThrottle)
    );

    const windowMat = visual.chargeWindow?.material;
    if (windowMat) {
      const fuelN = clamp01(state.fuel / config.maxFuel);
      windowMat.emissiveIntensity = lerp(0.35, 1.7, fuelN)
        * (state.recharging ? 0.88 + Math.sin(player.state.clock * 4) * 0.12 : 1);
      const low = fuelN < 0.18;
      windowMat.color.setHex(low ? 0xa52b38 : 0xffcf67);
      windowMat.emissive.setHex(low ? 0xff2338 : 0xb76b18);
    }

    if (wallPlumeTuck > 0.02 && (exhaust.alive > 0 || spawnAccumulator > 0)) {
      clearExhaustPool();
    }
    if (powered && dt > 0 && flameOn && wallPlumeTuck <= 0.02) {
      spawnAccumulator += dt * lerp(34, 82, flameThrottle);
      const count = Math.min(16, Math.floor(spawnAccumulator));
      spawnAccumulator -= count;
      for (let n = 0; n < count; n += 1) {
        plumeDirection.set(0, -1, 0).applyQuaternion(nozzleQuaternion[0]).normalize();
        spawnParticle(nozzlePosition[0], plumeDirection,
          player.state.clock + n * 0.113, throttle);
      }
    }

    /* Particles live in world space so the trail does not follow the
       character like a rigid prop. Cull only the forward half-space in
       pack-local coordinates: turbulence may fan behind the aperture,
       but no random seed can carry a long-lived spark back into armour. */
    exhaustCullMatrix.copy(visual.root.matrixWorld).invert();
    let alive = 0;
    for (let i = 0; i < exhaust.COUNT; i += 1) {
      const life = exhaust.lives[i];
      if (life <= 0) continue;
      exhaust.ages[i] += dt;
      const k = i * 3;
      if (exhaust.ages[i] >= life) {
        exhaust.lives[i] = 0;
        exhaust.positions[k + 1] = -9999;
        continue;
      }
      const fade = 1 - exhaust.ages[i] / life;
      exhaust.colors[k] = lerp(0.72, 1.0, fade);
      exhaust.colors[k + 1] = lerp(0.28, 0.78, fade);
      exhaust.colors[k + 2] = lerp(0.04, 0.34, fade);
      exhaust.positions[k] += exhaust.velocities[k] * dt;
      exhaust.positions[k + 1] += exhaust.velocities[k + 1] * dt;
      exhaust.positions[k + 2] += exhaust.velocities[k + 2] * dt;
      exhaust.velocities[k] *= Math.exp(-1.9 * dt);
      exhaust.velocities[k + 1] -= 1.8 * dt;
      exhaust.velocities[k + 2] *= Math.exp(-1.9 * dt);
      exhaustLocalPosition
        .set(
          exhaust.positions[k],
          exhaust.positions[k + 1],
          exhaust.positions[k + 2]
        )
        .applyMatrix4(exhaustCullMatrix);
      if (exhaustLocalPosition.z > -0.055) {
        exhaust.lives[i] = 0;
        exhaust.positions[k + 1] = -9999;
        continue;
      }
      alive += 1;
    }
    exhaust.alive = alive;
    exhaust.geo.attributes.position.needsUpdate = true;
    exhaust.geo.attributes.color.needsUpdate = true;
    exhaust.points.visible = alive > 0;
  }

  function status(playerState = player.state) {
    const boostThrust = !!ctx.boost?.state?.active && !!playerState.grounded;
    let mode = "ready";
    if (state.active) mode = "thrust";
    else if (boostThrust) mode = "boost";
    else if (state.inFlight) mode = state.exhausted ? "empty" : "glide";
    else if (state.cooldownRemaining > 0) mode = "cooldown";
    else if (state.recharging) mode = "recharging";
    else if (state.fuel < config.minIgnitionFuel) mode = "low";
    return {
      requested: state.requested,
      active: state.active,
      inFlight: state.inFlight,
      mode,
      fuel: Number(state.fuel.toFixed(3)),
      maxFuel: config.maxFuel,
      burnRate: config.burnRate,
      rechargeRate: config.rechargeRate,
      cooldownRemaining: Number(state.cooldownRemaining.toFixed(3)),
      rechargeDelayRemaining: Number(state.rechargeDelayRemaining.toFixed(3)),
      lockedOut: state.needsRelease || state.cooldownRemaining > 0,
      recharging: state.recharging,
      grounded: !!playerState.grounded,
      y: Number(playerState.y.toFixed(3)),
      vy: Number(playerState.vy.toFixed(3)),
      horizontalSpeed: Number((state.horizontalSpeed || 0).toFixed(3)),
      throttle: Number(state.throttle.toFixed(3)),
      pose: Number(state.pose.toFixed(3)),
      wingSpread: Number(wingSpread.toFixed(3)),
      wallTuckL: Number((visual.wings[0]?.wallTuck || 0).toFixed(3)),
      wallTuckR: Number((visual.wings[1]?.wallTuck || 0).toFixed(3)),
      takeoffClearing: state.takeoffClearing,
      ignitions: state.ignitions,
      exhaustions: state.exhaustions,
      landings: state.landings,
      lastLandingSpeed: Number(state.lastLandingSpeed.toFixed(3)),
      distance: Number(state.distance.toFixed(2)),
      blockedFrames: state.blockedFrames,
      exhaustParticles: exhaust.alive,
      boostThrust,
      flameVisible: visual.flames.some((flame) => flame.outer.visible || flame.inner.visible),
    };
  }

  return {
    config,
    state,
    visual,
    beginFrame,
    noteMotion,
    land,
    reset,
    setState,
    spend,
    drain,
    restoreCharge,
    restore: restoreCharge,
    updateVisual,
    status,
  };
}
