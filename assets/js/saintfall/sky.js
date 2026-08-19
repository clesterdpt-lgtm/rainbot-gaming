/* ============================================================
   SAINTFALL - sky, sun and the broken halo

   Everything above the horizon. The dome samples the same
   `sfSky()` function the world's aerial perspective uses, so a
   ridge fading into the distance fades into exactly the colour of
   the sky behind it - if these two ever drift apart you get a
   visible seam along every horizon line, and it reads as a bug in
   the terrain rather than in the sky.

   The signature element is the halo: a shattered orbital ring
   left over from whatever brought the Saint down. It arcs across
   the sky from every point on the map, so wherever the player is
   standing there is always one enormous object giving the frame
   scale and a diagonal.
   ============================================================ */

import {
  TAU, clamp01, lerp, smoothstep, makeRng, makeRamp, hexToRgb, mixRgb,
} from "saintfall/core.js";
import {
  PALETTE, srgbTransfer as srgb, paintGeometry, patchBasicMaterial,
} from "saintfall/art.js";

/* The dome. A raw shader so the gradient is evaluated per pixel
   rather than per vertex - a vertex-interpolated sky bands badly
   across the sun halo, and banding in a clear sky is the first
   thing anyone notices. */
const DOME_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;   // pin to the far plane
}
`;

const DOME_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;

uniform vec3  uSunDir;
uniform vec3  uSunHalo;
uniform vec3  uSecondSunDir;
uniform vec3  uMoonADir;
uniform vec3  uMoonBDir;
uniform vec3  uMoonCDir;
uniform vec3  uSkyZenith;
uniform vec3  uSkyHigh;
uniform vec3  uSkyHorizon;
uniform vec3  uSkyLow;
uniform vec4  uFog;        // density, heightFalloff, start, sunScatter
uniform vec4  uCelestial;  // primary sun, second sun, moons, cycle phase
uniform float uSunSize;
uniform float uStars;
uniform float uTimeSF;

vec3 sfSky(vec3 rd) {
  float h = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c;
  if (h < 0.5) {
    c = mix(uSkyLow, uSkyHorizon, smoothstep(0.0, 1.0, h / 0.5));
  } else if (h < 0.72) {
    c = mix(uSkyHorizon, uSkyHigh, smoothstep(0.0, 1.0, (h - 0.5) / 0.22));
  } else {
    c = mix(uSkyHigh, uSkyZenith, smoothstep(0.0, 1.0, (h - 0.72) / 0.28));
  }
  float mu = max(dot(rd, uSunDir), 0.0);
  c += uSunHalo * (pow(mu, 26.0) * 0.55 + pow(mu, 3.0) * 0.16) * uFog.w;
  return c;
}

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float sfNoise(vec2 p, float seed) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(vec3(cell, seed));
  float b = hash13(vec3(cell + vec2(1.0, 0.0), seed));
  float c = hash13(vec3(cell + vec2(0.0, 1.0), seed));
  float d = hash13(vec3(cell + vec2(1.0, 1.0), seed));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float sfDisc(vec3 rd, vec3 dir, float size) {
  return smoothstep(1.0 - size, 1.0 - size * 0.18, dot(rd, dir));
}

void sfBasis(vec3 dir, out vec3 right, out vec3 up) {
  vec3 pole = abs(dir.y) > 0.94 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
  right = normalize(cross(pole, dir));
  up = normalize(cross(dir, right));
}

vec3 sfMoon(vec3 base, vec3 rd, vec3 dir, float size, vec3 tint,
            float visibility, float seed, float ringed) {
  if (visibility <= 0.001) return base;
  vec3 right;
  vec3 up;
  sfBasis(dir, right, up);
  float radius = sqrt(size * 2.0);
  vec2 q = vec2(dot(rd, right), dot(rd, up)) / max(radius, 0.0001);

  /* The largest moon owns a thin broken ring. It is a projected
     ellipse rather than a circular halo, which makes it read as a
     body with an orbital plane instead of another glowing reticle. */
  float ringRadius = length(vec2(q.x / 2.15, q.y / 0.32));
  float ring = (1.0 - smoothstep(0.018, 0.095, abs(ringRadius - 1.0)))
    * (1.0 - smoothstep(1.05, 2.65, length(q))) * ringed;
  float ringAngle = atan(q.y / 0.32, q.x / 2.15);
  float ringBreak = smoothstep(0.28, 0.62,
    0.5 + 0.5 * sin(ringAngle * 13.0 + seed * 4.7));
  base += mix(tint * 0.12, tint * 0.58, step(0.0, q.y))
    * ring * ringBreak * visibility;

  float r = length(q);
  float disc = 1.0 - smoothstep(0.91, 1.0, r);
  if (disc <= 0.001) return base;
  float sphere = sqrt(max(0.0, 1.0 - r * r));
  float phase = smoothstep(-0.72, 0.62, q.x * -0.78 + q.y * 0.18 + sphere * 0.62);
  float cells = sfNoise(q * 18.0 + seed * 2.3, seed * 19.0);
  float broad = sfNoise(q * 6.0 - seed * 1.7, seed * 7.0 + 4.0);
  float crater = 0.48 + cells * 0.32 + broad * 0.25;
  vec3 surface = tint * crater * (0.10 + phase * 0.46);
  float rim = pow(max(sphere, 0.0), 0.35);
  surface += tint * rim * 0.055;
  return mix(base, surface, disc * visibility);
}

void main() {
  vec3 rd = normalize(vDir);
  vec3 col = sfSky(rd);

  // --- the disc -----------------------------------------------------
  // Soft-edged rather than a hard circle: at this exposure a hard
  // disc aliases into a polygon the moment the camera turns. Two
  // terms - a bright core and a wide glare skirt - because a disc
  // with no skirt reads as a hole punched in the sky.
  float mu = dot(rd, uSunDir);
  float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.25, mu)
    * uCelestial.x;
  float glare = pow(max(mu, 0.0), 900.0);
  col += uSunHalo * (disc * 6.5 + glare * 2.2 * uCelestial.x);

  // --- stars --------------------------------------------------------
  if (uStars > 0.001) {
    vec3 sp = rd * 190.0;
    vec3 cell = floor(sp);
    float r = hash13(cell);
    if (r > 0.9825) {
      vec3 off = vec3(hash13(cell + 1.7), hash13(cell + 3.3), hash13(cell + 7.1)) - 0.5;
      float d = length(fract(sp) - 0.5 - off * 0.6);
      float tw = 0.72 + 0.28 * sin(uTimeSF * 1.7 + r * 40.0);
      float s = smoothstep(0.14, 0.0, d) * tw;
      float warm = hash13(cell + 11.0);
      col += mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.72), warm)
           * s * uStars * (0.4 + r * 6.0) * smoothstep(-0.05, 0.25, rd.y);
    }
  }

  // --- Vesper's other lights ----------------------------------------
  // A smaller copper companion follows the daylight key. It is close
  // enough to feel like a binary system, but separated enough that the
  // player can resolve two silhouettes at a glance.
  float twin = sfDisc(rd, uSecondSunDir, uSunSize * 0.34) * uCelestial.y;
  float twinGlare = pow(max(dot(rd, uSecondSunDir), 0.0), 1200.0) * uCelestial.y;
  col += vec3(1.0, 0.54, 0.24) * (twin * 4.4 + twinGlare * 0.72);

  /* Three distinct night bodies: a ringed cathedral moon, a small
     cyan ice moon, and a rust-red captured moon. Their material is
     procedural and stable in sky space, so no texture fetch can turn
     the most characteristic part of the night into a blank quad. */
  col = sfMoon(col, rd, uMoonADir, 0.0032, vec3(0.64, 0.78, 1.0),
    uCelestial.z, 1.7, 1.0);
  col = sfMoon(col, rd, uMoonBDir, 0.00105, vec3(0.42, 0.94, 0.92),
    uCelestial.z * 0.88, 4.3, 0.0);
  col = sfMoon(col, rd, uMoonCDir, 0.00062, vec3(1.0, 0.42, 0.22),
    uCelestial.z * 0.78, 8.9, 0.0);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function buildSky(ctx) {
  const { THREE, scene, atmos } = ctx;
  const group = new THREE.Group();
  group.name = "sky";
  group.renderOrder = -1000;
  scene.add(group);

  /* ------------------------------ dome ------------------------------ */

  const domeUniforms = {
    uSunDir: atmos.uniforms.uSunDir,
    uSunHalo: atmos.uniforms.uSunHalo,
    uSecondSunDir: { value: new THREE.Vector3(0.4, 0.5, -0.7).normalize() },
    uMoonADir: { value: new THREE.Vector3(-0.4, 0.5, 0.7).normalize() },
    uMoonBDir: { value: new THREE.Vector3(0.7, 0.35, 0.2).normalize() },
    uMoonCDir: { value: new THREE.Vector3(-0.7, 0.22, -0.4).normalize() },
    uSkyZenith: atmos.uniforms.uSkyZenith,
    uSkyHigh: atmos.uniforms.uSkyHigh,
    uSkyHorizon: atmos.uniforms.uSkyHorizon,
    uSkyLow: atmos.uniforms.uSkyLow,
    uFog: atmos.uniforms.uFog,
    uTimeSF: atmos.uniforms.uTimeSF,
    uCelestial: { value: new THREE.Vector4(1, 0.82, 0, 0) },
    uSunSize: { value: 0.0016 },
    uStars: { value: 0 },
  };

  const domeMat = new THREE.ShaderMaterial({
    uniforms: domeUniforms,
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,   // the composite pass owns tone mapping
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  group.add(dome);

  /* ------------------------------ sun light ------------------------------ */

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 2400;
  const shadowHalf = 300;
  sun.shadow.camera.left = -shadowHalf;
  sun.shadow.camera.right = shadowHalf;
  sun.shadow.camera.top = shadowHalf;
  sun.shadow.camera.bottom = -shadowHalf;
  sun.shadow.camera.updateProjectionMatrix();
  /* Both biases are set by `applyShadowBias` below, from the texel
     the CURRENT tier actually has. They are not constants and they
     never were: see the note there. */
  scene.add(sun);
  scene.add(sun.target);

  /* Dynamic diffuse fill. The sharp/specular part of the image-based
     sky stays on the dawn PMREM made at boot; this zero-shadow light
     carries the slowly changing sky and ground colours without ever
     regenerating that texture during play. */
  const skyFill = new THREE.HemisphereLight(0xffffff, 0x453548, 0);
  skyFill.name = "vesper-cycle-fill";
  scene.add(skyFill);

  /* How far under the world the camera is, 0..1. Owned by
     undercroft.js and read once a frame below. A scalar rather than a
     boolean because the collapse ramps it across the fall, and a hard
     switch on the frame the daylight goes away is a flash, not a
     descent. */
  let subterranean = 0;
  const UNDERGROUND_FILL = new THREE.Color(0x3b2a52);

  /* ============================================================
     THE HALO
     A shattered orbital ring. Built once as real geometry at 5.2km
     so it holds parallax against the dome and reads as an object in
     the world rather than as a painted backdrop.

     It is deliberately broken into arcs of unequal length with
     unequal gaps. An unbroken ring reads as a planetary feature; a
     broken one reads as wreckage, which is the whole point.
     ============================================================ */

  function buildHalo() {
    const halo = new THREE.Group();
    halo.name = "halo";
    const rng = makeRng(0x5a17);

    // Sized against what it actually subtends. A ring at 5.2km with
    // a 118m band is 1.3 degrees wide - a thread on the horizon, not
    // wreckage the size of a moon. At 6.2km a 300m band reads at
    // nearly 3 degrees, and the tilt below lifts the arc to almost
    // 50 degrees of elevation so it leaves the top of the frame,
    // which is what sells the scale.
    const R = 6200;
    const thickness = 300;   // radial width of the band
    const depth = 105;       // how deep the band is, edge on

    /* Arc segments as [startDeg, sweepDeg]. Hand-authored rather
       than random: the gaps have to fall where they read against
       the sun, and one long unbroken span is what sells the
       original scale of the thing. */
    const ARCS = [
      [4, 92], [104, 46], [158, 21], [186, 63], [258, 30], [296, 14], [318, 34],
    ];

    const segs = [];
    for (const [start, sweep] of ARCS) {
      const steps = Math.max(4, Math.round(sweep / 3.2));
      const pos = [];
      const idx = [];
      const a0 = start * Math.PI / 180;
      const a1 = (start + sweep) * Math.PI / 180;

      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const a = lerp(a0, a1, t);
        // Taper the ends of every arc so the breaks look torn.
        const endFade = Math.min(smoothstep(clamp01(t * 5)), smoothstep(clamp01((1 - t) * 5)));
        const w = thickness * (0.32 + 0.68 * endFade) * rng.range(0.86, 1.14);
        const d = depth * (0.3 + 0.7 * endFade);
        const ri = R - w * 0.5;
        const ro = R + w * 0.5;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // Four corners: inner-front, outer-front, outer-back, inner-back
        pos.push(ri * ca, -d * 0.5, ri * sa);
        pos.push(ro * ca, -d * 0.5, ro * sa);
        pos.push(ro * ca, d * 0.5, ro * sa);
        pos.push(ri * ca, d * 0.5, ri * sa);
      }
      for (let i = 0; i < steps; i += 1) {
        const b = i * 4;
        const n = (i + 1) * 4;
        // four quads around the box cross-section
        const quad = (a, bb, c, dd) => { idx.push(a, bb, c, a, c, dd); };
        quad(b + 0, n + 0, n + 1, b + 1);   // bottom
        quad(b + 1, n + 1, n + 2, b + 2);   // outer
        quad(b + 2, n + 2, n + 3, b + 3);   // top
        quad(b + 3, n + 3, n + 0, b + 0);   // inner
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      segs.push(g);
    }

    const merged = mergeGeometries(THREE, segs);
    /* Painted by facing: the outer rim catches sun as pale gold, the
       shadowed inner face stays a grey-green bronze.

       Deliberately desaturated and light. A first pass used the same
       saturated verdigris as the Saint, and at six kilometres, on an
       unlit material, against a blue sky, it read as a green stick
       lying across the corner of the frame. Everything six
       kilometres up is mostly air. */
    const ramp = makeRamp([
      [0.0, "#5d6a68"],
      [0.35, "#7a7e76"],
      [0.6, "#948873"],
      [0.82, "#b09b7f"],
      [1.0, "#d0bd9c"],
    ]);
    const nrm = merged.attributes.normal;
    paintGeometry(THREE, merged, ramp, (x, y, z, i) => {
      const radial = (x * nrm.getX(i) + z * nrm.getZ(i)) / Math.max(1, Math.hypot(x, z));
      const up = nrm.getY(i);
      /* MEASURED, NOT FIXED - left as it was on purpose.

         The ring still reads as a pale bar rather than as wreckage,
         and an attempt to give it tone along the arc (three
         incommensurate runs of sine on atan2(z,x), plus a width
         swell) was reverted: it moved 14.7% of the ring's pixels and
         moved the spine's luma spread not at all (sd 28.87 -> 29.46
         on the vista-east pose), i.e. it changed the picture without
         improving the thing it was aimed at, and its width term had
         a mean of 0.70 so it quietly made the band THINNER - the
         opposite of the complaint.

         Two facts for whoever picks this up. The haze is NOT the
         cause: worked through, the aerial-perspective mix at 6.2km
         and 620m of altitude comes out at f = 0.022, and times the
         0.68 fade that is a 1.5% pull toward the sky. And the
         existing `jitter: 0.14` is the same order as any vertex-tone
         variation added here, so per-vertex paint is probably the
         wrong lever - the band subtends under 3 degrees and is seen
         nearly edge-on, so what a viewer can resolve is its
         SILHOUETTE, not its shading. */
      return clamp01(0.42 + radial * 0.34 + up * 0.22);
    }, { jitter: 0.14 });

    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
    mat.name = "sf-halo";
    /* Six kilometres of atmosphere between the viewer and the ring,
       but only PART of that applied: the ring is 600m up, where the
       air is thin, and at a full 0.92 it faded to a grey scratch
       that reads as dirt on the lens. Haze should place it, not
       erase it. */
    patchBasicMaterial(mat, atmos, 0.68);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.frustumCulled = false;
    halo.add(mesh);

    /* Debris: the ring shed a field of tumbling fragments into the
       gaps, which is what makes the breaks legible as breaks. */
    const debrisGeoms = [];
    for (let i = 0; i < 190; i += 1) {
      const a = rng() * TAU;
      // Clustered tightly around the band. Scattered wide they stop
      // reading as shed fragments and start reading as confetti.
      const rr = R + rng.gauss() * 150;
      const yy = rng.gauss() * 110;
      const s = rng.range(14, 70);
      const g = new THREE.BoxGeometry(s * rng.range(0.6, 2.4), s * rng.range(0.3, 1.0), s * rng.range(0.6, 1.8));
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rng() * TAU, rng() * TAU, rng() * TAU)
      );
      m.compose(
        new THREE.Vector3(rr * Math.cos(a), yy, rr * Math.sin(a)),
        q, new THREE.Vector3(1, 1, 1)
      );
      g.applyMatrix4(m);
      debrisGeoms.push(g);
    }
    const debris = mergeGeometries(THREE, debrisGeoms);
    paintGeometry(THREE, debris, ramp, (x, y, z) => clamp01(0.3 + (y / 260 + 0.5) * 0.5), { jitter: 0.2 });
    const debrisMesh = new THREE.Mesh(debris, mat);
    debrisMesh.frustumCulled = false;
    halo.add(debrisMesh);

    /* Tilt sets the maximum elevation the arc reaches: a ring of
       radius R tilted by theta tops out at atan(R sin/R cos) =
       theta. At 26 degrees the whole thing sat under the horizon
       line of a level camera. At 46 it climbs out of the top of the
       frame, so from the drop the halo runs diagonally across the
       sky and off the corner - which is the only way a ring reads
       as bigger than the sky rather than as a decal on it. */
    halo.rotation.set(46 * Math.PI / 180, 0.62, 9 * Math.PI / 180);
    halo.position.y = 620;
    return halo;
  }

  const halo = buildHalo();
  group.add(halo);

  /* ============================================================
     CLOUD SHELVES
     Low, thin, hard-edged slabs near the horizon. Faceted rather
     than soft: a volumetric cloud in a flat-shaded world looks
     like it wandered in from another game. Painted top-lit and
     under-shadowed against the sun so they carry the light
     direction.
     ============================================================ */

  const cloudMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.92,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: true,
  });
  cloudMat.name = "sf-cloud";
  const clouds = new THREE.Group();
  clouds.name = "clouds";
  group.add(clouds);

  let cloudMesh = null;

  function buildClouds() {
    if (cloudMesh) {
      clouds.remove(cloudMesh);
      cloudMesh.geometry.dispose();
      cloudMesh = null;
    }
    const rng = makeRng(0x1c10d5);
    const geoms = [];
    const sunDir = atmos.sunDir;

    const lit = atmos.time === "night" ? "#5a6b96" : "#ffe6c0";
    const shade = atmos.time === "night" ? "#141c38" : "#a2708a";
    const litRgb = hexToRgb(lit);
    const shadeRgb = hexToRgb(shade);

    for (let i = 0; i < 26; i += 1) {
      const a = rng() * TAU;
      const dist = rng.range(2200, 5200);
      const y = rng.range(330, 1250);
      const len = rng.range(420, 1500);
      const w = rng.range(90, 340);
      const h = rng.range(24, 78);

      // A shelf is a run of overlapping tapered slabs. Irregular
      // counts and offsets keep any two from reading as the same
      // stamped shape.
      const lobes = rng.int(3, 7);
      const pos = [];
      const idx = [];
      let base = 0;
      for (let k = 0; k < lobes; k += 1) {
        const t = (k + 0.5) / lobes;
        const fade = Math.sin(t * Math.PI);
        const lx = (t - 0.5) * len;
        const lw = w * (0.35 + fade * 0.85) * rng.range(0.7, 1.3);
        const lh = h * (0.3 + fade) * rng.range(0.6, 1.4);
        const ly = rng.gauss() * h * 0.5;
        const hl = len / lobes * rng.range(0.7, 1.5);
        // squat octagonal prism - reads as cloud, stays faceted
        const ring = 7;
        const top = [];
        const bot = [];
        for (let s = 0; s < ring; s += 1) {
          const ang = (s / ring) * TAU + rng.range(-0.12, 0.12);
          const rx = hl * (0.62 + 0.38 * Math.abs(Math.cos(ang)));
          const rz = lw * (0.55 + 0.45 * Math.abs(Math.sin(ang)));
          const px = lx + Math.cos(ang) * rx;
          const pz = Math.sin(ang) * rz;
          top.push(pos.length / 3); pos.push(px * 0.92, ly + lh * 0.5, pz * 0.86);
          bot.push(pos.length / 3); pos.push(px, ly - lh * 0.5, pz);
        }
        const capT = pos.length / 3; pos.push(lx, ly + lh * 0.72, 0);
        const capB = pos.length / 3; pos.push(lx, ly - lh * 0.62, 0);
        for (let s = 0; s < ring; s += 1) {
          const n = (s + 1) % ring;
          idx.push(top[s], bot[s], bot[n], top[s], bot[n], top[n]);
          idx.push(capT, top[n], top[s]);
          idx.push(capB, bot[s], bot[n]);
        }
        base = pos.length / 3;
      }
      void base;

      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();

      // Bake the sun into the vertex colours. These are unlit, so
      // this is the only thing giving them form.
      /* FOUR components, not three. The shelves are opaque slabs and
         want alpha 1 everywhere, but they share a mesh and a material
         with the cirrus below, which is only readable if its edges
         can fade out - and a merge cannot mix a vec3 colour buffer
         with a vec4 one. */
      const n = g.attributes.normal;
      const colors = new Float32Array(g.attributes.position.count * 4);
      for (let v = 0; v < g.attributes.position.count; v += 1) {
        const nl = clamp01(
          (n.getX(v) * sunDir.x + n.getY(v) * sunDir.y + n.getZ(v) * sunDir.z) * 0.5 + 0.5
        );
        const up = clamp01(n.getY(v) * 0.5 + 0.5);
        const t = clamp01(nl * 0.62 + up * 0.38);
        const c = mixRgb(shadeRgb, litRgb, Math.pow(t, 1.35));
        colors[v * 4] = srgb(c[0]);
        colors[v * 4 + 1] = srgb(c[1]);
        colors[v * 4 + 2] = srgb(c[2]);
        colors[v * 4 + 3] = 1;
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 4));

      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * dist, y, Math.sin(a) * dist),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a + Math.PI / 2, rng.range(-0.04, 0.04))),
        new THREE.Vector3(1, 1, 1)
      );
      g.applyMatrix4(m);
      geoms.push(g);
    }

    /* ============================================================
       HIGH CIRRUS

       The 26 shelves above all sit between about 4 and 30 degrees of
       elevation - 330-1250m of altitude at 2.2-5.2km out - so they
       hug the horizon, and every frame in the review set has an
       EMPTY upper sky above them: a bare gradient over the top third
       to half of the picture. On a level whose camera spends most of
       its time looking up a road at a cathedral, that is the single
       largest piece of screen carrying no information.

       What it costs, measured against the same build with it removed
       (scripts/saintfall-perf-probe.mjs, quality=high):
       - draw calls: UNCHANGED (190/114/144/223 across the four
         scenarios). It is merged into the same geometry as the
         shelves, so it shares their draw call and their material
         rather than adding a second transparent pass over the sky.
       - triangles: +19,208, i.e. about +3% of a 620k frame. Flat
         sheets, not volumes.
       - GPU time: no measurable increase; the after-run measured
         FASTER on two of four scenarios, which is run-to-run noise
         on this machine rather than a speed-up.
       - the day cycle is free: `repaintClouds` already walks every
         cloud vertex, and these ride along in it.

       Placed by ELEVATION on a virtual sphere rather than by picking
       an altitude and a distance separately - picking those two
       independently is exactly how the shelves ended up confined to
       a band near the horizon.

       Built as FILAMENTS, and the filaments must be SOFT. The first
       cut used opaque double-tapered strips and they came out as
       pale blades - hard-edged lozenges with points at both ends,
       read on sight as flying wreckage rather than as cloud. Two
       things fix that and both are structural, not tuning: a
       three-vertex cross-section so alpha can fall to zero at each
       edge instead of ending at a polygon boundary, and an
       ASYMMETRIC profile - a rounded head drawn out into a long
       tail, which is what a mare's tail is and what makes the wind
       direction legible.
       ============================================================ */
    /* A DECK AT ALTITUDE, not a shell at fixed radius.

       Two earlier cuts placed bands on a sphere of radius 4200 and
       picked an elevation. Both failed, and the second failure is the
       instructive one: dropping the band to 15-55 degrees put the
       geometry where the camera looks and it STILL did not appear,
       because a horizontal sheet seen at 18 degrees is foreshortened
       by sin(18) = 0.31, and a 100m filament at 4.2km then subtends
       0.4 degrees. It was drawing a hairline.

       Cirrus is a deck: one altitude, running out to the horizon. Fix
       the altitude and scatter the HORIZONTAL distance log-uniformly,
       and the elevation range falls out of the geometry for free -
       near ones sit high overhead, far ones compress toward the
       horizon and converge, which is what a real cirrus field does
       and is worth more than any of it being authored.

       Then size each band by the angle it should SUBTEND rather than
       by metres, and divide the width by sin(elevation) to undo the
       foreshortening. That is the step both earlier cuts were
       missing: at this range, world-space dimensions say nothing
       about whether a thing will be visible. */
    /* 30 bands, and raising it is NOT the lever - measured.

       Several review poses show no cirrus at all, and the obvious
       reading is "too few bands, they are scattered over 360 degrees
       and the camera sees 60". That was tried: 30 -> 44 moved overall
       upper-sky coverage 4.6% -> 5.6% for 39% more triangles, and the
       poses showing none still showed none.

       The real cause is geometric and worth knowing before anyone
       tries again. This deck's reachable elevation is 23.8 to 70.8
       degrees, bounded below by the FAR PLANE: at 2800m of altitude a
       band at 10 degrees would have to sit 15,880m out, and
       camera.far is 11,000m. So cirrus is structurally a
       high-sky feature here, and the poses that show none are the
       ones whose frame contains no sky above ~24 degrees - which is
       also what a real sky does, since looking at the horizon shows
       you the low shelves and not the ice deck overhead.

       If low-elevation cirrus is ever wanted, the lever is a LOWER
       deck altitude (or a farther far plane), not more bands. */
    for (let i = 0; i < 30; i += 1) {
      const alt = rng.range(2800, 4600);
      /* 1600m to 6400m out, log-uniform so the far half of the range
         does not swallow everything.

         The ceiling is set by the FAR PLANE, and the band's own
         length is what decides it - not its centre. camera.far is
         11km; at a multiplier of 5.4 the centre stayed well inside
         that, but a band is up to 36 degrees long, so a band whose
         random yaw pointed its long axis radially away reached
         12,486m at the tip and got sliced by the far plane - a hard
         straight cut across a cloud, at whatever azimuth that band
         happened to land. Solved for the worst case (centre + half
         the longest band, at the highest altitude): 4.0 puts the
         farthest reachable point at 9,926m. */
      const ground = 1600 * Math.pow(4.0, rng());
      const az = rng() * TAU;
      const dist = Math.hypot(ground, alt);
      const sinEl = Math.max(0.20, alt / dist);
      const centre = new THREE.Vector3(
        Math.cos(az) * ground, alt, Math.sin(az) * ground
      );

      const pos = [];
      const idx = [];
      const nrm = [];
      const alpha = [];
      const filaments = rng.int(4, 9);
      // Angular targets, converted to world units at this distance.
      const bandLen = (12 + rng() * 24) * Math.PI / 180 * dist;
      /* Half-width in DEGREES of subtended angle. Work the chain
         through before picking this: a filament ends up at roughly
         0.2x the band's half-width once its own fraction and its
         taper are applied, so a band asking for 1 degree draws a
         3-pixel thread at 1600x900. Asking for 3-7 puts the filament
         at 25-60 pixels across, which is a cloud. */
      const bandHW = (3.0 + rng() * 4.0) * Math.PI / 180 * dist / sinEl;
      // Thin overall. These sit over the brightest part of the sky
      // and any solidity at all reads as a hole punched in it.
      const bandAlpha = rng.range(0.38, 0.70);
      for (let f = 0; f < filaments; f += 1) {
        const segs = rng.int(9, 15);
        const len = bandLen * rng.range(0.55, 1.0);
        const x0 = rng.gauss() * bandLen * 0.16;
        // Filaments spread ACROSS the band, so their spacing has to
        // scale with the band's own width - a fixed 210m offset put
        // every filament of a far band on top of its neighbours.
        const z0 = rng.gauss() * bandHW * 0.85;
        // Every filament in a band shears the same way - they were
        // combed by one wind - but each keeps its own bow.
        const shear = rng.range(0.10, 0.34);
        const hw = bandHW * rng.range(0.34, 0.72);
        const base = pos.length / 3;
        for (let s = 0; s <= segs; s += 1) {
          const t = s / segs;
          /* Head at t~0.15, tail drawn out to t=1. The `pow(1-t,1.5)`
             is the whole silhouette: a long concave decay, so the
             filament thins fast at first and then trails, instead of
             coming to a symmetrical point like a leaf. */
          const head = smoothstep(clamp01(t / 0.16));
          const taper = head * Math.pow(1 - t, 1.5);
          const w = hw * taper * (0.72 + 0.28 * Math.sin(t * 9.1 + f));
          const px = x0 + (t - 0.5) * len;
          const pz = z0 + (t - 0.5) * len * shear
            + Math.sin(t * 2.3 + f * 1.7) * bandHW * 0.35;
          const py = Math.sin(t * 1.9 + f) * 26;
          /* Normals forced UPWARD, with a small tilt for tone along
             the fibre. The shared repaint reads the normal, and a
             thin ice sheet seen from underneath is BRIGHT - given a
             geometric downward normal it would bake at the shadow
             end of the ramp and hang up there as a dark smear. */
          const tilt = 0.30 * Math.sin(t * 5.3 + f * 2.1);
          const nl = Math.hypot(tilt, 1, tilt * 0.6);
          const nx = tilt / nl, ny = 1 / nl, nz = tilt * 0.6 / nl;
          // left edge, spine, right edge - alpha 0 / full / 0
          const a = bandAlpha * taper * (0.55 + 0.45 * Math.sin(t * 6.7 + f * 2.9));
          nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
          alpha.push(0, a, 0);
          pos.push(px, py, pz - w);
          pos.push(px, py, pz);
          pos.push(px, py, pz + w);
        }
        for (let s = 0; s < segs; s += 1) {
          const b = base + s * 3;
          const n2 = b + 3;
          idx.push(b, b + 1, n2 + 1, b, n2 + 1, n2);
          idx.push(b + 1, b + 2, n2 + 2, b + 1, n2 + 2, n2 + 1);
        }
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
      g.setIndex(idx);

      const n = g.attributes.normal;
      const colors = new Float32Array(g.attributes.position.count * 4);
      for (let v = 0; v < g.attributes.position.count; v += 1) {
        const nl = clamp01(
          (n.getX(v) * sunDir.x + n.getY(v) * sunDir.y + n.getZ(v) * sunDir.z) * 0.5 + 0.5
        );
        const up = clamp01(n.getY(v) * 0.5 + 0.5);
        const t = clamp01(nl * 0.62 + up * 0.38);
        const c = mixRgb(shadeRgb, litRgb, Math.pow(t, 1.35));
        colors[v * 4] = srgb(c[0]);
        colors[v * 4 + 1] = srgb(c[1]);
        colors[v * 4 + 2] = srgb(c[2]);
        colors[v * 4 + 3] = alpha[v];
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 4));

      g.applyMatrix4(new THREE.Matrix4().compose(
        centre,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * TAU, 0)),
        new THREE.Vector3(1, 1, 1)
      ));
      geoms.push(g);
    }

    cloudMesh = new THREE.Mesh(mergeGeometries(THREE, geoms), cloudMat);
    cloudMesh.frustumCulled = false;
    clouds.add(cloudMesh);
    repaintClouds();
  }

  /** The geometry never changes with the hour, only the light across
   *  its facets. Repainting one small colour buffer avoids rebuilding
   *  twenty-six cloud shelves every few seconds as the suns move. */
  function repaintClouds() {
    if (!cloudMesh) return;
    const geometry = cloudMesh.geometry;
    const normal = geometry.attributes.normal;
    const colors = geometry.attributes.color;
    if (!normal || !colors) return;
    const night = clamp01(atmos.nightFactor);
    const storm = clamp01(atmos.storm);
    let litRgb = mixRgb([1.0, 0.90, 0.75], [0.35, 0.46, 0.68], night);
    let shadeRgb = mixRgb([0.39, 0.18, 0.32], [0.055, 0.085, 0.20], night);
    litRgb = mixRgb(litRgb, [0.82, 0.58, 0.31], storm * 0.75);
    shadeRgb = mixRgb(shadeRgb, [0.29, 0.18, 0.10], storm * 0.78);
    for (let v = 0; v < normal.count; v += 1) {
      const nl = clamp01(
        (normal.getX(v) * atmos.sunDir.x + normal.getY(v) * atmos.sunDir.y
          + normal.getZ(v) * atmos.sunDir.z) * 0.5 + 0.5
      );
      const up = clamp01(normal.getY(v) * 0.5 + 0.5);
      const t = clamp01(nl * 0.62 + up * 0.38);
      const c = mixRgb(shadeRgb, litRgb, Math.pow(t, 1.35));
      colors.setXYZ(v, srgb(c[0]), srgb(c[1]), srgb(c[2]));
    }
    colors.needsUpdate = true;
  }

  buildClouds();

  /* ------------------------------ update ------------------------------ */

  const sunOffset = new THREE.Vector3();
  const viewDir = new THREE.Vector3();
  const celestialUp = new THREE.Vector3(0, 1, 0);
  const moonBDir = domeUniforms.uMoonBDir.value;
  const moonCDir = domeUniforms.uMoonCDir.value;
  const setCelestialDirection = (target, azimuth, elevation) => {
    const az = azimuth * Math.PI / 180;
    const el = elevation * Math.PI / 180;
    return target.set(
      Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)
    ).normalize();
  };
  let shadowSpan = shadowHalf;

  /* SHADOW BIAS IS MEASURED IN TEXELS, NOT IN METRES.

     Both knobs exist to move a receiver's sample point far enough off
     its own surface that depth-buffer quantisation cannot make it
     shadow itself. The quantisation is one TEXEL wide, so the offset
     that fixes it is a multiple of the texel - and the texel changes
     by a factor of four across the quality tiers and again whenever
     the frustum is retuned. Pinning them to constants means they are
     correct for at most one tier.

     They were pinned at 0.35m and -0.00035, chosen against a 0.2m
     texel, and the cost was not acne - it was the opposite. A
     receiver's sample is pushed along its own NORMAL, so on flat
     sand under a 13-degree sun a 0.35m push moves the shadow-map
     lookup 0.35 / tan(13 deg) = ONE AND A HALF METRES along the
     light. Anything whose shadow is narrower than that simply misses
     itself: the player's own cast shadow measured as a faint smear
     where it should have been a seven-metre silhouette, and no
     amount of shadow-map resolution would have brought it back,
     because the sample was not landing on the caster at all.

     1.45 texels is enough to clear the quantisation on every surface
     in this level (checked against the worst case here, which is not
     a wall but raking dune at a grazing sun); the depth bias is a
     second, smaller nudge expressed as a fraction of the shadow
     camera's own depth RANGE, because that is the space three writes
     it in - a constant there means a different number of metres every
     time the frustum's far plane moves. */
  function applyShadowBias() {
    const texel = (shadowSpan * 2) / Math.max(1, sun.shadow.mapSize.x);
    sun.shadow.normalBias = Math.max(0.02, texel * 1.45);
    const range = Math.max(1, sun.shadow.camera.far - sun.shadow.camera.near);
    sun.shadow.bias = -Math.min(0.0008, (texel * 0.9) / range);
  }
  applyShadowBias();

  const api = {
    group,
    sun,
    skyFill,
    /** 0 is the open desert, 1 is a roof over your head. */
    setUnderground(value) {
      const next = clamp01(Number(value) || 0);
      if (next === subterranean) return subterranean;
      subterranean = next;
      return subterranean;
    },
    underground: () => subterranean,
    dome,
    halo,
    clouds,

    status() {
      const vec = (value) => value.toArray().map((n) => Number(n.toFixed(4)));
      return {
        cycle: atmos.cycleStatus?.() || null,
        primarySun: Number(domeUniforms.uCelestial.value.x.toFixed(4)),
        secondSun: Number(domeUniforms.uCelestial.value.y.toFixed(4)),
        moons: Number(domeUniforms.uCelestial.value.z.toFixed(4)),
        stars: Number(domeUniforms.uStars.value.toFixed(4)),
        secondSunDir: vec(domeUniforms.uSecondSunDir.value),
        moonDirs: [
          vec(domeUniforms.uMoonADir.value),
          vec(domeUniforms.uMoonBDir.value),
          vec(domeUniforms.uMoonCDir.value),
        ],
      };
    },

    /** Called every frame. The ONE place the sun's transform is
     *  written. `updateShadowCamera` deliberately re-derives the
     *  direction from `atmos.sunDir` and never from the light's own
     *  position - reading back a value this function wrote last
     *  frame is how a sun ends up integrating camera motion and
     *  sliding to a grazing angle where nothing has a shadow side. */
    update(dt, camera) {
      const atmosphereChanged = atmos.update(dt);

      dome.position.copy(camera.position);
      dome.scale.setScalar(camera.far * 0.92);
      clouds.position.set(camera.position.x, 0, camera.position.z);
      halo.position.set(camera.position.x, 1150, camera.position.z);

      sun.color.copy(atmos.sunColor);
      sun.intensity = atmos.sunIntensity;
      const dynamicFill = Math.max(1 - (atmos.goldenFactor ?? 1), atmos.storm || 0);
      skyFill.color.copy(atmos.skyHigh).lerp(atmos.skyZenith, 0.34);
      skyFill.groundColor.copy(atmos.groundBounce);
      skyFill.intensity = dynamicFill * atmos.envIntensity * 0.72;
      /* UNDER THE MAP, and this is applied AFTER the two writes above
         rather than folded into them because those two are the sky's
         own contract with the atmosphere and must stay readable as
         such. A room with a roof gets a fraction of the key and
         almost none of the hemisphere - but not zero of either: the
         corrupted reliquary atlas is the richest surface in the game
         and a boss lit by nothing is a silhouette. What is taken away
         here is given back by the chamber's own emissive walls and
         the one shaft of real daylight down the hole. */
      if (subterranean > 0) {
        sun.intensity *= lerp(1, 0.17, subterranean);
        skyFill.intensity *= lerp(1, 0.22, subterranean);
        skyFill.color.lerp(UNDERGROUND_FILL, subterranean * 0.85);
        skyFill.intensity = Math.max(skyFill.intensity,
          subterranean * atmos.envIntensity * 0.10);
      }
      const night = smoothstep(atmos.nightFactor);
      const daylight = clamp01(1 - night);
      domeUniforms.uStars.value = smoothstep(clamp01(night * 1.12));
      domeUniforms.uSunSize.value = lerp(0.0016, 0.010, atmos.storm);
      domeUniforms.uCelestial.value.set(
        daylight,
        daylight * lerp(0.88, 0.54, atmos.duskFactor),
        smoothstep(clamp01(night * 1.15)),
        atmos.cyclePhase
      );
      domeUniforms.uSecondSunDir.value.copy(atmos.sunDir)
        .applyAxisAngle(celestialUp, -0.205).normalize();
      /* The cathedral moon is the actual night key, so its face and
         the world's shadows agree. The smaller moons cross different
         arcs and keep the sky from reading like duplicated decals. */
      domeUniforms.uMoonADir.value.copy(atmos.sunDir);
      const p = atmos.cyclePhase >= 0.58
        ? clamp01((atmos.cyclePhase - 0.58) / 0.42)
        : clamp01((atmos.cyclePhase + 0.42) / 0.42);
      setCelestialDirection(moonBDir, 154 + p * 72, 34 + Math.sin(p * Math.PI) * 18);
      setCelestialDirection(moonCDir, 326 + p * 46, 17 + Math.sin((p + 0.18) * Math.PI) * 10);
      if (atmosphereChanged) repaintClouds();

      /* Shadow frustum rides with the camera, centred AHEAD of it
         along the view direction. Centred on the camera itself,
         half the shadow budget is spent behind the viewer, and a
         landmark 250m down the road - which is where landmarks
         live - falls outside the frustum and casts nothing. */
      camera.getWorldDirection(viewDir);
      const lead = shadowSpan * 0.42;
      const cx = camera.position.x + viewDir.x * lead;
      const cz = camera.position.z + viewDir.z * lead;
      const cy = ctx.terrain ? ctx.terrain.heightAt(cx, cz) : 0;

      // Snap the centre to shadow-texel increments. Without this the
      // whole map's shadows crawl and shimmer as the camera moves,
      // because every frame re-rasterises them against a grid that
      // has shifted by a fraction of a texel.
      const texel = (shadowSpan * 2) / sun.shadow.mapSize.x;
      sun.target.position.set(
        Math.round(cx / texel) * texel, cy, Math.round(cz / texel) * texel
      );
      sunOffset.copy(atmos.sunDir).multiplyScalar(shadowSpan * 2.6);
      sun.position.copy(sun.target.position).add(sunOffset);
      sun.target.updateMatrixWorld();
      return atmosphereChanged;
    },

    /** Rebuild anything that bakes the atmosphere into geometry. */
    refresh() {
      repaintClouds();
    },

    setShadowRadius(half) {
      shadowSpan = half;
      sun.shadow.camera.left = -half;
      sun.shadow.camera.right = half;
      sun.shadow.camera.top = half;
      sun.shadow.camera.bottom = -half;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = half * 6;
      sun.shadow.camera.updateProjectionMatrix();
      applyShadowBias();
    },
    get shadowSpan() { return shadowSpan; },
    get shadowTexel() { return (shadowSpan * 2) / Math.max(1, sun.shadow.mapSize.x); },
    applyShadowBias,
  };

  return api;
}

/* ------------------------------------------------------------------
   Geometry merge. three ships BufferGeometryUtils in addons, but
   pulling an addon in for one function means one more CDN path that
   can fail independently of the engine - and this only ever has to
   handle non-interleaved float attributes, which is a much smaller
   problem than the general case.
   ------------------------------------------------------------------ */

export function mergeGeometries(THREE, geometries) {
  const list = geometries.filter((g) => g && g.attributes.position);
  if (list.length === 0) return new THREE.BufferGeometry();
  if (list.length === 1) return list[0];

  const names = Object.keys(list[0].attributes);
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of list) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }

  const out = new THREE.BufferGeometry();
  const arrays = {};
  for (const name of names) {
    const size = list[0].attributes[name].itemSize;
    arrays[name] = { data: new Float32Array(vertexCount * size), size, offset: 0 };
  }
  const index = vertexCount > 65535
    ? new Uint32Array(indexCount)
    : new Uint16Array(indexCount);

  let vBase = 0;
  let iOff = 0;
  for (const g of list) {
    const count = g.attributes.position.count;
    for (const name of names) {
      const target = arrays[name];
      const src = g.attributes[name];
      if (!src) { target.offset += count * target.size; continue; }
      target.data.set(src.array.subarray(0, count * src.itemSize), target.offset);
      target.offset += count * target.size;
    }
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i += 1) index[iOff + i] = gi[i] + vBase;
      iOff += gi.length;
    } else {
      for (let i = 0; i < count; i += 1) index[iOff + i] = i + vBase;
      iOff += count;
    }
    vBase += count;
  }

  for (const name of names) {
    out.setAttribute(name, new THREE.BufferAttribute(arrays[name].data, arrays[name].size));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}
