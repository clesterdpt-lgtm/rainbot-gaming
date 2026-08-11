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
uniform vec3  uSkyZenith;
uniform vec3  uSkyHigh;
uniform vec3  uSkyHorizon;
uniform vec3  uSkyLow;
uniform vec4  uFog;        // density, heightFalloff, start, sunScatter
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

void main() {
  vec3 rd = normalize(vDir);
  vec3 col = sfSky(rd);

  // --- the disc -----------------------------------------------------
  // Soft-edged rather than a hard circle: at this exposure a hard
  // disc aliases into a polygon the moment the camera turns. Two
  // terms - a bright core and a wide glare skirt - because a disc
  // with no skirt reads as a hole punched in the sky.
  float mu = dot(rd, uSunDir);
  float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.25, mu);
  float glare = pow(max(mu, 0.0), 900.0);
  col += uSunHalo * (disc * 6.5 + glare * 2.2);

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
    uSkyZenith: atmos.uniforms.uSkyZenith,
    uSkyHigh: atmos.uniforms.uSkyHigh,
    uSkyHorizon: atmos.uniforms.uSkyHorizon,
    uSkyLow: atmos.uniforms.uSkyLow,
    uFog: atmos.uniforms.uFog,
    uTimeSF: atmos.uniforms.uTimeSF,
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
  // normalBias is in WORLD units, not texels. At 0.9 on a 0.2m
  // texel it pushed sample points nearly five texels off the
  // surface, which peels the shadow away from every contact and
  // leaves a stippled lattice on flat walls where the offset
  // over- and under-shoots by turns.
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.35;
  const shadowHalf = 300;
  sun.shadow.camera.left = -shadowHalf;
  sun.shadow.camera.right = shadowHalf;
  sun.shadow.camera.top = shadowHalf;
  sun.shadow.camera.bottom = -shadowHalf;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

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
      const n = g.attributes.normal;
      const colors = new Float32Array(g.attributes.position.count * 3);
      for (let v = 0; v < g.attributes.position.count; v += 1) {
        const nl = clamp01(
          (n.getX(v) * sunDir.x + n.getY(v) * sunDir.y + n.getZ(v) * sunDir.z) * 0.5 + 0.5
        );
        const up = clamp01(n.getY(v) * 0.5 + 0.5);
        const t = clamp01(nl * 0.62 + up * 0.38);
        const c = mixRgb(shadeRgb, litRgb, Math.pow(t, 1.35));
        colors[v * 3] = srgb(c[0]);
        colors[v * 3 + 1] = srgb(c[1]);
        colors[v * 3 + 2] = srgb(c[2]);
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * dist, y, Math.sin(a) * dist),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a + Math.PI / 2, rng.range(-0.04, 0.04))),
        new THREE.Vector3(1, 1, 1)
      );
      g.applyMatrix4(m);
      geoms.push(g);
    }

    cloudMesh = new THREE.Mesh(mergeGeometries(THREE, geoms), cloudMat);
    cloudMesh.frustumCulled = false;
    clouds.add(cloudMesh);
  }

  buildClouds();

  /* ------------------------------ update ------------------------------ */

  const sunOffset = new THREE.Vector3();
  const viewDir = new THREE.Vector3();
  let shadowSpan = shadowHalf;
  const api = {
    group,
    sun,
    dome,
    halo,
    clouds,

    /** Called every frame. The ONE place the sun's transform is
     *  written. `updateShadowCamera` deliberately re-derives the
     *  direction from `atmos.sunDir` and never from the light's own
     *  position - reading back a value this function wrote last
     *  frame is how a sun ends up integrating camera motion and
     *  sliding to a grazing angle where nothing has a shadow side. */
    update(dt, camera) {
      atmos.update(dt);

      dome.position.copy(camera.position);
      dome.scale.setScalar(camera.far * 0.92);
      clouds.position.set(camera.position.x, 0, camera.position.z);
      halo.position.set(camera.position.x, 1150, camera.position.z);

      sun.color.copy(atmos.sunColor);
      sun.intensity = atmos.sunIntensity;
      domeUniforms.uStars.value = atmos.time === "night" ? 1 : 0;
      domeUniforms.uSunSize.value = lerp(0.0016, 0.010, atmos.storm);

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
    },

    /** Rebuild anything that bakes the atmosphere into geometry. */
    refresh() {
      buildClouds();
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
    },
    get shadowSpan() { return shadowSpan; },
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
