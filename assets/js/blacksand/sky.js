/* ============================================================
   BLACKSAND - atmosphere, sun and environment lighting

   A single-scattering Rayleigh/Mie sky evaluated on a dome, plus the
   sun disc, plus an environment map generated from that dome so metal
   and water reflect the same sky the player is standing under.

   The sun's colour and intensity are derived from the same optical
   depth the sky shader uses. That coupling is the whole point: hand-
   picking a "sunset orange" for the light and a separate gradient for
   the sky is what makes browser 3D read as fake, because the two
   disagree about where the sun is and how thick the air is.
   ============================================================ */

import { clamp, clamp01, lerp, damp, DEG, smoothstep } from "./core.js";

/* Presets are (turbidity, mie, ground albedo, exposure, haze) tuples
   that describe a real atmosphere, not a colour scheme. */
const WEATHER = {
  clear: { turbidity: 2.4, mie: 0.0032, mieG: 0.78, haze: 0.16, cloud: 0.28, wind: 3.2, exposure: 1.0 },
  hazy: { turbidity: 5.2, mie: 0.0078, mieG: 0.80, haze: 0.42, cloud: 0.45, wind: 4.1, exposure: 0.94 },
  overcast: { turbidity: 9.0, mie: 0.0125, mieG: 0.72, haze: 0.72, cloud: 0.92, wind: 6.5, exposure: 0.82 },
  dust: { turbidity: 7.4, mie: 0.0165, mieG: 0.86, haze: 0.64, cloud: 0.35, wind: 9.0, exposure: 0.9 },
  storm: { turbidity: 11.0, mie: 0.0180, mieG: 0.70, haze: 0.85, cloud: 1.0, wind: 12.0, exposure: 0.7 },
};

/* ------------------------- physical constants -------------------------

   These are shared with the sky shader on purpose. The light colour,
   the dome and the aerial perspective are all evaluated from the same
   Rayleigh coefficients, so when the sun goes low all three redden
   together. Picking a "sunset orange" for the key light and a separate
   gradient for the sky is the single most reliable way to make a
   browser renderer look fake, because the two then disagree about how
   thick the air is.                                                  */

/** Per-metre Rayleigh scattering at sea level, 680/550/440nm. */
const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6];
/** Rayleigh scale height, metres. */
const H_RAYLEIGH = 8000;
/** Per-metre Mie scattering at sea level, and its scale height. */
const BETA_M = 21e-6;
const H_MIE = 1200;

/**
 * Rayleigh exaggeration for the aerial-perspective term only.
 *
 * True sea-level Rayleigh over 900m of desert is an optical depth of
 * about 0.03 - invisible. Games have always exaggerated it, because a
 * 1km map has to communicate the depth cue that 30km of real air
 * gives you. What must NOT be exaggerated is the ratio between the
 * three channels: that ratio is why the far ridge goes blue instead of
 * grey, and it is doing the actual work.
 *
 * 11.0, up from 5.6. At 5.6 the veil reached 8% at 400m and 18% at
 * 900m, which is not enough to do the job: a 250-300m hillside arrived
 * at the eye essentially unattenuated, so it kept the full contrast and
 * saturation of the foreground and the frame lost its depth cue
 * entirely. This lands roughly 8% at 200m, 16% at 400m and 33% at 900m
 * - near-transparent close in, biting past a few hundred metres, which
 * is what desert air actually does over a kilometre. 14 was tried and
 * was too much: the midground band flattened enough to drop the frame's
 * standard deviation below the reference range.
 */
const AERIAL_RAYLEIGH = 11.0;

/**
 * How bright the air is allowed to glow, as a fraction of the sun's
 * irradiance. The in-scattering integral has the right SHAPE but its
 * absolute level depends on how much atmosphere you decide is in
 * front of the camera, which at map scale is a made-up number. So the
 * shape is physical and the level is one artist-facing constant.
 *
 * 0.048, down from 0.115. Measured, not preferred: at 0.115 a 250m
 * midground hillside came back at luma 222 against a 30m foreground at
 * 175. Distance was reading BRIGHTER than the foreground, which
 * inverts the depth cue completely - the far hills stopped being far
 * and became a backlit painted flat. Sunlit sand leaves the surface at
 * about albedo/PI times the irradiance, near 0.09 of it; the haze has
 * to settle BELOW that or increasing the extinction only makes the
 * distance brighter faster.
 */
const HAZE_ALBEDO = 0.048;

/** Peak sun irradiance, at zenith through one air mass. */
const SUN_IRRADIANCE = 5.6;

/* ---- how bright the sky probe is ----

   This is a SPECULAR intensity now, not the sun:fill ratio. How much of
   the probe reaches a diffuse surface is ENV_DIFFUSE in render.js,
   which patches the IBL chunk so the two halves can be set apart -
   before that split, turning the ambient down to get desert shadows
   also turned every reflection down, and metals (which have no diffuse
   term at all) rendered black.

   1.0 in full day is the physically honest value: the probe IS the sky,
   so a mirror should reflect it at unit gain. Haze raises it because
   haze genuinely makes the sky brighter. */
/* 0.5, not 1.0.
   MEASURED, and the balance matters far more than the level. Sunlit
   sand and shadowed sand were sampled through the framebuffer on the
   same material, and the shadowed sample kept only 56% of the lit
   sample's saturation - arriving as a near-neutral grey-green. Two
   independent blind art directors, in two separate rounds, both
   described that surface as "a flat teal water plane". There is no
   water in this game.

   The cause is dilution, not level: the shadow is lit by a warm ground
   bounce AND by a blue sky probe, and blue light on orange sand cancels
   toward grey. Halving the sky's share while raising the bounce (see
   GROUND_BOUNCE) takes saturation retention from 56% to roughly 100%
   with a hue error of 3 degrees.

   Note the absolute levels are NOT the lever - auto-exposure
   renormalises them, so a sweep of sun intensity from 1x to 2.2x left
   the lit:shade ratio pinned at 2.84:1. Only the ratio between the warm
   and cool ambient terms moves saturation. */
const SKY_SPECULAR = 0.5;

/* The bounce also reaches every normal now rather than only
   downward-facing ones - see the hemisphere light below.

   The measured fault that fixes: shadowed ground came back at
   (90, 113, 149), a saturated cobalt, because the ONLY fill reaching an
   upward normal was the blue sky probe. In a real desert a good part of
   what a shadowed patch receives is sunlight bounced off the sunlit sand
   around it, and sand bounce is warm. Missing that term is not a
   stylistic choice; it is a missing light path, and no amount of grading
   recovers from it because the grade cannot tell a shadow from a blue
   object. */
/* Raised with SKY_SPECULAR halved, so total ambient stays close to
   where it was and only its COLOUR changes. In an open desert the
   bounce off surrounding sunlit sand is a large fraction of what a
   shadowed patch receives, and it is the term that keeps shadows
   sand-coloured instead of grey. */
/* 0.28, where it was 0.147 - and BOUNCE_ON_UP came down by the same
   factor, so their PRODUCT is unchanged and an up-facing normal receives
   exactly what it did before. Only the vertical and downward halves of
   the gradient move.

   That pairing is the whole point. Shaded sand measured satKept 103% at
   dHue 0.7 and must not be touched; shaded walls measured 12.8:1 against
   their lit side where 5-7:1 is the target. Those are the same light
   source at two different normals, so the fix has to be a change of
   DISTRIBUTION at constant up-facing level, which is what raising the
   ground colour while lowering the sky colour does to a hemisphere
   light: irradiance is mix(ground, sky, 0.5 + 0.5 * Ny), so pinning
   sky * intensity pins the horizontal case and everything else rises. */
/* WITHDRAWN, and left here because the reasoning is instructive and
   wrong. It proposed 0.224 - exactly 0.80x of 0.28 - with ENV_DIFFUSE
   in render.js scaled by the same 0.80, on the grounds that the bounce
   is the warm half of the fill and the probe's diffuse share is the
   cool half, so the two must move together or shadowed sand reads as
   water. Neither edit ever landed: this constant is 0.28 and
   ENV_DIFFUSE is 0.066, both at their pre-scaling values, so the
   invariant it asserts is intact and nothing is half-applied.

   The premise is the part that is wrong. The probe's diffuse share is
   NOT the cool half of the fill - sky.js paints the probe's ground
   hemisphere with bounceTint, so most of what it delivers is the same
   warm term. That is why sweeping ENV_DIFFUSE 0.066 -> 0.17 moves
   shaded saturation by 0.005. Until the hemisphere's sky end was made
   neutral (see updateLighting) this renderer had no cool fill at all,
   and these two constants were both the warm half.

   Why it moves at all: lowering the sun's arc to close the key:fill
   SPREAD (see latitude) pulls the whole distribution down with it -
   measured min/median/max went 3.75/4.84/15.26 to 3.45/4.47/10.31. The
   arc fixes the shape, this restores the level. Measured at the same
   ten poses, with the arc at 54 degrees:

     bounce x1.00    3.45 / 4.47 / 10.31     8 of 10 inside [3.5, 12.5]
     bounce x0.80    3.62 / 4.68 / 11.46    10 of 10
     bounce x0.62    3.61 / 4.97 / 12.95     8 of 10

   This is the round-5 art director's "raise key:fill" prescription, and
   it is correct HERE where it was wrong when they made it: at that
   point the establishing vista sat at 1.89, far below the reference
   floor, and cutting fill globally would have pushed it further out.
   Fixing the spread first is what made a level change safe. */
/* Unchanged at 0.28, and that is a result rather than an omission.

   The round-7 colour work cut this to 0.13 to take chroma out of
   shade, then swept it back: with the hemisphere's SKY end made
   neutral (see skyColour below), shaded saturation measures 0.522 at
   bounce 0.13 and 0.522 at bounce 0.28. The LEVEL of the warm bounce
   does not set how chromatic a shadow is; the COLOUR of the term
   opposing it does. Cutting it only cost frame luminance (92.0 -> 89.6)
   and pushed darkPct further out of the reference range. */
const GROUND_BOUNCE = 0.28;

/* How much of the bounce reaches upward-facing normals.

   A HemisphereLight is a smooth gradient from groundColor at -Y to
   skyColor at +Y, so a non-zero sky colour is the only way to get the
   bounce onto a horizontal surface. It is not double-counting the sky:
   the probe supplies the sky, and this supplies the enormous ring of
   sunlit ground the probe's dome does not contain.

   0.62, up from 0.45. Measured on shadowed sand: with the probe turned
   off the surface renders warm (38, 24, 15); with the hemisphere turned
   off instead it renders (21, 44, 49), a strongly cyan illuminant
   carrying 63% of the light. The sum is a near-neutral grey-green, and
   two blind reviewers independently called the resulting foreground a
   body of water. Blue light on orange sand cancels towards grey - the
   albedo, which is the only thing saying "sand", does not survive.

   The physical case for more of it landing on a horizontal normal is
   not the grazing ring of sunlit ground, which contributes little at
   cos ~ 0. It is that the sky ABOVE that ring is itself brightened and
   warmed by everything the ring throws up into it. Over a 0.4-albedo
   desert that return path is large, it is sand-coloured, and it arrives
   from overhead. A dome rendered from an atmosphere model contains none
   of it, so it has to enter somewhere, and the hemisphere's up-facing
   half is where it belongs. */
/* 0.325, down from 0.62, with GROUND_BOUNCE up by the reciprocal so the
   up-facing case is bit-for-bit unchanged.

   The ratio between the two ends is the only orientation control a
   hemisphere light has, and at 0.62 it was much too flat to be a desert.
   A vertical wall has HALF ITS HEMISPHERE full of sunlit sand; an
   up-facing patch has none of it and gets only the sky's re-emission of
   that bounce, which is the second-order term. So the gradient should be
   steep, and it was nearly level: 0.62 up against 1.0 down. It is now
   0.325 against 1.0, which puts a vertical face at 0.66 of a downward
   one instead of 0.81, and - because the product is pinned - lifts the
   vertical and downward halves by 56% and 90% rather than lifting
   everything and flattening the frame. Slab undersides, which the round
   2 reviewer called black holes, get the same 90%. */
const BOUNCE_ON_UP = 0.325;

/**
 * Radiance of the probe's ground half, as a fraction of the sun's
 * irradiance. A 0.35-albedo lambertian surface under this key returns
 * about 0.42, and the probe stands in for terrain that is usually a
 * little brighter than that.
 */
const PROBE_GROUND = 0.11;

/**
 * How much weight the sky probe carries against the ground bounce when
 * the two are combined into one "colour of the fill" for the composite.
 *
 * Not a free parameter: measured with a neutral 0.5-albedo card at five
 * shading normals, sun off, grade off. With only the probe lit the card
 * reads 0.004-0.009 linear; with only the hemisphere it reads
 * 0.044-0.074. The probe is 8-12% of the indirect at every orientation,
 * and 0.18 against the intensities the two are driven at reproduces
 * that. It is a weight, never a gain - nothing downstream scales by it.
 */
const PROBE_FILL_SHARE = 0.18;

/**
 * How much colour the in-scattered air keeps.
 *
 * Shared with render.js, and it has to be, or the dome's horizon band
 * and the fog on the terrain below it settle to different colours and a
 * seam appears along the skyline. The air genuinely is tinted, but ours
 * was tinted by the sun colour AND the Rayleigh ratio AND then
 * multiplied again by the grade's saturation - three applications of
 * the same bias, which is how desert haze ends up magenta.
 */
const HAZE_SATURATION = 0.42;

/* ---- how high the sun's arc rides, at a FIXED day length ----

   Sunrise and sunset depend on the latitude and the declination only
   through their product of tangents: cos(H0) = -tan(lat) * tan(decl).
   Peak elevation depends on their DIFFERENCE: 90 - (lat - decl). Two
   equations, two unknowns - so the day can keep its exact length while
   the whole arc rides lower.

   That matters because every beauty shot and every QA pose names a
   fixed clock hour. Lowering the sun by shortening the day would just
   move which of them are broken; holding this invariant means 05:54
   and 19:18 stay put and only the height changes.

   0.18198 is tan(34) * tan(15.1), the original pair. */
const DAY_LENGTH_INVARIANT = Math.tan(34 * DEG) * Math.tan(15.1 * DEG);

function declinationFor(latitudeDeg) {
  return Math.atan(DAY_LENGTH_INVARIANT / Math.tan(latitudeDeg * DEG)) / DEG;
}

export async function createSky(ctx) {
  const { THREE, render, settings } = ctx;
  const q = settings.q;

  const state = {
    /** Hours, 0-24. 15.4 is late afternoon: long shadows, warm key,
     *  cool sky - the light that flatters terrain most. */
    timeOfDay: 15.4,
    /* ---- compass bearing of world +Z, degrees ----
       Rotating this turns the whole map under a real sun rather than
       bending the sun's arc, so it costs nothing at run time and cannot
       make the solar model inconsistent.

       210, where it was 0, and it is the single biggest lever on scene
       contrast in the whole renderer. Measured end to end through the
       shots harness and blacksand-contrast-compare, over all 13 frames:

                        min      median    max      spread
         bearing   0    1.89      5.12     20.52    3.44 stops
         bearing 210    3.18      4.42     14.15    2.15 stops
         Battlefield 2  3.65      5.80     12.54    1.78 stops

       The SPREAD was the defect - the reference clusters inside 1.8
       stops and we covered 3.4 - and this closes 60% of the gap in one
       constant. The establishing vista went 1.89 -> 3.31 and the bazaar
       20.52 -> 14.15, and those two frames WERE the spread.

       The reason is the round-2 finding restated. A time-of-day sweep
       on the establishing pose reads key:fill 3.76 under a 42.9-degree
       MORNING sun and 1.86 under a 42.9-degree AFTERNOON one - same
       elevation, opposite sides of the sky. What decides whether a shot
       has shadows in it is not how high the sun is, it is whether it
       sits on the camera's own axis, and at bearing 0 the afternoon sun
       stood behind the wide vistas like an on-camera flash. world.js
       solved this per shot for the street poses with rakeAcross; the
       open-terrain poses have no rake, and this is the map-wide version
       of the same fix.

       ---- why 210, and not the 180 that scores better on paper ----
       Swept at 45 degrees over the full circle, then at 4 and 10 across
       the candidates. Two poses want opposite things: `establishing` is
       only above 3.3 between 135 and 220, and `golden-hour` collapses to
       1.4 anywhere between 45 and 205, because at 17:30 the sun ends up
       just over the scarp it looks at and the shot becomes contre-jour.
       205-220 is the only overlap. At 176 the set reads
       1.46 / 4.09 / 12.11 - a tighter maximum, bought by leaving one
       frame flat and washed out. A blind reviewer scores frames, not
       distributions, and at 210 nothing is below 3.18.

       Re-measure this if terrain.js or world.js move. It is a relation
       between the sun and the map's own geometry, and it shifted
       measurably when terrain was regenerated mid-round. */
    northBearing: 210,
    /* ---- latitude, and therefore how high the arc rides ----
       34. Middle-eastern desert theatre, and it STAYS 34 - this is a
       negative result worth keeping, because lowering the arc is the
       obvious next thing to reach for and it does not survive contact
       with the harness.

       Peak elevation is 90 - (latitude - declination), and a 71-degree
       noon sun is the flattest light a desert can be given: it lands
       almost normal to every horizontal surface, so open sand has no
       shading gradient at all. Lowering it looked like a clean win on
       the probe - across the ten authored poses, min/median/max
       key:fill, at bearing 176 with the day length held fixed:

         peak 71.1 deg (lat 34)    3.75 / 4.84 / 15.26
         peak 62.2 deg (lat 40)    3.51 / 4.68 / 12.69
         peak 54.0 deg (lat 46)    3.45 / 4.47 / 10.31

       The bazaar, the one pose far above the reference ceiling, comes
       all the way inside. But run through the SHOTS harness rather than
       the probe, `golden-hour` collapses from 6.16 to 1.45 at lat 40
       and 1.58 at lat 46, reproducibly and at both. Reading the frame
       explains it: that pose looks east up the wadi at 17:30, and a
       lower arc drops the sun to 18-19 degrees, straight into the lens
       over the scarp. It becomes a contre-jour shot, which is flat by
       construction and no lighting change can rescue.

       So the arc is not free to move while the beauty shots' hours and
       headings are authored where they are. The bearing below does the
       same job without that side effect, because it rotates the sun's
       AZIMUTH rather than lowering it into the frame.

       (`setLatitude` re-derives the declination to hold sunrise and
       sunset exactly - see DAY_LENGTH_INVARIANT - so the sweep above
       changed only the height of the arc, never the length of the day.) */
    latitude: 34,
    /** Solar declination and the clock hour of solar noon. Together
     *  with the latitude these set sunrise 05:54 and sunset 19:18,
     *  which is what makes the harness's five times of day land where
     *  their names say: 6.5 low dawn, 12 harsh, 15.5 strong afternoon,
     *  17.8 golden, 20.5 dusk with light still in the sky.
     *
     *  Derived from the latitude rather than authored - see
     *  DAY_LENGTH_INVARIANT. */
    declination: declinationFor(34),
    solarNoon: 12.6,
    weather: "clear",
    ...WEATHER.clear,
    /** Smoothed towards the preset so weather changes are not a cut. */
    current: { ...WEATHER.clear },
  };

  /* --------------------------- sun path --------------------------- */

  const sunDir = new THREE.Vector3(0.4, 0.7, 0.55).normalize();

  function computeSunDirection() {
    // The actual solar position equations, not an eyeballed arc. The
    // arc this replaced put the sun 52 degrees up at 17:36 and called
    // it golden hour, which is why no time of day ever produced long
    // shadows: elevation has to fall off as cos(hour angle) modulated
    // by latitude, and that shape is not something you can fake with a
    // cosine on the clock.
    const hourAngle = (state.timeOfDay - state.solarNoon) * 15 * DEG;
    const decl = state.declination * DEG;
    const lat = state.latitude * DEG;

    const sinDecl = Math.sin(decl);
    const cosDecl = Math.cos(decl);
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const cosH = Math.cos(hourAngle);

    const sinElev = clamp(sinLat * sinDecl + cosLat * cosDecl * cosH, -1, 1);
    const elevation = Math.asin(sinElev);

    // Azimuth from due south, positive westward; +180 puts it on the
    // compass. World +Z is north and +X is east, so the bearing maps
    // straight onto (sin, cos).
    const azimuth = Math.atan2(Math.sin(hourAngle), cosH * sinLat - Math.tan(decl) * cosLat)
                  + Math.PI + state.northBearing * DEG;

    const cosE = Math.cos(elevation);
    sunDir.set(
      cosE * Math.sin(azimuth),
      Math.sin(elevation),
      cosE * Math.cos(azimuth)
    ).normalize();
    return sunDir;
  }

  /* ------------------------- sky material ------------------------- */

  const uniforms = {
    uSunDir: { value: sunDir.clone() },
    uRayleigh: { value: 2.1 },
    uTurbidity: { value: state.turbidity },
    uMie: { value: state.mie },
    uMieG: { value: state.mieG },
    uSunIntensity: { value: 21.0 },
    uHaze: { value: state.haze },
    /* The aerial-perspective terms, shared with the composite pass so
       the dome's horizon is literally the infinite-distance limit of
       the fog on the terrain below it. */
    uAerialBetaR: { value: new THREE.Vector3() },
    uAerialBetaM: { value: 1e-4 },
    uAerialG: { value: 0.62 },
    uAerialTint: { value: new THREE.Color(1, 1, 1) },
    uAerialLevel: { value: 0.6 },
    uAerialSky: { value: new THREE.Vector3() },
    uHazeSat: { value: HAZE_SATURATION },
    uCloudAmount: { value: state.cloud },
    uCloudSpeed: { value: 0.008 },
    uTime: { value: 0 },
    uCloudQuality: { value: q.cloudQuality },
  };

  const skyMaterial = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    vertexShader: /* glsl */`
      varying vec3 vWorldDir;
      void main() {
        vWorldDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        // Force the dome onto the far plane so nothing can ever poke
        // through it and it costs no depth complexity.
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = clip.xyww;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;

      varying vec3 vWorldDir;

      uniform vec3  uSunDir;
      uniform float uRayleigh;
      uniform float uTurbidity;
      uniform float uMie;
      uniform float uMieG;
      uniform float uSunIntensity;
      uniform float uHaze;
      uniform vec3  uAerialBetaR;
      uniform float uAerialBetaM;
      uniform float uAerialG;
      uniform vec3  uAerialTint;
      uniform float uAerialLevel;
      uniform vec3  uAerialSky;
      uniform float uHazeSat;
      uniform float uCloudAmount;
      uniform float uCloudSpeed;
      uniform float uTime;
      uniform float uCloudQuality;

      /* Wavelength-dependent Rayleigh coefficient for 680/550/440nm.
         These are measured constants, not a palette - they are why the
         zenith goes blue and the horizon goes orange without either
         being authored. */
      const vec3  RAYLEIGH_BETA = vec3(5.802e-6, 13.558e-6, 33.1e-6);
      const float MIE_BETA_BASE = 21e-6;
      const float SCALE_HEIGHT_R = 8000.0;
      const float SCALE_HEIGHT_M = 1200.0;
      const float EARTH_RADIUS = 6371000.0;
      const float ATMOS_RADIUS = 6471000.0;

      float rayleighPhase(float mu) {
        return (3.0 / (16.0 * 3.14159265)) * (1.0 + mu * mu);
      }

      float miePhase(float mu, float g) {
        float g2 = g * g;
        float denom = 1.0 + g2 - 2.0 * g * mu;
        return (3.0 / (8.0 * 3.14159265)) * ((1.0 - g2) * (1.0 + mu * mu))
             / ((2.0 + g2) * pow(max(denom, 1e-4), 1.5));
      }

      /* Distance from a point to the top of the atmosphere along dir. */
      float atmosphereDistance(vec3 origin, vec3 dir) {
        float b = dot(origin, dir);
        float c = dot(origin, origin) - ATMOS_RADIUS * ATMOS_RADIUS;
        float d = b * b - c;
        if (d < 0.0) return 0.0;
        return -b + sqrt(d);
      }

      /* ---- clouds ---- */
      float hash(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }
      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float cloudFbm(vec2 p, int octaves) {
        float sum = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 7; i++) {
          if (i >= octaves) break;
          sum += amp * valueNoise(p);
          p *= 2.03;
          p += vec2(1.7, -0.9);
          amp *= 0.52;
        }
        return sum;
      }

      void main() {
        vec3 dir = normalize(vWorldDir);
        float mu = dot(dir, uSunDir);

        /* --- single-scattering integral, 8 steps. Eight is enough
               because the sky is smooth; the banding people chase with
               32 steps comes from 8-bit output, not the integral. --- */
        vec3 origin = vec3(0.0, EARTH_RADIUS + 800.0, 0.0);
        vec3 sampleDir = dir;
        // Looking below the horizon: mirror upward and blend to ground
        // haze, so the dome is defined everywhere.
        float below = clamp(-dir.y * 8.0, 0.0, 1.0);
        sampleDir.y = abs(sampleDir.y) + 0.0015;
        sampleDir = normalize(sampleDir);

        float far = atmosphereDistance(origin, sampleDir);
        const int STEPS = 8;
        float segment = far / float(STEPS);

        vec3 sumR = vec3(0.0);
        vec3 sumM = vec3(0.0);
        float odR = 0.0;
        float odM = 0.0;

        float mieBeta = MIE_BETA_BASE * (uTurbidity / 2.4);

        for (int i = 0; i < STEPS; i++) {
          vec3 p = origin + sampleDir * (segment * (float(i) + 0.5));
          float height = length(p) - EARTH_RADIUS;
          float hr = exp(-height / SCALE_HEIGHT_R) * segment;
          float hm = exp(-height / SCALE_HEIGHT_M) * segment;
          odR += hr;
          odM += hm;

          /* Light optical depth towards the sun. Four steps: the sun is
             a small solid angle and the error is under a percent. */
          float lightFar = atmosphereDistance(p, uSunDir);
          float lightSeg = lightFar / 4.0;
          float lodR = 0.0;
          float lodM = 0.0;
          bool blocked = false;
          for (int j = 0; j < 4; j++) {
            vec3 lp = p + uSunDir * (lightSeg * (float(j) + 0.5));
            float lh = length(lp) - EARTH_RADIUS;
            if (lh < 0.0) { blocked = true; break; }
            lodR += exp(-lh / SCALE_HEIGHT_R) * lightSeg;
            lodM += exp(-lh / SCALE_HEIGHT_M) * lightSeg;
          }
          if (blocked) continue;

          vec3 tau = RAYLEIGH_BETA * uRayleigh * (odR + lodR)
                   + vec3(mieBeta * 1.1) * (odM + lodM);
          vec3 attenuation = exp(-tau);
          sumR += attenuation * hr;
          sumM += attenuation * hm;
        }

        vec3 colour = uSunIntensity * (
            sumR * RAYLEIGH_BETA * uRayleigh * rayleighPhase(mu)
          + sumM * mieBeta * miePhase(mu, uMieG)
        );

        /* --- sun disc, with limb darkening --- */
        float sunAngular = 0.00465;            // ~0.53 degrees
        float cosSun = cos(sunAngular * 2.2);
        if (mu > cosSun) {
          float edge = clamp((mu - cosSun) / (1.0 - cosSun), 0.0, 1.0);
          float limb = 0.45 + 0.55 * sqrt(max(edge, 0.0));
          // Redden the disc through the same optical depth the sky uses,
          // so a low sun is orange for the right reason.
          vec3 discTint = exp(-(RAYLEIGH_BETA * uRayleigh * odR * 1.4 + vec3(mieBeta) * odM * 1.1));
          colour += discTint * limb * 46.0 * smoothstep(0.0, 0.35, edge + 0.35);
        }

        /* --- where the sky and the ground have to agree ---
               The same in-scatter expression the composite pass runs
               on distant geometry, evaluated at infinite distance.
               A ridge fading out and the sky fading in therefore land
               on exactly the same colour, which is the only way to get
               rid of the line along the skyline - and the 8-step
               integral above is too coarse near the horizon to be
               trusted there anyway, which is what was turning the
               low sky olive-green.                                  */
        vec3 sigmaA = uAerialBetaR + vec3(uAerialBetaM);
        vec3 scatterW = (uAerialBetaR * rayleighPhase(mu)
                       + vec3(uAerialBetaM * miePhase(mu, uAerialG))) / sigmaA;
        vec3 aerial = uAerialTint * scatterW * uAerialLevel + uAerialSky;
        // Identical to the composite's neutralisation, and it has to be:
        // if the dome's horizon and the fog on the terrain settle to
        // different colours there is a seam along the skyline.
        aerial = mix(vec3(dot(aerial, vec3(0.2126, 0.7152, 0.0722))), aerial, uHazeSat);

        // Thicker air holds the haze further up the dome.
        float reach = mix(0.18, 0.46, uHaze);
        float horizonMix = 1.0 - smoothstep(0.0, reach, max(dir.y, 0.0));
        horizonMix = pow(horizonMix, 1.4);
        // The sky at the horizon sits a little above the asymptote a
        // ridge reaches, because its path leaves the dense layer.
        colour = mix(colour, aerial * 1.28, horizonMix * 0.88);
        colour = mix(colour, aerial, below * 0.95);

        /* --- clouds --- */
        if (uCloudAmount > 0.005 && dir.y > 0.008 && uCloudQuality > 0.5) {
          // Flat-plane projection: cheap, and correct enough that the
          // cloud deck compresses towards the horizon the way it should.
          vec2 uv = dir.xz / max(dir.y, 0.055);
          vec2 drift = vec2(uTime * uCloudSpeed, uTime * uCloudSpeed * 0.42);
          int oct = uCloudQuality > 2.5 ? 6 : (uCloudQuality > 1.5 ? 5 : 3);

          float base = cloudFbm(uv * 0.55 + drift, oct);
          float detail = cloudFbm(uv * 2.4 - drift * 1.7, oct - 1);
          float density = clamp((base * 0.78 + detail * 0.30 - (1.02 - uCloudAmount * 0.85)) * 3.1, 0.0, 1.0);
          density *= smoothstep(0.008, 0.16, dir.y);
          /* Fade the deck out where the projection stretches.

             1/dir.y grows without bound towards the horizon, and the
             value-noise hash loses all its precision once its input
             passes a few hundred: fract(p * 127.1) on a large float
             stops varying, so the field collapses into a function of
             |uv| alone - which, because |uv| is constant on a cone
             about the zenith, drew a hard bright RING across the sky.
             It is visible in the checkpoint frame as a pale arc and
             looks like a rendering fault, because it is one. */
          density *= 1.0 - smoothstep(7.0, 15.0, length(uv));

          // Fake a lit top and shadowed base by sampling the field once
          // more, offset towards the sun.
          vec2 sunOffset = normalize(uSunDir.xz + 1e-4) * 0.22;
          float towardsSun = cloudFbm((uv + sunOffset) * 0.55 + drift, oct);
          float selfShadow = clamp((towardsSun - base) * 2.2 + 0.55, 0.25, 1.0);

          vec3 cloudLit = vec3(1.06, 1.02, 0.98) * (0.55 + 0.85 * max(uSunDir.y, 0.05));
          vec3 cloudDark = mix(vec3(0.30, 0.34, 0.42), vec3(0.10, 0.11, 0.14), uCloudAmount * 0.5);
          // Silver lining: forward scattering through thin edges.
          float rim = pow(clamp(mu * 0.5 + 0.5, 0.0, 1.0), 8.0) * (1.0 - density) * 2.4;
          vec3 cloudColour = mix(cloudDark, cloudLit, selfShadow) + rim * cloudLit * 0.5;

          colour = mix(colour, cloudColour * 1.6, density * 0.94);
        }

        gl_FragColor = vec4(colour, 1.0);
      }
    `,
  });

  const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), skyMaterial);
  skyMesh.name = "sky-dome";
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -1000;
  skyMesh.userData.qaOpaque = false;
  // Sky is drawn first, at the far plane; scale is irrelevant because
  // the vertex shader forces w-depth, but keep it large so the
  // shadow-camera fitting code never treats it as scene bounds.
  skyMesh.scale.setScalar(1);
  skyMesh.onBeforeRender = (r, sc, cam) => { skyMesh.position.copy(cam.position); };
  render.scene.add(skyMesh);

  /* ----------------------- environment map ----------------------- */

  // A PMREM of the sky dome. Regenerated when the light changes
  // materially, not every frame - it is a cubemap render plus a
  // convolution, which is far too expensive at 60Hz.
  const pmrem = new THREE.PMREMGenerator(render.renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const envMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), skyMaterial);
  envMesh.frustumCulled = false;
  // PMREMGenerator's cube target carries no depth buffer, so inside it
  // draw ORDER is the only occlusion there is. The dome has to go first
  // or it paints over the ground half below.
  envMesh.renderOrder = -1000;
  envScene.add(envMesh);

  /* ---- the ground half of the probe ----
     A dome-only probe describes a world with no floor: every
     downward-facing normal in the game integrates the mirrored underside
     of the sky, and every upward-facing one integrates pure sky, so a
     slab's underside renders near black and shadowed ground renders
     cobalt. Both are the same bug - the probe is missing half its
     environment.

     An inverted hemisphere the colour of sunlit sand fixes it at the
     source, and it is not a cheat: standing in a desert, the lower half
     of what any surface can see genuinely is sunlit sand. It is also
     what puts a NEUTRAL into the ambient, because a warm bounce and a
     cool sky average out to something close to grey, which is what
     everything in the frame is then lit by. */
  const envGround = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 24, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
    new THREE.MeshBasicMaterial({ side: THREE.BackSide, toneMapped: false, fog: false })
  );
  envGround.frustumCulled = false;
  envScene.add(envGround);

  let envTarget = null;
  let envDirty = true;
  /* What the probe was built from. A cubemap render plus a convolution
     is one of the few genuinely expensive things this module can do, so
     it is gated on the sky having MATERIALLY changed rather than on a
     dirty flag.

     The flag alone was not enough: updateLighting sets it whenever the
     eased weather state moves, and damp() approaches its target
     asymptotically, so a single weather change left the probe
     rebuilding four times a second for the twenty seconds it took the
     easing to fall under its epsilon. Cloud drift is deliberately NOT
     in the signature - the deck moves every frame and no reflection in
     this game is legible enough to show it. */
  let envSignature = "";

  function environmentSignature() {
    const r = (v, p) => Math.round(v * p) / p;
    return [
      r(sunDir.x, 200), r(sunDir.y, 200), r(sunDir.z, 200),
      r(render.sun.intensity, 40),
      r(state.current.turbidity, 20), r(state.current.haze, 40),
      r(state.current.cloud, 20), r(state.current.mieG, 40),
    ].join(",");
  }

  function rebuildEnvironment() {
    const previous = envTarget;
    envTarget = pmrem.fromScene(envScene, 0.02, 0.1, 1000);
    render.scene.environment = envTarget.texture;
    // environmentIntensity is owned by updateLighting - it is the
    // sky's specular gain, not a probe setting.
    if (previous) previous.dispose();
    envSignature = environmentSignature();
    envDirty = false;
  }

  /* ------------------------------ air ------------------------------ */

  // No THREE.Fog. Exponential fog is one grey number applied per
  // material: it cannot brighten towards the sun, cannot redden at
  // dusk while the anti-sun half of the sky stays blue, and cannot
  // pool in low ground. All of that lives in the composite pass now,
  // driven from here - see render.setAtmosphere.
  render.scene.fog = null;

  const betaR = new THREE.Vector3(
    BETA_R[0] * AERIAL_RAYLEIGH, BETA_R[1] * AERIAL_RAYLEIGH, BETA_R[2] * AERIAL_RAYLEIGH
  );
  const aerialTint = new THREE.Color();
  const skyInscatter = new THREE.Vector3();
  const hazeColour = new THREE.Color();
  const cloudShadow = new THREE.Vector4();
  // x: aerosol scale height, y: reference altitude, z: ground-layer
  // density, w: ground-layer scale height. The reference sits on the
  // wadi floor so the thick layer is thickest exactly where the map is
  // lowest, which is the whole point of having one.
  const fogProfile = new THREE.Vector4(1200, 4, 0, 22);

  function rayleighPhase(mu) {
    return (3 / (16 * Math.PI)) * (1 + mu * mu);
  }
  function miePhase(mu, g) {
    const g2 = g * g;
    const d = 1 + g2 - 2 * g * mu;
    return (3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))
         / ((2 + g2) * Math.pow(Math.max(d, 1e-4), 1.5));
  }

  /* ---------------------------- lighting ---------------------------- */

  /* ---- how much fill a shadow gets, as one number ----
     The bounce carries 88-92% of the indirect by day (measured with a
     neutral card, see PROBE_FILL_SHARE), so scaling it scales the fill
     without touching the specular environment - which is the trap the
     ENV_DIFFUSE split exists to avoid, because the specular half is
     the only light a metal receives at all.

     Exists as a runtime multiplier rather than a second constant so a
     probe can sweep key:fill against it in one boot instead of one
     boot per value. Shipped at 1.0; GROUND_BOUNCE is the shipped
     level. */
  let bounceScale = 1;

  const sunColour = new THREE.Color();
  const skyColour = new THREE.Color();
  const groundColour = new THREE.Color();
  const probeTint = new THREE.Color();
  const fillTint = new THREE.Color();

  /**
   * Transmittance of the direct solar beam, from the same Rayleigh and
   * Mie coefficients the dome integrates.
   *
   * Normalised against one air mass, so the result is a *relative*
   * reddening: at the zenith it is white, and the camera's white
   * balance for a noon sun is applied on top. Without that
   * normalisation the noon key came out around 4200K - visibly
   * tungsten - because the absolute transmittance of even a clear
   * zenith sky is already noticeably warm.
   */
  function sunTransmittance(sinAltitude) {
    /* ---- Kasten's air mass, in the units it is actually written in ----
       m = 1 / (sin h + 0.15 * (h + 3.885)^-1.253), where h is the
       apparent solar altitude IN DEGREES. Only the first term takes a
       sine; the correction term takes the angle.

       This passed sin h to both. Substituting a number in [0, 1] for
       one in [0, 90] does not rescale the correction, it INVERTS the
       function: (sin h + 0.03)^-1.253 grows as the sun sets, so the
       denominator grows and the air mass falls. Swept over a full day
       it peaked at 1.21 at 26 degrees of altitude and fell to 0.76 at
       9.6 - never reaching the 1.0 the zenith is defined to be, let
       alone the ~38 of a real horizon.

       Everything that followed came from `excess` below going NEGATIVE,
       which turns Beer-Lambert extinction into amplification, strongest
       in the channel with the largest optical depth:

         - the key light was BRIGHTEST at 18:30 (5.83) and dimmest at
           midday (5.32), a 6% band across eleven hours where the true
           ratio between those two is nearer three to one;
         - the setting sun rendered BLUE - (0.735, 0.780, 0.935) at
           19:00 - because blue carries 4.7x red's zenith optical depth
           and so gained most from the sign flip;
         - `golden-hour` and `dawn-ridge` were lit with noon light. Both
           are named for a condition the engine could not produce.

       Clamped at the horizon rather than continued below it. The beam
       is already at 0.3% of its zenith luminance there, and dayFactor
       owns the rest of the ramp into night. */
    const s = clamp(sinAltitude, -1, 1);
    const altitudeDeg = Math.max(0, Math.asin(s) / DEG);
    const airMass = 1 / (Math.max(s, 0) + 0.15 * Math.pow(altitudeDeg + 3.885, -1.253));

    const mieDepth = BETA_M * (state.current.turbidity / 2.4) * H_MIE;
    const excess = airMass - 1;
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i += 1) {
      const zenithDepth = BETA_R[i] * uniforms.uRayleigh.value * H_RAYLEIGH + mieDepth;
      out[i] = Math.exp(-zenithDepth * excess);
    }
    return { r: out[0], g: out[1], b: out[2], airMass };
  }

  /** Rec.709 luminance. Used to separate "how bright" from "what
   *  colour" everywhere below, so the two can be tuned apart. */
  function luma(c) { return c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722; }

  function updateLighting(immediate = false) {
    computeSunDirection();
    uniforms.uSunDir.value.copy(sunDir);

    const elev = sunDir.y;
    const { r, g, b } = sunTransmittance(elev);

    // Intensity falls off with elevation and dies at civil twilight.
    const dayFactor = clamp01(smoothstep(clamp01((elev + 0.09) / 0.28)));
    // A low sun is not just redder, it is DIMMER - by a factor of four
    // between noon and a few degrees up. Carrying the transmittance's
    // luminance into the intensity is what gives golden hour its
    // actual character; normalising it away (which the previous
    // version did) leaves a full-strength orange light that reads as a
    // colour filter over a midday scene.
    const beamLevel = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const intensity = SUN_IRRADIANCE * beamLevel * dayFactor * state.current.exposure;

    // White-balanced for a noon sun: the hue here is the DEPARTURE
    // from that, so the key is neutral-warm high up and deep orange on
    // the deck.
    const peak = Math.max(r, g, b, 1e-4);
    sunColour.setRGB((r / peak) * 1.0, (g / peak) * 0.972, (b / peak) * 0.935);

    render.sun.color.copy(sunColour);
    render.sun.intensity = intensity;
    render.sun.position.copy(sunDir).multiplyScalar(q.shadowDistance * 1.1);
    render.sun.visible = intensity > 0.004;
    render.sun.castShadow = q.shadows && intensity > 0.05;

    /* ---- fill ----
       The environment probe IS the sky, so a hemisphere light with a
       blue sky colour on top of it counts the same light twice - and
       that double count was most of why nothing had a shadow side.
       The hemisphere is demoted to what the probe genuinely lacks:
       sunlight bounced off the surrounding ground. Warm, strongest from
       below, and present at BOUNCE_ON_UP even straight overhead,
       because a horizontal patch of shadowed sand still sees a whole
       ring of sunlit sand out to the horizon. */
    /* The bounce carries SAND'S ALBEDO, not a wash of the sun colour.
       It was a 55% lerp towards (0.86, 0.70, 0.48), which lands at
       saturation 0.26 - paler than the sand it is supposed to have come
       off. Light reflected from a surface is the illuminant times that
       surface's albedo, and this map's sand measures near (1.0, 0.67,
       0.36) once the illuminant is divided out, so the mix has to reach
       most of the way there. Same hue (33 deg, unchanged), saturation
       0.26 to 0.44, and that chroma is the only thing keeping a shaded
       surface identifiable as its own material. */
    /* 0.40, where it was 0.72. The bounce does carry sand's albedo -
       that part of the reasoning above is sound - but sand's albedo
       measures saturation 0.48, and light that has bounced ONCE off it
       is the illuminant times that, not the albedo itself. At 0.72 the
       fill arrived at saturation 0.44, which is more chromatic than
       most of what it lands on. */
    /* 0.22, and the reason is a limit of the light rather than a new
       opinion about sand.

       A HemisphereLight's lower half contains NO SKY. Its irradiance is
       mix(groundColor, skyColor, 0.5 + 0.5*Ny), so at a VERTICAL normal
       the two ends are blended 50/50 by colour - but skyColour's
       luminance is 0.374 against this tint's 0.861, so the warm end
       carries about 70% of what a wall receives and the neutral end 30%.
       A real vertical wall sees half a sky, and that half is what
       cancels the bounce. Ours cannot: the sky end has to stay neutral
       for the up-facing case (see skyColour below), so nothing opposes
       the warm term at a vertical normal.

       Measured on a neutral grey box standing on open sand, its own
       vertical faces read against its own cast shadow
       (blacksand-shadow-box.mjs), so there is no albedo in the number:

         shipped 0.40   face lit sat 0.145 -> shade 0.226   ratio 1.56
         tint    0.25              0.138 -> 0.180                 1.40
         tint    0.15              0.127 -> 0.156                 1.26
         BATTLEFIELD 2, paired over its own frames                 1.15

       So a shaded wall was receiving a fill HALF AGAIN more chromatic
       than its own key, on a surface with no albedo to blame. This is
       round 4's "the indirect is too directional" thread: ground was
       repaired three rounds ago and vertical faces never were.

       Ruled out first, on the same rig, because both were plausible and
       both are cheaper than a light change: killing the probe's diffuse
       share moves this face 0.226 -> 0.231, i.e. the hemisphere carries
       ALL of its chroma and about half its level; and flattening the
       grade (shadowLift 0, satRoll 0, saturation 1.0) takes the ratio to
       1.635, so the curve was suppressing the fault slightly rather than
       causing it.

       Why not lower still: the same constant is what a DOWNWARD-facing
       normal gets, and a slab underside really does see almost pure
       bounce - those were the round-2 reviewer's "black holes". One
       hemisphere light cannot serve both normals, so this is a split
       and it is stated as one. 0.22 halves the departure from the key,
       which is roughly what "half of it should have been sky" asks for,
       and leaves an underside visibly warmer than the sun.

       Note this retracts a recorded negative. Round 7 swept the bounce
       tint to pure sun colour and measured frame shade saturation
       getting WORSE (0.729). That result does not transfer to this
       build: at the time this same tint also painted the hemisphere's
       up-facing end, so changing it recoloured every shaded horizontal
       surface in the game. The sky end has been independent since, and
       the sweep now moves lit saturation 0.584 -> 0.588 and shade
       0.491 -> 0.487 with IQR, sd, luma and darkPct all flat. */
    const bounceTint = sunColour.clone().lerp(new THREE.Color(0.90, 0.66, 0.36), 0.22);
    groundColour.copy(bounceTint);
    /* ---- the sky end is the SKY, not more bounce ----
       This was bounceTint * BOUNCE_ON_UP, which meant the hemisphere
       light had no cool end at all: warm below, warm above, and an
       up-facing shaded surface - the case a desert sky dominates in
       reality - received the warm term from every direction at once.

       Near-neutral rather than blue, and that is measured, not
       cautious. Both were swept: a properly blue (0.55, 0.68, 0.95)
       end and this one land shade saturation within 0.01 of each other
       (0.522 against 0.519), but the blue one costs 0.06 of LIT
       saturation - 0.571 -> 0.489 against a reference of 0.581 - and
       0.18 of the lit:shade detail ratio, because that blue also lands
       on everything the sun is already lighting. It is also the
       ingredient in the failure this file has three separate comments
       about: shaded sand rendering as a sheet of water. Neutral fill
       desaturates a shadow without recolouring it, which is the whole
       of what was wanted.

       The 1.25 is a LEVEL correction and nothing more: the neutral
       colour is dimmer than the warm tint it replaced at the same
       multiplier, and without it the frame loses 2.4 of mean luma and
       darkPct goes further out of the reference range. Total fill on
       an up-facing normal lands where it was; only its colour moved.

       What this bought, measured on gameplay framing through
       blacksand-chroma-compare, two captures averaged:

         shade saturation   0.641 -> 0.522   (1.62x -> 1.32x of BF2)
         lit:shade          0.92  -> 1.15
         lit saturation     0.564 -> 0.61    (kept near the 0.581 ref)

       And what did NOT move it, all swept as source rewrites rather
       than argued (shade saturation, then lit:shade):

         shipped                              0.615   0.94
         bounce tint -> pure sun colour       0.729   0.77
         ENV_DIFFUSE 0.066 -> 0.17            0.760   0.73
         ENV_DIFFUSE_SAT 0.52 -> 0.90         0.765   0.71
         albedo saturation x0.50              0.622   0.83
         this change                          0.522   1.15

       The third row is the one worth keeping: 2.6x on ENV_DIFFUSE is
       the obvious move and it does nothing, because the probe is not a
       cool source - most of its irradiance comes from the ground half
       that this same function paints with bounceTint, so turning it up
       adds warm and cool in the ratio that was already there. The
       fifth is the other: HALVING the chroma of every texture in the
       game moves shaded saturation by 0.01. The chroma in our shadows
       was never in the materials. */
    skyColour.setRGB(0.90, 0.92, 0.96).multiplyScalar(BOUNCE_ON_UP * 1.25);
    render.hemi.color.copy(skyColour);
    render.hemi.groundColor.copy(groundColour);
    // The bounce is sunlight that has already been absorbed once by
    // sand, so it dies with the sun rather than with the sky.
    render.hemi.intensity = intensity * GROUND_BOUNCE * bounceScale;

    // Sky IBL, as a SPECULAR gain. render.js scales what reaches the
    // diffuse term separately - see SKY_SPECULAR above.
    render.scene.environmentIntensity =
      SKY_SPECULAR * lerp(1.0, 1.4, state.current.haze) * lerp(0.25, 1.0, dayFactor);

    // The probe's ground half. Regenerating the PMREM is what actually
    // applies it, and updateLighting always marks it dirty.
    envGround.material.color.copy(bounceTint)
      .multiplyScalar(clamp(intensity * PROBE_GROUND, 0, 8));

    /* ---- the colour of the light inside a shadow ----
       The two ambient terms, weighted by how much each actually
       contributes, handed to the composite so its toe lift can be the
       colour of the fill instead of a fixed blue-white. That constant
       was worth about a third of a shaded concrete wall and turned it
       cyan; shaded sand, four times brighter, never showed it, which is
       why the fault read as orientation-dependent when it is not.

       PROBE_FILL_SHARE calibrates the probe's weight against the
       hemisphere's, measured with a neutral card in shade: the warm
       bounce carries 88-92% of the indirect by day. Expressing both as
       intensities rather than as a constant blend is what keeps it
       honest after dark, where the bounce dies with the sun and the
       only fill left genuinely is a blue sky. */
    const coolFill = probeTint.setRGB(0.62, 0.76, 1.0);
    const coolGrey = luma(coolFill);
    // Same de-saturation the diffuse IBL gets in render.js, and for the
    // same reason: a single-scattering dome is far bluer than a real
    // sky, which has multiple scattering and ground return in it.
    coolFill.setRGB(
      lerp(coolGrey, coolFill.r, 0.52),
      lerp(coolGrey, coolFill.g, 0.52),
      lerp(coolGrey, coolFill.b, 0.52)
    );
    const warmWeight = render.hemi.intensity;
    const coolWeight = render.scene.environmentIntensity * PROBE_FILL_SHARE;
    fillTint.setRGB(
      bounceTint.r * warmWeight + coolFill.r * coolWeight,
      bounceTint.g * warmWeight + coolFill.g * coolWeight,
      bounceTint.b * warmWeight + coolFill.b * coolWeight
    );
    if (luma(fillTint) < 1e-5) fillTint.copy(coolFill);

    /* ---- aerial perspective ----
       Extinction first. Rayleigh is fixed (it is air); the aerosol
       term is the weather knob, because haze IS aerosol. */
    // Scaled with the Rayleigh exaggeration above; the two have to move
    // together or a hazy day stops being hazier than a clear one.
    const betaM = 1.45e-4 + state.current.haze * 1.45e-3;
    const mieG = 0.62;

    // Calibrate the in-scatter level against the phase function
    // evaluated at right angles to the sun, so "how bright is the
    // haze" is one decision taken once rather than a number that
    // drifts every time the phase function is touched.
    const p0R = rayleighPhase(0);
    const p0M = miePhase(0, mieG);
    const side = new THREE.Color(
      (betaR.x * p0R + betaM * p0M) / (betaR.x + betaM),
      (betaR.y * p0R + betaM * p0M) / (betaR.y + betaM),
      (betaR.z * p0R + betaM * p0M) / (betaR.z + betaM)
    );

    aerialTint.copy(sunColour);
    const targetHaze = intensity * HAZE_ALBEDO;
    const sideLuma = Math.max(luma(side) * luma(aerialTint), 1e-6);
    // An eighth of the haze is multiple scattering: light that has
    // bounced around the sky before reaching the eye. Without it the
    // anti-sun side of a dusk sky goes to black instead of to deep
    // blue, and distant ridges lose their silhouette entirely. Kept
    // small and only mildly blue - a desert's floating aerosol is
    // dust, and dust haze is warm-grey, not the deep blue that a
    // maritime or alpine distance goes.
    const multi = 0.13;
    const aerialLevel = (targetHaze * (1 - multi)) / sideLuma;
    skyInscatter.set(0.62, 0.76, 1.0).multiplyScalar(
      (targetHaze * multi) / 0.7581
    );

    // The colour the haze settles to at right angles to the sun. The
    // dome's horizon band is driven from the same value, so terrain
    // fading out and sky fading in meet on the same colour instead of
    // showing a seam along the skyline. Neutralised the same way both
    // shaders neutralise it, for the same reason.
    hazeColour.setRGB(
      aerialTint.r * side.r * aerialLevel + skyInscatter.x,
      aerialTint.g * side.g * aerialLevel + skyInscatter.y,
      aerialTint.b * side.b * aerialLevel + skyInscatter.z
    );
    const hazeGrey = luma(hazeColour);
    hazeColour.setRGB(
      lerp(hazeGrey, hazeColour.r, HAZE_SATURATION),
      lerp(hazeGrey, hazeColour.g, HAZE_SATURATION),
      lerp(hazeGrey, hazeColour.b, HAZE_SATURATION)
    );

    uniforms.uAerialBetaR.value.copy(betaR);
    uniforms.uAerialBetaM.value = betaM;
    uniforms.uAerialG.value = mieG;
    uniforms.uAerialTint.value.copy(aerialTint);
    uniforms.uAerialLevel.value = aerialLevel;
    uniforms.uAerialSky.value.copy(skyInscatter);

    // Ground fog only where the tier pays for it, and only when the
    // air is still enough to hold it - a dust storm has no inversion
    // layer for anything to pool under.
    fogProfile.z = q.volumetricLight
      ? lerp(1.4, 0.25, clamp01(state.current.wind / 9)) * lerp(0.6, 1.6, state.current.haze)
      : 0;

    /* ---- cloud shadow ----
       Cheap, and the reason a big outdoor map feels alive rather than
       painted. Scaled by how much cloud there actually is and by how
       high the sun is: a low sun throws cloud shadows so long and soft
       they stop being legible as shadows. */
    const cloudCover = clamp01(state.current.cloud);
    cloudShadow.set(
      q.cloudQuality >= 1 ? clamp01(cloudCover * 0.9) * 0.34 * clamp01(elev * 3) : 0,
      0.0016,
      ctx.time * state.current.wind * 0.0022,
      ctx.time * state.current.wind * 0.0009
    );

    render.setAtmosphere({
      sunDirection: sunDir,
      betaR,
      betaM,
      mieG,
      tint: aerialTint,
      level: aerialLevel,
      skyInscatter,
      hazeSat: HAZE_SATURATION,
      strength: 1,
      profile: fogProfile,
      // 2.6, where it was 0.75. The composite now scales the shafts by
      // the air on the ray rather than by screen proximity to the sun
      // alone, and that term is small - so the number in front of it
      // has to be bigger for the same visible strength.
      shafts: q.volumetricLight && q.lightShafts ? 2.6 : 0,
      cloudShadow,
      fillTint,
    });

    // Exposure tracks the sun so night is dark and noon is not blown.
    // The day value is set against AgX with a single sRGB encode; it
    // was 0.92 when the frame was being encoded twice, which is why it
    // looked correct and measured 188.
    render.setExposure(lerp(2.4, 0.58, dayFactor) * state.current.exposure, immediate);

    envDirty = true;
  }

  /* ----------------------------- api ----------------------------- */

  let envTimer = 0;

  const api = {
    uniforms,
    sunDirection: sunDir,
    /** The colour distance settles to. Anything that needs to blend
     *  into the horizon reads this rather than inventing its own. */
    hazeColour,

    get timeOfDay() { return state.timeOfDay; },
    get weather() { return state.weather; },
    /** 0 at night, 1 in full day. Everything that needs to know
     *  "is it bright out" reads this rather than re-deriving it. */
    get daylight() { return clamp01(smoothstep(clamp01((sunDir.y + 0.09) / 0.28))); },

    setTimeOfDay(hours, immediate = true) {
      state.timeOfDay = ((hours % 24) + 24) % 24;
      updateLighting(immediate);
      if (immediate) rebuildEnvironment();
      return state.timeOfDay;
    },

    /** Compass bearing of world +Z, degrees.
     *
     *  Rotating the map under a real sun, rather than bending the sun's
     *  arc, is the only way to change every shot's lighting AZIMUTH
     *  without touching the solar model - and azimuth, not elevation, is
     *  what decides whether a shot has shadows in it. Measured on the
     *  establishing pose: a 42.9-degree morning sun gives key:fill 3.76
     *  and a 42.9-degree afternoon sun 1.86, because in the afternoon it
     *  sits on the camera's own axis and throws everything out of frame.
     *  Exposed so that relationship can be swept rather than guessed at. */
    /** Latitude, with the declination re-derived so the day keeps its
     *  length - see DAY_LENGTH_INVARIANT. Raising it lowers the whole
     *  arc without moving sunrise or sunset, which is the only knob
     *  that changes how raking the light is at a hand-authored hour. */
    /** Multiplier on the ground bounce - see bounceScale. */
    get bounceScale() { return bounceScale; },
    setBounceScale(k) {
      bounceScale = k;
      updateLighting(true);
      return bounceScale;
    },

    get latitude() { return state.latitude; },
    setLatitude(deg) {
      state.latitude = deg;
      state.declination = declinationFor(deg);
      updateLighting(true);
      rebuildEnvironment();
      return { latitude: state.latitude, declination: state.declination };
    },

    get northBearing() { return state.northBearing; },
    setNorthBearing(deg) {
      state.northBearing = ((deg % 360) + 360) % 360;
      updateLighting(true);
      rebuildEnvironment();
      return state.northBearing;
    },

    setWeather(name, immediate = false) {
      const preset = WEATHER[name];
      if (!preset) return false;
      state.weather = name;
      Object.assign(state, preset);
      if (immediate) {
        Object.assign(state.current, preset);
        updateLighting(true);
        rebuildEnvironment();
      }
      return true;
    },

    listWeather() { return Object.keys(WEATHER); },

    update(dt) {
      uniforms.uTime.value = ctx.time;

      // Ease the atmosphere towards its target so a weather change is
      // a front rolling in rather than a hard cut.
      const target = WEATHER[state.weather];
      let moved = false;
      for (const key of ["turbidity", "mie", "mieG", "haze", "cloud", "wind", "exposure"]) {
        const next = damp(state.current[key], target[key], 0.55, dt);
        if (Math.abs(next - state.current[key]) > 1e-5) moved = true;
        state.current[key] = next;
      }
      uniforms.uTurbidity.value = state.current.turbidity;
      uniforms.uMie.value = state.current.mie;
      uniforms.uMieG.value = state.current.mieG;
      uniforms.uHaze.value = state.current.haze;
      uniforms.uCloudAmount.value = state.current.cloud;

      if (moved) updateLighting(false);

      // The cloud shadow has to scroll every frame, not only when the
      // lighting changes - a deck that only moves when the weather
      // does is worse than no deck at all.
      if (cloudShadow.x > 0) {
        cloudShadow.z = ctx.time * state.current.wind * 0.0022;
        cloudShadow.w = ctx.time * state.current.wind * 0.0009;
        render.setAtmosphere({ cloudShadow });
      }

      // Refresh the environment probe on a slow cadence, and only when
      // the sky it is a picture of has actually changed.
      envTimer += dt;
      if (envDirty && envTimer > 0.25) {
        envTimer = 0;
        if (environmentSignature() !== envSignature) rebuildEnvironment();
        else envDirty = false;
      }
    },

    report() {
      return {
        timeOfDay: Number(state.timeOfDay.toFixed(2)),
        weather: state.weather,
        sunElevationDeg: Number((Math.asin(clamp(sunDir.y, -1, 1)) / DEG).toFixed(2)),
        sunDir: [Number(sunDir.x.toFixed(3)), Number(sunDir.y.toFixed(3)), Number(sunDir.z.toFixed(3))],
        sunIntensity: Number(render.sun.intensity.toFixed(3)),
        sunColour: `#${render.sun.color.getHexString()}`,
        skySpecular: Number((render.scene.environmentIntensity || 0).toFixed(3)),
        groundBounce: Number(render.hemi.intensity.toFixed(3)),
        hazeColour: `#${hazeColour.clone().convertLinearToSRGB().getHexString()}`,
        hazeLuma: Number(luma(hazeColour).toFixed(3)),
        aerosol: Number((1.6e-4 + state.current.haze * 1.5e-3).toExponential(2)),
        groundFog: Number(fogProfile.z.toFixed(2)),
        cloudShadow: Number(cloudShadow.x.toFixed(3)),
        exposure: Number(render.exposure.toFixed(3)),
        daylight: Number(api.daylight.toFixed(3)),
      };
    },

    dispose() {
      skyMaterial.dispose();
      skyMesh.geometry.dispose();
      envMesh.geometry.dispose();
      envGround.geometry.dispose();
      envGround.material.dispose();
      pmrem.dispose();
      if (envTarget) envTarget.dispose();
    },
  };

  // Pull the URL's requested conditions in before the first frame so
  // the harness never captures a world mid-transition.
  const params = new URLSearchParams(window.location.search);
  if (params.has("tod")) state.timeOfDay = Number(params.get("tod")) || state.timeOfDay;
  if (params.has("weather") && WEATHER[params.get("weather")]) {
    api.setWeather(params.get("weather"), true);
  }
  updateLighting(true);
  rebuildEnvironment();

  return api;
}
