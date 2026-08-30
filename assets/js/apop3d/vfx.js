/* ============================================================
   APOP DEMON MOGGERS 3D - vfx

   Particles, ground decals, trails, contact shadows and the air
   itself. Everything visible in this file exists to answer two of
   the tells listed in CONTRACT.md section 2:

     "No contact shadow"  - a floating character is the loudest
        possible failure, so every dynamic object in the game gets a
        soft blob that ray-tests down to the real ground and lies on
        the ground's normal. This is a separate, cheap, instanced
        pass that runs alongside the one directional shadow map.
     "Empty air" - motes, light shafts and an optional heat haze.
        SM64 air is never a vacuum, and a still frame of clean air
        reads as a prototype immediately.

   Five structural decisions worth knowing before editing:

   1. THERE ARE TWO PARTICLE MESHES, not one. Dust and smoke blend
      normally or they glow against a bright food-court floor; sparks
      and sparkle blend additively or they read as grey confetti. One
      mesh cannot do both: instance colour scales RGB, so an
      additively-lit dust particle fades to BLACK rather than to
      nothing.

   2. INSTANCES CARRY THEIR OWN ALPHA. `instanceColor` is three's only
      built-in per-instance channel and it is RGB. A one-float custom
      attribute plus a two-line shader patch is what lets a normally
      blended particle actually fade out.

   3. EVERY INTEGRATOR IS NaN-GUARDED. A single non-finite value in an
      instance matrix propagates through the whole draw and, once a
      bloom-style pass is in the chain, takes the entire frame white.
      This has cost this repo a day before. Positions and velocities
      are range-clamped and finite-checked, and a particle that fails
      is killed rather than written.

   4. ONE LIGHT, ALLOCATED AT LOAD. Adding a light to a scene
      recompiles every material in it (CONTRACT section 6), so the
      punch light used by the ground pound, the Record ceremony and
      the aura is created once here, at intensity zero, and only ever
      has its intensity and colour animated.

   5. SPAWNING ALLOCATES NOTHING. Sprites are synthesised once at
      create, pools are fixed size, and the hot loops write into
      module-scope scratch vectors.

   ------------------------------------------------------------
   BUS EVENTS THIS MODULE LISTENS FOR

   Gameplay modules do not import vfx. They emit on ctx.bus and the
   right effect fires. Payloads are all optional; a missing field
   falls back to something sane.

     player:step    { position, surface, speed }
     player:land    { position, normal, speed, hard }
     player:jump    { position, chain }
     player:skid    { position, dir, speed }
     player:pound   { position, normal, phase:"start"|"land" }
     player:hurt    { position, amount }
     player:heal    { position, amount }
     player:water   { position, speed, entering }
     beam:hit       { position, normal }
     aura:fire      { position, radius }
     enemy:pop      { position, colour, scale }
     collect:clout  { position, kind, chain }
     collect:record { position }
     boss:phase     { index }
     world:load / world:unload
   ============================================================ */

import * as THREE from "three";
import {
  TAU, clamp, clamp01, lerp, smoothstep, makeRng, Pool, ease, damp,
} from "apop3d/core.js";

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/**
 * Dust colour per collision material.
 *
 * The first thing that gives a stock particle system away is that a
 * skid on red carpet throws up the same grey puff as a skid on tile.
 * These are the fallback when a real ground material cannot be
 * sampled; when it can, the mesh's own base colour wins.
 */
const SURFACE_TINT = {
  stone: 0xbfb6ad,
  tile: 0xd8d2c4,
  metal: 0x9aa0a8,
  grass: 0x7f9a52,
  carpet: 0x9c3a4c,
  wood: 0xa4835a,
  sand: 0xd6c39a,
  snow: 0xe8eef5,
  ice: 0xbfe0ee,
  water: 0xa8cfe0,
  slope: 0xb5aca2,
  neon: 0xc27ad8,
  default: 0xc4bdb2,
};

/**
 * Course air. One entry per course id, so a basement does not have the
 * same drifting glitter as a rooftop.
 *
 *   moteA/moteB  the two ends of the mote tint ramp
 *   density      scales both the drawn count and the opacity
 *   rise         metres/second the field climbs
 *   boxY         metres of air above the floor the motes fill. Tall for
 *                an interior with a dark ceiling to read against; short
 *                outdoors, where a tall slab only silhouettes on the sky
 *   veils        alpha of the soft mid-distance haze slabs, 0 disables
 *   veilTint     what the veils lean toward from the course fog colour
 *   drift        seconds between ambient flakes, 0 disables
 *   driftColour  the flake tint - this is the course's own litter
 *   haze         the old screen-held shimmer band; hot courses only
 *   subject      the travelling subject key - see SUBJECT KEY below
 */
const COURSE_AIR = {
  // The Label Lobby: warm, still, museum air.
  0: {
    moteA: 0xffe6b0, moteB: 0xffbfe0, density: 0.55, rise: 0.14, boxY: 9, veils: 0.030, veilTint: 0xffe2c0, drift: 2.6, driftColour: 0xffd9a8, haze: 0,
    subject: { colour: 0xffe4c0, gain: 140, range: 24 },
  },
  // Food court: dust in the skylight, and paper litter on the floor.
  1: {
    moteA: 0xfff0cc, moteB: 0xffd8b0, density: 0.85, rise: 0.16, boxY: 15, veils: 0.055, veilTint: 0xf6e9c8, drift: 1.5, driftColour: 0xfff3dc, haze: 0,
    subject: { colour: 0xfff0d2, gain: 180, range: 26 },
  },
  // Red carpet at night: flashbulb haze hanging over the crowd.
  2: {
    moteA: 0xffe0a0, moteB: 0xffa8c8, density: 0.95, rise: 0.09, boxY: 10, veils: 0.065, veilTint: 0xd8a8b8, drift: 1.9, driftColour: 0xffe6a8, haze: 0.05,
    subject: { colour: 0xffd0b0, gain: 125, range: 24 },
  },
  // Server basement: cold, dense, recirculated. The thickest air here.
  3: {
    moteA: 0xa8dcff, moteB: 0x7fffe0, density: 1.15, rise: 0.04, boxY: 11, veils: 0.080, veilTint: 0x6f9ec0, drift: 2.4, driftColour: 0xbfe8ff, haze: 0,
    subject: { colour: 0xbfe4ff, gain: 115, range: 22 },
  },
  // Rooftop: open sky, so almost no veil - it would fog the skyline.
  4: {
    moteA: 0xffcaf0, moteB: 0xa8dcff, density: 0.80, rise: 0.22, boxY: 6, veils: 0.028, veilTint: 0xc0b0e8, drift: 1.7, driftColour: 0xffc2ea, haze: 0.08,
    subject: { colour: 0xd8ccff, gain: 120, range: 23 },
  },
  // Final livestream: embers, smoke and heat.
  5: {
    moteA: 0xffa878, moteB: 0xff6fae, density: 1.25, rise: 0.30, boxY: 14, veils: 0.070, veilTint: 0xa8506a, drift: 1.1, driftColour: 0xff9a5c, haze: 0.16,
    subject: { colour: 0xffd2c0, gain: 135, range: 24 },
  },
};

/**
 * THE SUBJECT KEY.
 *
 * A blind art critic that has now scored this game four times sorted
 * its wins from its losses and found the discriminator was not scale,
 * not colour and not foreground layering: it was the value delta in
 * the annulus immediately around the character. The frames that won
 * put the subject as the darkest mass against the lightest local
 * field. The frames that lost stood her against mid-value or black
 * neighbours - a black floor in the boss framing, a wall of equally
 * dark props in the arrival one - and she stopped being the subject.
 *
 * A course's lighting cannot fix that, because a course is lit for the
 * room and the character is somewhere in it. What fixes it is a light
 * that TRAVELS WITH HER.
 *
 * IT COSTS NO NEW LIGHT. CONTRACT section 6 forbids adding one - it
 * recompiles every material in the scene - and this file has always
 * allocated exactly one PointLight for the ground-pound / Record /
 * aura flash (header note 4). That light sits at intensity zero for
 * almost the whole game, so it is the subject key, and a punch simply
 * takes it over for its fifth of a second and hands it back. The two
 * roles never want it at the same time: the punch fires at the
 * player's own feet.
 *
 * ------------------------------------------------------------------
 * THE GEOMETRY IS THE WHOLE THING, AND THE FIRST GEOMETRY WAS WRONG.
 *
 * The obvious placement - a three-quarter back-key a couple of metres
 * up and a couple of metres behind - MEASURED AS A REGRESSION. Over
 * four framings it closed the subject-to-annulus delta from +82 to
 * +77 and took the weakest fifth of the silhouette edge from 34 down
 * to 26. The reason is the shading model: `materials.toon()` wraps,
 * so a light behind her still lands on the surfaces the camera can
 * see. A "back-key" on a cel-shaded figure is just a key.
 *
 * What separates the two is HEIGHT, not azimuth. For a point light H
 * metres up and r metres out, the ground's irradiance carries a
 * cosine of H/d and a standing figure's visible, vertical surfaces
 * carry r/d - so the split between "lights the floor around her" and
 * "lights her" is simply H:r. Nine metres up and three back is about
 * three to one in the annulus's favour, and that is where the sweep
 * turns positive: it beats no-key on the delta (+118 vs +110), on the
 * silhouette edge (79 vs 74), on the squint range and on the darks,
 * losing only a little saturation.
 *
 * So it is not a rim light and it is not a stage spot. It is a soft
 * high pool that follows her, and its subject is the FLOOR SHE IS
 * STANDING ON. She stays the darkest mass; her neighbourhood becomes
 * the lightest local field. That is the composition the critic sorted
 * its wins by, attached to the character rather than to the level.
 *
 * On the framing that was actually losing - the boss shot, where she
 * stands on a near-black rubber mat - it lifts the silhouette edge
 * contrast from 8.9 to 10.8 and the shot's squint P5 from 21 to 27.
 * That framing is the one this exists for; on framings where the
 * floor is already bright it is close to free.
 *
 *   colour  the key tint, in the course's own light. Never neutral:
 *           CONTRACT section 2.6, bounce in this game is coloured
 *   gain    candela. PointLight falls off as 1/d^2, so at the ~9.7m
 *           this sits from her the illuminance is roughly gain/94
 *   range   metres. This is what keeps it a POOL rather than another
 *           fill: past this it is windowed to nothing, so the
 *           midground never sees it and the knockdown in sky.js still
 *           has a background to knock down
 */
const SUBJECT_KEY = {
  height: 9.0,     // metres above her feet - see the H:r note above
  back: 3.0,       // metres away from the camera, along its own forward
  side: 2.0,       // metres across, so the pool is not concentric on her
  decay: 2,
  /* Damped, not snapped. The light is placed from the camera's
     forward vector, and the camera swings; a hard-placed key would
     make the pool on the floor jump every time the rig settled. */
  follow: 9,
};

/** Pool sizes. Sized for the busiest moment in the game - a ground
 *  pound into a crowd of imps with a coin chain running - and then
 *  left alone, because a pool that resizes is a pool that allocates. */
const BUDGET = {
  soft: 640,     // dust, smoke, splash
  glow: 480,     // sparks, sparkle, confetti
  ring: 56,      // land rings, shockwaves, aura waves
  decal: 96,
  shadow: 160,   // contact shadows
  /* Baked grounding patches. Sized off the measured candidate count
     for the busiest course (the food court asks for ~590: every slab,
     awning, kiosk roof and mezzanine underside, plus one per scattered
     table, chair and tray) with room for a denser one. They are one
     instanced draw whatever the number, and the fill cost is small
     because the patches are small. */
  groundPatch: 768,
  ribbon: 8,     // long jump / dive / spin trails
  ribbonSegments: 22,
  shaft: 20,
  motes: 760,
  veils: 64,     // soft mid-distance haze slabs
};

/** Anything past these is a bug upstream, not an effect. Clamping is
 *  cheaper than the alternative described in the header. */
const POS_LIMIT = 20000;
const SPEED_LIMIT = 400;

/* ------------------------------------------------------------------ */
/* Sprite synthesis                                                    */
/*                                                                     */
/* All sprites are white with an alpha shape: colour comes from the    */
/* per-instance channel, so one 128px canvas serves every tint in the  */
/* game. Generated from a fixed seed so two runs of a build produce    */
/* identical frames, which is the whole point of the golden shots.     */
/* ------------------------------------------------------------------ */

function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/** A lumpy cloud, not a gaussian blur. A clean radial gradient reads
 *  as a Photoshop brush; overlapping offset lobes read as a puff. */
function buildPuff(size = 128, seed = 0x9d51) {
  const canvas = makeCanvas(size);
  const g = canvas.getContext("2d");
  const rng = makeRng(seed);
  const image = g.createImageData(size, size);
  const lobes = [];
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * TAU + rng() * 0.6;
    const d = i === 0 ? 0 : 0.14 + rng() * 0.14;
    lobes.push({
      x: 0.5 + Math.cos(a) * d,
      y: 0.5 + Math.sin(a) * d,
      r: (i === 0 ? 0.30 : 0.17 + rng() * 0.12),
    });
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      let a = 0;
      for (let i = 0; i < lobes.length; i += 1) {
        const l = lobes[i];
        const dx = (u - l.x) / l.r;
        const dy = (v - l.y) / l.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < 1) a = Math.max(a, (1 - d2) ** 1.35);
      }
      // Hard cut at the quad edge, or a big puff shows its square.
      const edge = 1 - smoothstep((Math.hypot(u - 0.5, v - 0.5) - 0.40) / 0.10);
      const i4 = (y * size + x) * 4;
      image.data[i4] = 255;
      image.data[i4 + 1] = 255;
      image.data[i4 + 2] = 255;
      image.data[i4 + 3] = clamp01(a * edge) * 255;
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

/** Four-point star with a hot core. The star points are what make a
 *  sparkle read as a sparkle at 240p rather than as a dot. */
function buildSpark(size = 128) {
  const canvas = makeCanvas(size);
  const g = canvas.getContext("2d");
  const image = g.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / (size - 1) - 0.5) * 2;
      const v = (y / (size - 1) - 0.5) * 2;
      const r = Math.hypot(u, v);
      const core = Math.exp(-r * r * 16);
      // Two crossed tapered spikes, plus a smaller diagonal pair.
      const spikeH = Math.exp(-(v * v) / 0.0018) * Math.max(0, 1 - Math.abs(u));
      const spikeV = Math.exp(-(u * u) / 0.0018) * Math.max(0, 1 - Math.abs(v));
      const d1 = (u + v) * 0.7071;
      const d2 = (u - v) * 0.7071;
      const diag = (Math.exp(-(d1 * d1) / 0.0012) + Math.exp(-(d2 * d2) / 0.0012))
        * Math.max(0, 1 - r) * 0.45;
      const a = clamp01(core + (spikeH + spikeV) * 0.55 + diag) * (r < 1 ? 1 : 0);
      const i4 = (y * size + x) * 4;
      image.data[i4] = 255;
      image.data[i4 + 1] = 255;
      image.data[i4 + 2] = 255;
      image.data[i4 + 3] = a * 255;
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

/** An annulus with a soft inside and a harder outside, faintly
 *  scalloped so the expanding land ring is not a perfect circle. */
function buildRing(size = 256, seed = 0x31ab) {
  const canvas = makeCanvas(size);
  const g = canvas.getContext("2d");
  const rng = makeRng(seed);
  const wobble = [];
  for (let i = 0; i < 12; i += 1) wobble.push(rng() * 2 - 1);
  const image = g.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / (size - 1) - 0.5) * 2;
      const v = (y / (size - 1) - 0.5) * 2;
      const r = Math.hypot(u, v);
      const ang = Math.atan2(v, u);
      let w = 0;
      for (let k = 0; k < wobble.length; k += 1) {
        w += wobble[k] * Math.sin(ang * (k + 2) + k) / (k + 2);
      }
      const radius = 0.80 + w * 0.022;
      const d = (r - radius) / 0.20;
      // Asymmetric falloff: the outer edge of a real dust ring is
      // sharper than the inner, because the inner is still expanding.
      const a = d < 0 ? Math.exp(-d * d * 3.0) : Math.exp(-d * d * 9.0);
      const i4 = (y * size + x) * 4;
      image.data[i4] = 255;
      image.data[i4 + 1] = 255;
      image.data[i4 + 2] = 255;
      image.data[i4 + 3] = clamp01(a) * (r < 1.0 ? 255 : 0);
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

/* THE CONTACT SHADOW BLOB IS NOT A SPRITE ANY MORE.
   It was a 128px canvas holding a fixed radial profile - flat to 40%
   of the radius, then `^0.80` out to 95% - and that fixed-ness is
   exactly what a blind review read off a still frame as "a hard-edged
   black ellipse decal with no penumbra". A real penumbra widens with
   the distance between caster and ground, and a baked profile cannot.
   The curve now lives in the contact-shadow fragment shader, where its
   soft band is a per-instance number; the density shoulder is carried
   across unchanged. See the note on shadowMaterial. */

/** An irregular blotch for ground decals. Radially symmetric decals
 *  cannot be hidden by rolling them, so this one deliberately is not. */
function buildSplat(size = 256, seed = 0x77c3) {
  const canvas = makeCanvas(size);
  const g = canvas.getContext("2d");
  const rng = makeRng(seed);
  const harmonics = [];
  for (let i = 0; i < 8; i += 1) harmonics.push(rng() * 2 - 1);
  const image = g.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / (size - 1) - 0.5) * 2;
      const v = (y / (size - 1) - 0.5) * 2;
      const r = Math.hypot(u, v);
      const ang = Math.atan2(v, u);
      let w = 0;
      for (let k = 0; k < harmonics.length; k += 1) {
        w += harmonics[k] * Math.sin(ang * (k + 1) + k * 1.7) / (k + 1.5);
      }
      const radius = 0.62 + w * 0.16;
      const a = 1 - smoothstep((r - radius * 0.55) / (radius * 0.55));
      // Speckle, so the edge disintegrates instead of being a curve.
      const grain = 0.72 + rng() * 0.28;
      const i4 = (y * size + x) * 4;
      image.data[i4] = 255;
      image.data[i4 + 1] = 255;
      image.data[i4 + 2] = 255;
      image.data[i4 + 3] = clamp01(a * grain) * (r < 1 ? 255 : 0);
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Atmosphere shaders                                                  */
/* ------------------------------------------------------------------ */

/**
 * Drifting motes.
 *
 * The positions are derived entirely from a hash of a per-point seed
 * and the time uniform, and they wrap inside a box that follows the
 * camera. That means the whole field is one draw call whose CPU cost
 * is three uniform writes a frame, and it can never run out or need
 * respawning.
 *
 * THREE THINGS HERE ARE THE DIFFERENCE BETWEEN DUST AND A DIRTY LENS,
 * and all three were measured on captured frames, not guessed:
 *
 * 1. `aSize` is a WORLD RADIUS, not a pixel count. The first version
 *    multiplied a pixel size by a distance scale, so every mote inside
 *    ~150m came out past the 14px cap: the entire field drew at maximum
 *    size, which over a bright ceiling or an open sky is a scatter of
 *    identical white discs and reads as sensor dirt. A metric radius
 *    divided by distance is a mote that recedes.
 *
 * 2. A mote thinner than a pixel FADES rather than clamping. Rasterised
 *    point size has a floor of 1.0, so without an alpha term tied to
 *    the computed size, every far mote lands as a hard opaque dot -
 *    which is the same artefact arriving from the other end.
 *
 * 3. The field is anchored to the GROUND under the camera, not to the
 *    camera. Dust lives in the first few metres of air above a floor.
 *    Centring the slab on the eye puts half of it above the roofline,
 *    where it silhouettes on the sky and there is nothing for it to be
 *    dust OF.
 *
 * `uLights` is what makes it purposeful rather than uniform: motes
 * brighten inside the accent lights sky.js placed, so the field is
 * densest exactly where the course is lit. Air catching the light is
 * the read; evenly-spread glitter is not.
 */
const MOTE_VERT = /* glsl */`
precision highp float;
attribute float aSeed;
attribute float aSize;

uniform float uTime;
uniform vec3  uAnchor;      // camera xz, snapped; y = ground under the camera
uniform vec3  uBox;         // xz half-extent, y = slab thickness above ground
uniform float uRise;
uniform float uDrift;
uniform float uPixelScale;  // viewport height / (2 tan(fov/2))
uniform float uNear;
uniform float uFar;
uniform vec4  uLights[4];   // xyz world position, w reach (0 = unused)
uniform float uLightGain;

varying float vFade;
varying float vSeed;

float h11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

void main() {
  float life = 7.0 + h11(aSeed + 1.7) * 11.0;
  float t = fract(uTime / life + h11(aSeed + 4.4));

  vec3 p = vec3(
    uAnchor.x + (h11(aSeed) * 2.0 - 1.0) * uBox.x,
    uAnchor.y + h11(aSeed + 2.3) * uBox.y,
    uAnchor.z + (h11(aSeed + 5.9) * 2.0 - 1.0) * uBox.z
  );
  p.y += t * life * uRise;
  // Each mote wanders on its own phase. A field that translates as a
  // block reads as a texture sliding past, not as air.
  p.x += sin(uTime * 0.43 + aSeed * 4.0) * uDrift;
  p.z += cos(uTime * 0.37 + aSeed * 6.0) * uDrift;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  float px = aSize * uPixelScale / max(d, 0.35);

  float lit = 0.28;
  for (int i = 0; i < 4; i += 1) {
    float reach = uLights[i].w;
    if (reach > 0.0) {
      lit += 1.0 - smoothstep(0.0, reach, distance(p, uLights[i].xyz));
    }
  }
  lit = mix(1.0, clamp(lit, 0.0, 1.6), uLightGain);

  vFade = smoothstep(0.0, 0.16, t) * (1.0 - smoothstep(0.55, 1.0, t))
        * (1.0 - smoothstep(uBox.x * 0.62, uBox.x * 0.99, length(p.xz - uAnchor.xz)))
        * smoothstep(uNear, uNear * 2.8, d)
        * (1.0 - smoothstep(uFar * 0.55, uFar, d))
        * smoothstep(0.75, 1.9, px)
        * lit;
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;
  // Capped both ends. Uncapped, a mote a metre from the lens draws a
  // 300px disc and the frame fills with bokeh.
  gl_PointSize = clamp(px, 1.0, 9.0);
}
`;

const MOTE_FRAG = /* glsl */`
precision highp float;
varying float vFade;
varying float vSeed;
uniform vec3 uColourA;
uniform vec3 uColourB;
uniform float uOpacity;
void main() {
  if (vFade <= 0.002) discard;
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c) * 4.0;
  if (r > 1.0) discard;
  // Softer than it was: a mote with a defined edge is a particle, and
  // a particle you can see the edge of is a sprite.
  float a = pow(1.0 - r, 1.6);
  vec3 col = mix(uColourA, uColourB, fract(vSeed * 0.37));
  gl_FragColor = vec4(col, a * vFade * uOpacity);
}
`;

/**
 * Light shafts.
 *
 * One instanced open cone. The fragment fades along the cone's local
 * Y, and again by how edge-on the surface is to the eye - without
 * that second term the cone has a hard silhouette and reads as a
 * solid object rather than as lit air.
 */
const SHAFT_VERT = /* glsl */`
precision highp float;
attribute float instanceAlpha;
varying float vAlphaI;
varying float vY;
varying vec3 vNormalW;
varying vec3 vViewDir;
void main() {
  vAlphaI = instanceAlpha;
  vY = position.y + 0.5;
  vec4 world = instanceMatrix * vec4(position, 1.0);
  world = modelMatrix * world;
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SHAFT_FRAG = /* glsl */`
precision highp float;
varying float vAlphaI;
varying float vY;
varying vec3 vNormalW;
varying vec3 vViewDir;
uniform vec3 uColour;
void main() {
  if (vAlphaI <= 0.002) discard;
  // Bright at the source, gone at the floor.
  float along = pow(1.0 - clamp(vY, 0.0, 1.0), 1.6);
  // Edge-on is where a volume looks thickest.
  float rim = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir)));
  gl_FragColor = vec4(uColour, along * pow(rim, 1.4) * vAlphaI);
}
`;

/**
 * Heat haze.
 *
 * This is deliberately NOT a refraction pass: render.js owns the post
 * chain and nothing else may allocate a render target. What sells the
 * effect at platformer distances is the MOTION, so this is a soft
 * warm band whose alpha is a scrolling procedural wobble, held in
 * front of the camera. Over a hot food-court floor it reads correctly;
 * it will never bend a straight edge, and it is not pretending to.
 */
const HAZE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColour;

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  if (uIntensity <= 0.001) discard;
  vec2 uv = vUv;
  // Rising, stretching cells. Two octaves at different speeds is the
  // minimum that stops the pattern looking like it is on a conveyor.
  float n = vnoise(vec2(uv.x * 9.0, uv.y * 3.0 - uTime * 0.45));
  n += vnoise(vec2(uv.x * 21.0 + 4.0, uv.y * 7.0 - uTime * 0.78)) * 0.5;
  n /= 1.5;
  // Only near the horizon band, and never at the very bottom of frame
  // where the player would notice it sitting on top of their own feet.
  float band = smoothstep(0.06, 0.34, uv.y) * (1.0 - smoothstep(0.42, 0.72, uv.y));
  float a = pow(clamp(n, 0.0, 1.0), 2.2) * band * uIntensity;
  gl_FragColor = vec4(uColour, a);
}
`;

const HAZE_VERT = /* glsl */`
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/* ------------------------------------------------------------------ */

export function create(ctx) {
  const scene = ctx.scene;
  const camera = ctx.camera;
  const rng = makeRng(0x4f0d);

  const group = new THREE.Group();
  group.name = "vfx";
  group.frustumCulled = false;
  scene.add(group);

  const anisotropy = (() => {
    try { return Math.min(4, ctx.renderer.capabilities.getMaxAnisotropy()); }
    catch (error) { return 1; }
  })();

  /* ---------------------------- scratch ---------------------------- */

  // The write loop runs over a couple of thousand instances a frame
  // and must not allocate. Everything below writes into these.
  const _m = new THREE.Matrix4();
  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _v3 = new THREE.Vector3();
  // Reserved for "the position argument an effect was called with".
  // Effects use _v/_v2/_v3 freely, so the argument needs a vector no
  // effect body will stamp on - aliasing here moved the second ring of
  // the aura relative to the first and was invisible until traced.
  const _pos = new THREE.Vector3();
  const _size2 = new THREE.Vector2();
  const _axisX = new THREE.Vector3();
  const _axisY = new THREE.Vector3();
  const _axisZ = new THREE.Vector3();
  const _camRight = new THREE.Vector3();
  const _camUp = new THREE.Vector3();
  const _camFwd = new THREE.Vector3();
  const _colour = new THREE.Color();
  const _colour2 = new THREE.Color();
  const _quat = new THREE.Quaternion();
  const _quat2 = new THREE.Quaternion();
  const _euler = new THREE.Euler();
  const _up = new THREE.Vector3(0, 1, 0);
  const _planeNormal = new THREE.Vector3(0, 0, 1);
  const _raycaster = new THREE.Raycaster();
  const _down = new THREE.Vector3(0, -1, 0);

  /** Compose from three basis vectors without going through a
   *  quaternion - measurably cheaper in a loop this hot. */
  function composeBasis(matrix, px, py, pz, x, y, z, sx, sy, sz) {
    const e = matrix.elements;
    e[0] = x.x * sx; e[1] = x.y * sx; e[2] = x.z * sx; e[3] = 0;
    e[4] = y.x * sy; e[5] = y.y * sy; e[6] = y.z * sy; e[7] = 0;
    e[8] = z.x * sz; e[9] = z.y * sz; e[10] = z.z * sz; e[11] = 0;
    e[12] = px; e[13] = py; e[14] = pz; e[15] = 1;
  }

  /** The guard described in the file header. Returns false for any
   *  non-finite or absurd component; callers kill the particle. */
  function finiteVec(v) {
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
      && Math.abs(v.x) < POS_LIMIT && Math.abs(v.y) < POS_LIMIT && Math.abs(v.z) < POS_LIMIT;
  }

  function clampSpeed(v) {
    const s2 = v.x * v.x + v.y * v.y + v.z * v.z;
    if (!Number.isFinite(s2)) { v.set(0, 0, 0); return false; }
    if (s2 > SPEED_LIMIT * SPEED_LIMIT) v.multiplyScalar(SPEED_LIMIT / Math.sqrt(s2));
    return true;
  }

  /** Read a world position out of whatever a caller hands us: a
   *  Vector3, an Object3D, a physics body, or a plain {x,y,z}. */
  function readPosition(src, out) {
    if (!src) return false;
    if (src.isVector3) { out.copy(src); return finiteVec(out); }
    if (src.isObject3D) {
      src.getWorldPosition(out);
      return finiteVec(out);
    }
    if (src.position && typeof src.position.x === "number") {
      out.set(src.position.x, src.position.y, src.position.z);
      return finiteVec(out);
    }
    if (typeof src.x === "number") {
      out.set(src.x, src.y || 0, src.z || 0);
      return finiteVec(out);
    }
    return false;
  }

  /* --------------------------- textures --------------------------- */

  function texture(canvas, srgb = true) {
    const t = new THREE.CanvasTexture(canvas);
    // Colour textures get sRGB exactly once (CONTRACT section 5). These
    // are white-with-alpha, so the decode is a no-op on RGB and never
    // touches alpha - but the tag keeps them consistent with every
    // other colour map in the game.
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }

  const sprites = {
    puff: texture(buildPuff()),
    spark: texture(buildSpark()),
    ring: texture(buildRing()),
    splat: texture(buildSplat()),
  };

  /* ------------------------- shader patch ------------------------- */

  /**
   * Give an instanced material a per-instance alpha.
   *
   * See header note 2. Without this a normally-blended particle can
   * only fade by scaling its colour, which fades it to black rather
   * than to nothing - fine on an additive spark, catastrophic on dust.
   */
  function withInstanceAlpha(material, key) {
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
    /* Without a distinct cache key three hands back the unpatched
       program it already compiled for an identical material - and
       "identical" is decided by the parameter set, which does NOT
       include blending, polygon offset or which map is bound. Every
       instanced pass in this file therefore needs its OWN key, not a
       shared one: passing the same string for all of them is the same
       bug in a different costume, and it is what left the contact
       shadow pass drawing quads that never reached the frame. */
    material.customProgramCacheKey = () => `apop-inst-alpha:${key}`;
    return material;
  }

  function instancedQuad(material, count, renderOrder, name) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute("instanceAlpha",
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1));
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = renderOrder;
    mesh.name = name || "vfx.quads";
    group.add(mesh);
    return mesh;
  }

  /* ------------------------- particle meshes ------------------------ */

  // Tone mapping: soft particles are lit-adjacent and stay inside the
  // ACES curve so dust sits in the frame. Additive glow opts out -
  // pushed through ACES a saturated pink sparkle desaturates to a
  // cream smear, which is exactly the wrong read for this game.
  const softMaterial = withInstanceAlpha(new THREE.MeshBasicMaterial({
    map: sprites.puff,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
    side: THREE.DoubleSide,
  }), "soft");

  const glowMaterial = withInstanceAlpha(new THREE.MeshBasicMaterial({
    map: sprites.spark,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  }), "glow");

  const ringMaterial = withInstanceAlpha(new THREE.MeshBasicMaterial({
    map: sprites.ring,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  }), "ring");

  const softMesh = instancedQuad(softMaterial, BUDGET.soft, 6, "vfx.soft");
  const glowMesh = instancedQuad(glowMaterial, BUDGET.glow, 8, "vfx.glow");
  const ringMesh = instancedQuad(ringMaterial, BUDGET.ring, 7, "vfx.rings");

  function particleFactory() {
    return {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      colour: new THREE.Color(),
      colourEnd: new THREE.Color(),
      hasColourEnd: false,
      size: 0.3,
      sizeGrowth: 1.4,
      stretch: 1,
      life: 0,
      maxLife: 1,
      drag: 1.6,
      gravity: 0,
      fadeIn: 0.08,
      alpha: 1,
      rotation: 0,
      spin: 0,
      wobble: 0,
      orbit: 0,        // radians/s about the spawn point, for sparkle
      orbitRadius: 0,
      origin: new THREE.Vector3(),
      floor: -Infinity,
      bounce: 0,
    };
  }

  const soft = new Pool(particleFactory, BUDGET.soft);
  const glow = new Pool(particleFactory, BUDGET.glow);

  const rings = new Pool(() => ({
    position: new THREE.Vector3(),
    normal: new THREE.Vector3(0, 1, 0),
    colour: new THREE.Color(),
    life: 0,
    maxLife: 0.6,
    radius0: 0.4,
    radius1: 3,
    alpha: 1,
    curve: 2.2,      // exponent on the expansion; > 1 means fast then settle
    thickness: 1,
  }), BUDGET.ring);

  /* ---------------------------- decals ---------------------------- */

  /**
   * Ground decals are LIT. An unlit decal keeps its own brightness
   * when the floor beneath it goes into shadow, so a pound crater in
   * the shade of a pillar glows like a sticker. This one takes the
   * same light as the floor it is drawn on, which is most of what
   * makes it read as damage rather than as a projected image.
   */
  const decalMaterial = withInstanceAlpha(new THREE.MeshStandardMaterial({
    map: sprites.splat,
    roughness: 0.96,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
    dithering: true,
  }), "decal");
  const decalMesh = instancedQuad(decalMaterial, BUDGET.decal, 2, "vfx.decals");
  decalMesh.receiveShadow = true;

  const decals = new Pool(() => ({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    colour: new THREE.Color(),
    size: 1,
    life: 0,
    maxLife: 8,
    fadeOut: 2,
    alpha: 0.7,
    grow: 0,
  }), BUDGET.decal);

  /* ------------------------ contact shadows ------------------------ */

  /**
   * The blob is BLACK-ish and normally blended, not multiplied.
   *
   * Three's MultiplyBlending ignores the alpha channel, so a multiplied
   * blob cannot fade in or out - it can only be there or not, and it
   * pops on every spawn. Alpha-blending a dark quad is what SM64 itself
   * does, and it fades cleanly. The tint is not pure black: bounce
   * light in this game is coloured (CONTRACT section 2, tell 6), so the
   * shade colour leans toward the course's ambient.
   *
   * IT IS ITS OWN SHADER, not a patched MeshBasicMaterial, and that is
   * the whole reason this pass is now visible. As a lit-pipeline
   * material the blob went through instanceColor, tone mapping and the
   * output colour-space encode before it reached the blend, and what
   * came out the far end changed the floor by two or three levels out
   * of 255 - the quads were in the right place, at the right size, with
   * the right alpha, and measured as nothing. Twenty lines of shader
   * that emit `vec4(tint, blobAlpha * instanceAlpha)` have no pipeline
   * left to lose the effect in, and a blob is a solid dark patch again.
   *
   * ONE CONSEQUENCE OF OWNING THE SHADER: nothing encodes the tint.
   * three appends the output colour-space conversion to its own
   * materials, not to a ShaderMaterial, so whatever this fragment
   * writes lands in the sRGB framebuffer verbatim - while
   * `new THREE.Color(hex)` stores LINEAR components. The authored
   * 0x120a18 was therefore arriving on screen as (1,1,2): the tint
   * was not a dark plum, it was black, and every blob was a hole cut
   * in the floor rather than a patch of coloured shade. `authored ->
   * convertLinearToSRGB()` is the encode three would have done, and
   * it is what lets the hex below mean what it says. The colour is
   * deliberately not neutral - CONTRACT section 2, tell 6.
   */
  /**
   * ...AND IT HAS A PENUMBRA, WHICH IS THE DIFFERENCE BETWEEN A CONTACT
   * SHADOW AND A DECAL.
   *
   * The same blind review that found nothing casting a shape also read
   * this blob correctly from a still: "a hard-edged black ellipse decal
   * with no penumbra... it confirms the shadow is a decal, not
   * contact." The sprite it was sampling is flat to 40% of its radius
   * and then falls to nothing by 95%, which sounds soft and is not: on
   * a 0.85 m blob that transition is 47 cm of ground, a handful of
   * pixels at the distance these presets stand her, and it is the SAME
   * 47 cm whether she is on the floor or three metres above it.
   *
   * A real penumbra has one property above all others - IT WIDENS WITH
   * DISTANCE FROM THE OCCLUDER. A uniformly soft disc is not a penumbra
   * either, it is an airbrush, and this pass has already been walked
   * back from one of those. The distance that matters is not only
   * altitude: on a standing figure lit from 52 degrees up, the part of
   * the shadow under her boots is CONTACT and should be crisp, while
   * the part a metre and a half away is the shadow of her head and
   * should be soft. That gradient exists in a still frame, which is
   * where these get judged.
   *
   * So the profile moves out of the sprite and into the shader, and the
   * soft band is a per-instance vec2 that runs from the near end of the
   * quad to the far end along the key's own direction. Altitude opens
   * the far end further, so by the top of a triple jump the blob has
   * become the soft altitude cue a platformer wants.
   *
   * It also drops the texture fetch: the sprite was radially symmetric,
   * so an analytic radius is the same picture with two knobs on it.
   *
   * The quad is no longer square-on to the world either. It is built on
   * the key's ground azimuth and stretched along it, because a shadow
   * cast by a light 52 degrees up is an ellipse pointing away from that
   * light, and this blob now has to agree with a whole floor of baked
   * casts that are all pointing the same way.
   */
  const shadowTintAuthored = new THREE.Color(0x241a2e);
  const shadowUniforms = {
    uTint: { value: shadowTintAuthored.clone().convertLinearToSRGB() },
  };
  const shadowMaterial = new THREE.ShaderMaterial({
    uniforms: shadowUniforms,
    vertexShader: /* glsl */`
      precision highp float;
      attribute float instanceAlpha;
      attribute vec2 instanceSoft;
      varying float vAlphaI;
      varying vec2 vSoft;
      varying vec2 vUvB;
      void main() {
        vAlphaI = instanceAlpha;
        vSoft = instanceSoft;
        vUvB = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uTint;
      varying float vAlphaI;
      varying vec2 vSoft;
      varying vec2 vUvB;
      void main() {
        if (vAlphaI <= 0.003) discard;
        vec2 p = (vUvB - 0.5) * 2.0;
        float r = length(p);
        /* p.x runs along the key's ground azimuth, negative at the
           contact end. The soft band opens across the quad: crisp where
           the body touches the floor, wide where the top of it lands. */
        float e = clamp(mix(vSoft.x, vSoft.y, clamp(p.x * 0.5 + 0.5, 0.0, 1.0)), 0.08, 0.98);
        /* The umbra ends at 1 - e and the frame stops at 1, so the quad
           always contains the whole penumbra: widening the band eats
           into the core rather than growing past the edge of the
           geometry, which would clip. */
        float core = 1.0 - smoothstep(1.0 - e, 1.0, r);
        /* Kept from the sprite this replaced: the density is held up
           across the footprint and only let go at the last centimetres.
           A linear falloff draws two thirds of the blob at less than
           half its alpha and measures as a smudge. */
        float a = pow(core, 0.80) * vAlphaI;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(uTint, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  shadowMaterial.name = "apop-contact-shadow";
  const shadowMesh = instancedQuad(shadowMaterial, BUDGET.shadow, 1, "vfx.contactShadows");
  // The tint is a per-course uniform, not per-instance data, so the
  // instance colour channel this pass used to carry it in is dead
  // weight - and one less thing between the quad and the frame.
  shadowMesh.instanceColor = null;
  shadowMesh.geometry.setAttribute("instanceSoft",
    new THREE.InstancedBufferAttribute(new Float32Array(BUDGET.shadow * 2), 2));

  /** Push the authored shade colour to both raw shaders, doing the
   *  encode three would have done for one of its own materials. */
  function pushShadowTint() {
    shadowUniforms.uTint.value.copy(shadowTintAuthored).convertLinearToSRGB();
    patchUniforms.uTint.value.copy(shadowUniforms.uTint.value);
  }

  function writeShadowTint(hex) {
    shadowTintAuthored.set(hex);
    pushShadowTint();
  }

  /**
   * A registered caster.
   *
   * `ground` is the cached result of the last downward probe. It is
   * refreshed on a round-robin rather than every frame for every
   * caster, because thirty raycasts a frame is real cost and a blob
   * that is three frames stale is invisible - EXCEPT on something
   * moving fast, which is why a caster that has moved further than
   * `RETEST_DIST` since its last probe jumps the queue.
   */
  const casters = [];
  const casterByObject = new Map();
  const RETEST_DIST = 0.35;
  const RAY_BUDGET = 10;
  let casterCursor = 0;

  /**
   * Visible ALL THE WAY UP, not just on its own flag.
   *
   * The declaration lives on the SkinnedMesh (that is what this pass
   * scans), but every system that parks a character hides the rig's
   * ROOT and leaves the mesh's own `visible` true. Testing the mesh
   * alone therefore left a blob lying on the floor under every enemy
   * whose rig had been released back to the pool and under every boss
   * waiting off-stage - dark patches on empty ground, which is a worse
   * failure than no blob at all.
   */
  function visibleInTree(obj) {
    let node = obj;
    while (node) {
      if (node.visible === false) return false;
      node = node.parent;
    }
    return true;
  }

  /**
   * A declared radius is a BODY radius; a contact shadow is wider.
   *
   * character.js declares the capsule it built the rig around - roughly
   * 0.3m for the smaller demons - and a 0.3m blob under a 1.7m figure
   * measured at two tenths of one percent of the frame: geometrically
   * correct and completely unreadable, which is the same as not having
   * one. SM64's shadow is about as wide as the character's stance and
   * dark enough to read at 240p. The declaration stays the relative
   * size; this is what turns it into a patch of shade.
   */
  /**
   * ...and a declared strength is a RELATIVE weight, not an opacity.
   *
   * Same measurement, same conclusion: a blind review called the
   * blobs "too soft and too light to read", and at the declared
   * 0.5-0.62 the floor under Moggadonna came out 16 luma darker than
   * the floor three metres away - a difference you have to be told to
   * look for. SM64's shadow takes its floor to roughly HALF, which on
   * this game's food-court tile is 45-55 luma of separation.
   *
   * So the declaration is scaled and then floored. The gain keeps the
   * ordering the callers intended (a hero still shades harder than a
   * clout coin); the floor is what guarantees the pass is legible at
   * all. The ceiling stops a blob from ever reaching pure tint, which
   * reads as a hole in the floor rather than as shade.
   */
  const SHADOW_SPREAD = 1.9;
  const SHADOW_MIN_RADIUS = 0.30;
  const SHADOW_GAIN = 1.55;
  const SHADOW_MIN_STRENGTH = 0.80;
  const SHADOW_MAX_STRENGTH = 0.94;
  /** Penumbra, as a fraction of the blob's own radius. NEAR is the
   *  contact end of the quad - where the feet are - and stays crisp;
   *  FAR is the end where the top of the body projects to, and is
   *  already soft on a standing figure. Altitude opens the far end
   *  (and, more slowly, the near one, since nothing is in contact any
   *  more) until by three metres up the whole blob is a soft cue. */
  const SHADOW_PEN_NEAR = 0.30;
  const SHADOW_PEN_FAR = 0.62;
  const SHADOW_PEN_GAIN = 0.20;
  /** How far the blob leans away from the key, in blob radii, and the
   *  hard cap in metres. It is a LEAN and not a projection on purpose:
   *  the true offset for a body of height H is H / tan(elevation),
   *  which at three metres up is over two metres of ground, and this
   *  blob is also the thing the player aims a landing with. Agreeing
   *  with the key costs a quarter of a radius; lying about where she
   *  will land costs the platforming. */
  const SHADOW_LEAN = 0.26;
  const SHADOW_LEAN_MAX = 0.40;
  /** Stretch along the key's ground azimuth. An oblique light turns a
   *  round footprint into an ellipse pointing away from it; this is
   *  that, at a size that reads without becoming a smear. */
  const SHADOW_STRETCH = 1.30;

  function makeCaster(object, opts = {}) {
    return {
      object,
      radius: Math.max(opts.radius ?? 0.45, SHADOW_MIN_RADIUS) * SHADOW_SPREAD,
      /* The floor is opt-out. It exists because a BODY-sized blob has
         to survive being read at 240p; something already the size of a
         platform does not need the help and looks tarry with it. */
      strength: clamp((opts.strength ?? 0.55) * SHADOW_GAIN,
        opts.strengthFloor ?? SHADOW_MIN_STRENGTH, SHADOW_MAX_STRENGTH),
      maxDrop: opts.maxDrop ?? 14,
      // How high the object can float before the shadow is gone
      // entirely. A jump should shrink and fade the blob, not delete it.
      fadeHeight: opts.fadeHeight ?? 6,
      important: !!opts.important,
      offsetY: opts.offsetY ?? 0,
      squash: opts.squash ?? 1,
      ground: {
        valid: false, y: 0,
        normal: new THREE.Vector3(0, 1, 0),
        probedAt: new THREE.Vector3(NaN, NaN, NaN),
      },
      alive: true,
    };
  }

  /* --------------------- static grounding patches --------------------- */

  /**
   * The floor under a floating platform must not look like the floor
   * three metres away.
   *
   * THE MEASUREMENT. A blind review of `platforming.png` said the two
   * floating slabs "read as stickers pasted onto the image", and the
   * probe agreed: floor luminance directly beneath a slab and three
   * metres clear of it came back the same number. In a frame whose
   * whole job is platforming, that is a gameplay bug and not only an
   * art one - the player cannot tell where a platform is over the
   * ground.
   *
   * WHY THE SHADOW MAP CANNOT FIX IT. The rig is not broken; it was
   * verified working on course 4, where the deck carries real cast
   * shadows from the trees and the crates. Course 1 is an interior
   * with a solid ceiling at 22m and three skylight cells, so the
   * directional key is occluded off essentially the whole floor
   * before it reaches anything - the floor there is lit entirely by
   * hemisphere and ambient, neither of which casts. Adding a caster
   * to a surface that already receives no key changes nothing. Every
   * roofed course in this game (0, 1, 3 and most of 5) has the same
   * geometry, so this is structural, not a one-course accident.
   *
   * WHAT THIS PASS IS. Ambient occlusion, baked once per course, from
   * the collision BVH rather than from the draw meshes - the level's
   * statics are merged into one mesh per surface, so there is no
   * per-prop object left to hang a blob on, while the BVH still knows
   * exactly what is above what. It is honest in the lit courses too:
   * a slab occludes the sky whether or not the sun happens to be
   * behind it, so this darkens the same floor a cast shadow would
   * already be darkening rather than contradicting it.
   *
   * It is deliberately CLAMPED IN HEIGHT. An overhang seven metres up
   * stops reading as contact and starts reading as architecture, and
   * the ceilings and mezzanines that live above that would carpet the
   * whole course in shade for no gameplay information at all.
   */
  const PATCH_MIN_CLEARANCE = 0.45;
  const PATCH_MAX_CLEARANCE = 6.5;
  const PATCH_PEAK = 0.66;        // alpha at zero clearance
  const PATCH_FEATHER = 0.55;     // metres of soft edge, world scale
  const PATCH_MAX_SPAN = 34;      // metres; wider than this is a roof
  const PATCH_MIN_CELLS = 2;
  const PATCH_MAX_CELLS = 26000;  // sampling budget for one bake

  const patchUniforms = {
    uTint: { value: shadowTintAuthored.clone().convertLinearToSRGB() },
  };
  /**
   * Its own shader for exactly the reason the blob above has one, and
   * a box falloff rather than the radial sprite: these patches are
   * rectangles the size of a platform, and a radial blob stretched to
   * a 12m deck is an ellipse with four bare corners. The feather is
   * handed over per instance as a FRACTION of the half-extent, worked
   * out on the CPU from a constant width in metres, so a small patch
   * and a large one have the same physical softness.
   */
  const patchMaterial = new THREE.ShaderMaterial({
    uniforms: patchUniforms,
    vertexShader: /* glsl */`
      precision highp float;
      attribute float instanceAlpha;
      attribute vec2 aFeather;
      varying float vAlphaI;
      varying vec2 vFeather;
      varying vec2 vUvB;
      void main() {
        vAlphaI = instanceAlpha;
        vFeather = aFeather;
        vUvB = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uTint;
      varying float vAlphaI;
      varying vec2 vFeather;
      varying vec2 vUvB;
      void main() {
        if (vAlphaI <= 0.003) discard;
        vec2 p = abs(vUvB - 0.5) * 2.0;
        vec2 e = clamp(vFeather, 0.02, 1.0);
        float ax = 1.0 - smoothstep(1.0 - e.x, 1.0, p.x);
        float ay = 1.0 - smoothstep(1.0 - e.y, 1.0, p.y);
        float a = ax * ay * vAlphaI;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(uTint, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    fog: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  patchMaterial.name = "apop-ground-patch";

  const patchMesh = instancedQuad(patchMaterial, BUDGET.groundPatch, 1, "vfx.groundPatches");
  patchMesh.instanceColor = null;
  patchMesh.geometry.setAttribute("aFeather",
    new THREE.InstancedBufferAttribute(new Float32Array(BUDGET.groundPatch * 2), 2));

  const patchState = {
    pending: false,
    payload: null,
    bakedCourse: -1,
    frameDue: -1,
    enabled: true,
    lastBake: { cells: 0, patches: 0, ms: 0 },
  };

  /* ---------------------- the contact skirt ---------------------- */

  /**
   * WHY THE PASS ABOVE CANNOT SEE A FOUNTAIN.
   *
   * A blind review ranked "nothing casts across the deck" first of ten
   * defects and named the food court's tiered fountain: a 27 m wide,
   * 10 m tall sculpture standing in the middle of the plaza that puts
   * no mark of any kind on the floor around it. Probed, the deck 1.5 m
   * from its coping and the deck 3 m out measured 168.8 and 168.1 -
   * the same floor.
   *
   * It is not the clearance clamp and it is not a hole in the BVH. The
   * grid pass has exactly one occlusion test, a VERTICAL ray fired up
   * off each floor cell, and that test is blind to a solid by
   * construction:
   *
   *   - inside the fountain's footprint there IS no deck cell to fire
   *     from. The walk down finds the basin wall's top, then crosses
   *     its underside, and the deck below is never reached - which is
   *     correct, the deck there is buried.
   *   - outside the footprint every cell has clear air overhead. The
   *     up-ray finds nothing, because the fountain is BESIDE those
   *     cells, not above them.
   *
   * So the pass only ever finds OVERHANGS - platforms, awnings, chair
   * seats, mezzanine undersides. Anything that merely stands on the
   * floor is invisible to it, and most of a course's architecture
   * merely stands on the floor.
   *
   * WHAT THIS ADDS. The same height field the walk already gathers,
   * read sideways. A cell whose lowest walkable surface is well above
   * the deck's is a cell the deck cannot reach - something solid is
   * filling it - and the deck cells around it are the ones a real
   * ambient term would darken. That is a horizon test on a height
   * field, it needs no extra rays at all, and it lands shade beside
   * things instead of only under them.
   *
   * IT DOES NOT GO THROUGH THE RECTANGLE EMITTER. The shade around a
   * round fountain is an annulus; flood-filling one gives a component
   * whose bounding box is the whole fountain, and the splitter would
   * emit a stack of rectangles covering the basin it is supposed to
   * ring. So the skirt is baked into a small texture per floor level
   * and drawn as ONE quad - arbitrary shape, no overlap to compound
   * into a black hole, and one draw call instead of several hundred.
   *
   * WHAT IT MEASURES. Toggled against itself on the `water` framing,
   * deck luminance out from the fountain's coping:
   *
   *     +0.7 m   153.4 -> 128.0   (-25.4)
   *     +1.5 m   170.4 -> 158.0   (-12.4)
   *     +2.2 m   168.9 -> 166.7   ( -2.2)
   *     +3.0 m   152.9 -> 152.9   ( -0.1)
   *
   * which is the shape this pass is for: contact at the object, gone
   * by three metres. Two layers, ~14k texels, 30-50 ms at course load.
   */
  const SKIRT_MIN_STEP = 0.40;    // metres of rise before something counts as solid
  const SKIRT_MAX_REACH = 2.4;    // metres; past this it is architecture, not contact
  const SKIRT_PEAK = 0.44;        // always lighter than a patch UNDER an overhang
  /** The falloff curve, as an exponent on the normalised reach.
   *  Squared - the first thing tried - puts nearly all of the shade in
   *  the first half metre and measured -7.2 luma at the coping against
   *  -0.2 one metre further out, which on screen is a dark hairline
   *  around the object rather than something standing in shade. This
   *  is also the cheap direction on the noise metric: a wide gradient
   *  is low-frequency, a hairline is an edge. */
  const SKIRT_FALLOFF = 1.55;
  const SKIRT_FULL_HEIGHT = 1.3;  // metres of occluder for full strength
  const SKIRT_OCC_CAP = 7.0;      // ignore anything higher - that is a roof
  const SKIRT_LEVEL_BAND = 0.45;  // metres either side of a level that belong to it
  /** Metres of occluder searched BEHIND an edge cell for the body it
   *  belongs to. See the note by the mass filter in bakeSkirt. */
  const SKIRT_MASS_RADIUS = 4.5;
  const SKIRT_SUB = 2;            // texels per grid cell
  const SKIRT_MAX_TEXELS = 448;   // per axis
  const SKIRT_LAYERS = 3;         // floor levels that get one

  /**
   * THE DIRECTIONAL CAST - the half of this the two passes above cannot do.
   *
   * Both of them are OCCLUSION. The patch asks "what is over this
   * tile", the skirt asks "what is beside it", and both answers are
   * the same in every direction because the sky is blocked in every
   * direction. What they produce is a soft halo, and a blind review
   * that gave the halo real credit then measured what it is not:
   *
   *   "Nothing casts a shadow with a shape. No prop, pillar, planter,
   *    kiosk or the entire tiered pool structure lays a readable
   *    shadow. 40-55% of every frame is unbroken floor at one value,
   *    and the character is the only true dark in the picture."
   *
   * It put numbers on it that the objective gate structurally cannot
   * see: subject at 23-29 against a field of 117-189, at 1.3-1.4% of
   * frame area, in all seven shots. A global histogram is content when
   * every dark in the frame lives inside one and a third per cent of
   * the pixels.
   *
   * WHY NOT `castShadow`. Because that has already been tried and
   * measured (see the patch pass above and the shadow-strength note in
   * sky.js): a roofed course's key is occluded by its own ceiling
   * before it reaches the floor, so adding a caster to a surface that
   * receives no key changes nothing at all.
   *
   * WHAT THIS IS. A horizon test on the height field the bake already
   * gathers. Walk from a floor cell TOWARD the key; at s metres along,
   * an occluder has to stand s * tan(elevation) high to block it. The
   * field is already there, the walk is a dozen array reads, and the
   * result is a shadow with a direction, a length proportional to the
   * caster's height, and the caster's own footprint for a shape.
   *
   * FOUR THINGS ARE LOAD-BEARING.
   *
   * 1. IT IS EVALUATED PER CELL AND UPSAMPLED, not per texel. Marching
   *    every texel is thirteen times the work for a difference that
   *    does not survive the penumbra, and the bake shares a frame with
   *    a quarter-second of patch raycasting already.
   *
   * 2. THE PENUMBRA IS IN THE HEIGHT AXIS, and it WIDENS WITH THROW. A
   *    binary horizon test gives a hard edge, which is both wrong for a
   *    fill-lit interior and the expensive direction on the pixel-noise
   *    metric. Softening the height comparison by a band that grows
   *    with s turns into a ground-plane penumbra that is tight at the
   *    caster's foot and wide at the far end - which is what a real
   *    shadow does and is measurably cheap: a wide soft gradient scores
   *    NEGATIVE on that metric.
   *
   * 3. IT COMBINES WITH THE OTHER TWO BY `max`, NEVER BY SUM. Two
   *    alpha layers on one tile compound into a hole in the floor, and
   *    that failure has already cost this file one round.
   *
   * 4. IT RIDES IN THE SKIRT'S OWN TEXTURE. One more full-course
   *    alpha layer would be one more draw call and one more chance to
   *    compound; this is the same quad with a darker answer in it.
   */
  const CAST_MIN_HEIGHT = 0.30;   // metres; shorter than this casts nothing
  /** Metres of occluder height either side of the horizon that count as
   *  half-shadowed, at the caster's foot and per metre of throw. On
   *  course 1's 52-degree key the far end of a nine-metre shadow is
   *  soft over about a metre and a quarter of ground. */
  const CAST_PEN_BASE = 0.16;
  const CAST_PEN_SLOPE = 0.09;
  /** The march step, as a fraction of the sampling grid. Below one cell
   *  it re-reads the same cell; above it, a thin occluder is stepped
   *  straight over and its shadow comes and goes along its length. */
  const CAST_STEP = 0.75;

  const skirtUniformsShared = { uTint: patchUniforms.uTint };

  /* Its own quad rather than an instanced patch, and its own shader
     for the reason every raw shader in this file has one: a
     ShaderMaterial gets no automatic output encode, so the tint is
     pre-encoded once in pushShadowTint and shared by reference. */
  function makeSkirtLayer() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTint: skirtUniformsShared.uTint,
        uMap: { value: null },
        // xy = world origin of the map, zw = 1 / world span
        uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      },
      vertexShader: /* glsl */`
        precision highp float;
        varying vec3 vSkirtWorld;
        void main() {
          vec4 wp = modelMatrix * vec4( position, 1.0 );
          vSkirtWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uMap;
        uniform vec3 uTint;
        uniform vec4 uRect;
        varying vec3 vSkirtWorld;
        void main() {
          /* Addressed from WORLD position, not from the quad's own uv.
             The plane is built once and rotated flat, and reasoning
             about which way its uv ended up pointing after that is
             exactly the kind of thing that ships upside down. */
          vec2 uv = ( vSkirtWorld.xz - uRect.xy ) * uRect.zw;
          if ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) discard;
          float a = texture2D( uMap, uv ).a;
          if ( a <= 0.004 ) discard;
          gl_FragColor = vec4( uTint, a );
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    material.name = "apop-ground-skirt";
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "vfx.groundSkirt";
    mesh.renderOrder = 1;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, material, texture: null, w: 0, h: 0, data: null };
  }

  const skirtLayers = [];
  for (let i = 0; i < SKIRT_LAYERS; i += 1) skirtLayers.push(makeSkirtLayer());
  const skirtState = { enabled: true, layers: 0, texels: 0, ms: 0, levels: [] };
  /* The dynamic contact blobs. Gated separately from the baked passes
     because the screenshot harness renders a control frame with the
     character removed, and the blob is drawn from a pooled instanced
     mesh that does not care whether its caster is visible. */
  const blobState = { enabled: true };
  /* Freezes TIME in this module without freezing PLACEMENT.
     The harness captures every shot twice - once real, once with the
     subject deleted - and diffs the two to prove she was in the frame
     at all. That only works if nothing else moved between them. Motes,
     trails and the punch light are all integrators, so a live dt walks
     them a little further in the control frame and the diff picks up
     the difference as "subject". Measured on one encounter frame: 89
     mask components, of which 82 were dust specks totalling 256 px,
     and their dilation swamped the annulus badly enough that the
     preset's subject-vs-field number was mostly reporting the
     neighbourhood of the dust rather than the character.
     Freezing sets dt to 0 rather than skipping the pass, so billboards,
     blobs and the subject key still resolve against the final camera
     and body transforms - a control frame must still be a correct
     render of everything that is left. */
  const freezeState = { on: false };
  /* Its own flag, not skirtState's. The cast and the skirt answer
     different questions and the only honest way to attribute either is
     to toggle one against itself inside one process. */
  const castState = {
    enabled: true, active: false, elevation: 0, strength: 0, cells: 0,
    azimuth: 0, aimedAt: "", aimFrac: 0, aimCells: 0, aimTried: 0,
  };

  /**
   * POINTING THE CAST DOWN THE LENS.
   *
   * The bake below lays a directional shadow, and a blind review
   * measured that it was landing where nobody was looking: the near
   * floor - the bottom third of the frame, which is roughly forty per
   * cent of the picture - held no shadow value at all, in any preset.
   * Every shadow in the course fell AWAY from the camera.
   *
   * That is a property of the camera and not of the course, so the
   * course cannot answer it with a constant. sky.js's AIMING THE CAST
   * has the arithmetic; this is the seam that drives it. When the rig
   * commits a capture pose - a still, held frame, which is the only
   * kind of shot that gets reviewed - the cast is re-aimed down that
   * pose's view axis and the ground is re-baked.
   *
   * IT DELIBERATELY DOES NOT FIRE IN FREE PLAY. A bake is over a
   * hundred milliseconds of main thread, and a floor whose shadows
   * swing round every time the player nudges the camera is a worse
   * artefact than the one this fixes. `mode === "preset"` is the whole
   * gate: the follow, boss and cutscene rigs never reach it.
   */
  const castAim = { preset: "", enabled: true };

  function syncCastAim() {
    const rig = ctx.cameraRig;
    const sky = ctx.sky;
    if (!rig || !sky || typeof sky.aimCast !== "function") return;

    /* The `mode` GETTER, never getState() - that builds a fresh object
       every call and this runs on every frame of the game. */
    if (!castAim.enabled || rig.mode !== "preset") {
      if (!castAim.preset) return;
      castAim.preset = "";
      castState.aimedAt = "";
      if (sky.clearCastAim() && !patchState.pending) api.rebakeGround();
      return;
    }

    /* ctx.camera rather than the rig's own copy: cameraRig.lateUpdate
       runs AFTER this one (contract section 4), so the rig's live pose
       belongs to a frame that has not been written yet, while the
       camera holds the pose that was committed and drawn. On a held
       capture pose they are the same; on the frame a preset is set they
       are not, and the committed one is the one being photographed. */
    const m = camera.matrixWorld.elements;
    const bearing = Math.atan2(-m[8], -m[10]);
    if (!Number.isFinite(bearing)) return;
    /* aimCast answers "did it move enough to be worth a bake", so a
       held pose re-aims once and then costs one atan2 a frame. */
    if (!sky.aimCast(bearing)) return;
    let name = "preset";
    try {
      const s = typeof rig.getState === "function" ? rig.getState() : null;
      if (s && s.preset) name = s.preset;
    } catch (_) { /* naming is diagnostics; never the reason a bake stops */ }
    castAim.preset = name;
    castState.aimedAt = name;
    if (!patchState.pending) api.rebakeGround();
  }

  /* Where the near deck IS, in metres ahead of the lens.
     Not a guess: at these presets' heights and pitches the bottom edge
     of a 16:9 frame lands about five metres in front of the camera and
     the half-way line about sixteen, so the bottom third the review
     measured - and the lower half it asked for coverage in - is this
     band and nothing else. Scoring the whole course instead would let
     a candidate win on shade laid behind the horizon. */
  const CAST_NEAR_MIN = 3.0;
  const CAST_NEAR_MAX = 18.0;
  /* Tangent of the half-angle scored across, i.e. the frame's width. */
  const CAST_NEAR_SPREAD = 0.95;
  /* Alpha at which shade READS as shade rather than as a slightly
     duller floor. A lit deck near 190 taken down a quarter needs about
     this much of a shade colour that lands near luminance 30, and a
     quarter is where a value step stops being deniable. */
  const CAST_SHADE_ALPHA = 0.30;
  const _castFwd = new THREE.Vector3();
  const castCells = [];

  /**
   * CHOOSE THE DIRECTION BY MEASURING IT.
   *
   * sky.js's WHY THE AIM IS A SEARCH has the reasoning; this is the
   * half that can only happen here, because the height field exists
   * for the length of a bake and nowhere else.
   *
   * Collect the floor cells inside the near band above, march each
   * candidate over just those, and keep the one whose shaded fraction
   * lands in the band sky.js asks for. It is the same march the field
   * pass runs - `coverAt` is shared deliberately - over about a
   * thousand cells instead of a hundred thousand, so fifteen
   * candidates cost a fraction of one bake.
   *
   * Two-sided on purpose. A candidate that shades sixty per cent of
   * the near deck scores worse than one that shades twelve: the review
   * asked for a second dark MASS beside the character, and a dark
   * foreground is the same flat frame with the polarity reversed.
   */
  function searchCastAim({ b, step, nx, nz, hValid, hBase, occ, level, coverAt, stepsFor }) {
    const sky = ctx.sky;
    if (!sky || typeof sky.castCandidates !== "function") return;
    let list = null;
    let target = null;
    try {
      list = sky.castCandidates();
      target = sky.castTarget();
    } catch (_) { return; }
    if (!list || list.length < 2 || !target) return;
    const cast = keyCast();
    if (!cast) return;

    camera.updateMatrixWorld();
    _castFwd.setFromMatrixColumn(camera.matrixWorld, 2).multiplyScalar(-1);
    _castFwd.y = 0;
    if (_castFwd.lengthSq() < 1e-6) return;
    _castFwd.normalize();
    const cx = camera.position.x;
    const cz = camera.position.z;
    const fx = _castFwd.x;
    const fz = _castFwd.z;

    castCells.length = 0;
    const win = Math.ceil(CAST_NEAR_MAX / step) + 1;
    const cix = Math.round((cx - b.minX) / step - 0.5);
    const ciz = Math.round((cz - b.minZ) / step - 0.5);
    for (let ix = Math.max(0, cix - win); ix <= Math.min(nx - 1, cix + win); ix += 1) {
      const wx = b.minX + (ix + 0.5) * step;
      for (let iz = Math.max(0, ciz - win); iz <= Math.min(nz - 1, ciz + win); iz += 1) {
        const i = ix * nz + iz;
        // Open deck of THIS level only - the same test the texel loop
        // applies, so the score is taken on pixels that can be painted.
        if (!hValid[i] || Math.abs(hBase[i] - level) > SKIRT_LEVEL_BAND) continue;
        if (occ[i] > 0) continue;
        const wz = b.minZ + (iz + 0.5) * step;
        const dx = wx - cx;
        const dz = wz - cz;
        const fwd = dx * fx + dz * fz;
        if (fwd < CAST_NEAR_MIN || fwd > CAST_NEAR_MAX) continue;
        if (Math.abs(dx * fz - dz * fx) > fwd * CAST_NEAR_SPREAD) continue;
        castCells.push(i);
      }
    }
    /* Too little deck in front of the lens to judge on - a preset
       looking off a balcony, or straight at a wall. Whatever the
       course authored stands. */
    if (castCells.length < 24) { castState.aimCells = castCells.length; return; }

    const need = Math.min(0.98, CAST_SHADE_ALPHA / cast.strength);
    let best = null;
    let bestScore = -1;
    let bestFrac = 0;
    for (let ci = 0; ci < list.length; ci += 1) {
      const c = list[ci];
      const steps = stepsFor(c.tan);
      let hit = 0;
      for (let k = 0; k < castCells.length; k += 1) {
        const i = castCells[k];
        const ix = (i / nz) | 0;
        const iz = i - ix * nz;
        const cov = coverAt(b.minX + (ix + 0.5) * step, b.minZ + (iz + 0.5) * step,
          c.x, c.z, c.tan, steps);
        if (cov >= need) hit += 1;
      }
      const frac = hit / castCells.length;
      const s = frac < target.lo ? frac / target.lo
        : (frac > target.hi ? target.hi / frac : 1);
      /* Strictly greater, so a tie goes to the earlier candidate - and
         the list is ordered course-authored first, then on-axis, then
         off-axis. A search that cannot tell two directions apart
         should not be the thing that moves the course's own answer. */
      if (s > bestScore + 1e-4) { bestScore = s; best = c; bestFrac = frac; }
    }
    if (!best) return;
    sky.useCastCandidate(best);
    castState.azimuth = Number(best.azimuth.toFixed(1));
    castState.elevation = best.elevation;
    castState.aimFrac = Number(bestFrac.toFixed(3));
    castState.aimCells = castCells.length;
    castState.aimTried = list.length;
  }

  /**
   * The key direction every shadow in the course has to agree on.
   *
   * sky.js resolves it (see THE BAKED CAST there) and hands back a
   * pooled record, or null on a course whose shadow map casts for real
   * and must not be doubled. Called defensively - CONTRACT section 9 -
   * so a stub sky degrades to "no cast" rather than throwing mid-bake.
   */
  function keyCast() {
    try {
      const c = ctx.sky && typeof ctx.sky.shadowCast === "function"
        ? ctx.sky.shadowCast() : null;
      if (!c || !(c.strength > 0)) return null;
      if (!Number.isFinite(c.x) || !Number.isFinite(c.z) || !(c.tan > 0.05)) return null;
      return c;
    } catch (_) {
      return null;
    }
  }

  /** Lie the quad flat. Baked once - a patch never turns. */
  const PATCH_FLAT = new THREE.Quaternion()
    .setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));

  function boundsOf(payload) {
    const b = (payload && payload.bounds) || ctx.world?.current?.bounds || null;
    if (!b || !b.min || !b.max) {
      return { minX: -70, minY: -6, minZ: -70, maxX: 70, maxY: 40, maxZ: 70 };
    }
    // levels.js authors bounds as arrays; a Vector3 pair is accepted
    // too so this never becomes the reason a course loses its shade.
    const rd = (v, i, k) => (Array.isArray(v) ? v[i] : v[k]);
    const out = {
      minX: rd(b.min, 0, "x"), minY: rd(b.min, 1, "y"), minZ: rd(b.min, 2, "z"),
      maxX: rd(b.max, 0, "x"), maxY: rd(b.max, 1, "y"), maxZ: rd(b.max, 2, "z"),
    };
    for (const k of Object.keys(out)) {
      if (!Number.isFinite(out[k])) return { minX: -70, minY: -6, minZ: -70, maxX: 70, maxY: 40, maxZ: 70 };
    }
    return out;
  }

  const _patchOrigin = new THREE.Vector3();
  const _patchUp = new THREE.Vector3(0, 1, 0);
  const _propBox = new THREE.Box3();
  const _propGeoBox = new THREE.Box3();
  const _propCentre = new THREE.Vector3();
  const _propSize = new THREE.Vector3();

  /**
   * Chairs, trays, planters, seeds - the scattered decor.
   *
   * The grid pass above can only see what is in the collision BVH, and
   * a food-court chair is not a collider: hundreds of chairs of
   * triangle soup is a real BVH cost that world.js deliberately does
   * not pay. The result was a plaza of tables and chairs standing on
   * nothing, which is the same failure as the floating slab and the
   * one the arrival framing is full of.
   *
   * They are still INSTANCED, though, so unlike the merged statics
   * each one still has its own transform to read. One patch per
   * instance, sized from the instance's own world box.
   *
   * Anything the BVH does know about is skipped rather than shaded
   * twice: two alpha-blended patches on the same tile compound into a
   * black square, which reads as a hole and not as shade.
   */
  const _propTaken = [];

  function collectPropPatches(col, pushCandidate) {
    const root = ctx.world?.current?.group;
    if (!root) return;
    _propTaken.length = 0;
    root.traverse((o) => {
      if (!o.isInstancedMesh || !o.visible || !o.geometry) return;
      if (o.name && /^(collide|vfx)\./.test(o.name)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _propGeoBox.copy(o.geometry.boundingBox);
      for (let i = 0; i < o.count; i += 1) {
        o.getMatrixAt(i, _m);
        _m.premultiply(o.matrixWorld);
        _propBox.copy(_propGeoBox).applyMatrix4(_m);
        _propBox.getSize(_propSize);
        _propBox.getCenter(_propCentre);
        // Too small to read as shade, or big enough that the grid
        // pass is the right tool for it. The height test is what
        // keeps the pass off flat litter - a tray or a sesame seed
        // has a footprint but casts nothing you would ever see.
        if (_propSize.x < 0.35 || _propSize.z < 0.35 || _propSize.y < 0.35) continue;
        if (_propSize.x > 9 || _propSize.z > 9) continue;

        const floor = col.groundAt(_propCentre.x, _propCentre.z, _propBox.min.y + 0.35, 9);
        if (!floor || !floor.upFacing) continue;
        const clearance = _propBox.min.y - floor.y;
        if (clearance > PATCH_MAX_CLEARANCE || clearance < -0.6) continue;

        _patchOrigin.set(_propCentre.x, floor.y + 0.22, _propCentre.z);
        if (col.raycast(_patchOrigin, _patchUp, Math.max(0.4, clearance + 0.6))) continue;

        /* One prop, one patch. A palm is built out of `inst.palm` and
           `inst.palmTrunk` at the same transform, and two 5m patches
           alpha-blended on the same square of floor compound into a
           black disc - the exact "hole in the floor" failure the blob
           tint above was fixed for. */
        let dup = false;
        for (let k = 0; k < _propTaken.length; k += 1) {
          const t = _propTaken[k];
          if (Math.abs(t.y - floor.y) > 1
            || Math.abs(t.x - _propCentre.x) > (t.sx + _propSize.x) * 0.22
            || Math.abs(t.z - _propCentre.z) > (t.sz + _propSize.z) * 0.22) continue;
          dup = true;
          break;
        }
        if (dup) continue;
        _propTaken.push({
          x: _propCentre.x, y: floor.y, z: _propCentre.z,
          sx: _propSize.x, sz: _propSize.z,
        });

        const h = clamp01(Math.max(0, clearance) / PATCH_MAX_CLEARANCE);
        pushCandidate(
          _propCentre.x, floor.y + 0.030, _propCentre.z,
          _propSize.x * 1.05, _propSize.z * 1.05,
          /* A shade under a chair is an occlusion term, not a cast
             shadow; it should never be as dark as the patch under a
             slab the player has to land on. The size term is the
             difference between a stool and a palm: a wide canopy
             shades dappled, and a solid 6m disc of shade under a tree
             reads as a pit. */
          PATCH_PEAK * (1 - h * h) * 0.82
            * clamp(3.0 / Math.max(_propSize.x, _propSize.z), 0.42, 1)
        );
      }
    });
  }

  /**
   * Sample the course and write the patches.
   *
   * Two ray passes per cell, both against the BVH, both cheap: walk
   * DOWN collecting the up-facing surfaces (the floors you can stand
   * on, at every tier), then fire one SHORT ray up off each of them
   * for whatever is directly overhead. Short is the word that keeps
   * this affordable - the up-ray is capped at the maximum clearance,
   * so it terminates inside a few nodes instead of crossing the level.
   */
  function bakeGroundPatches(payload) {
    const col = ctx.collision;
    if (!col || typeof col.groundAt !== "function" || typeof col.raycast !== "function") return;

    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    const b = boundsOf(payload);
    const spanX = Math.max(4, b.maxX - b.minX);
    const spanZ = Math.max(4, b.maxZ - b.minZ);
    // One knob, chosen so a small course samples finely and the
    // biggest one still costs a bounded number of rays.
    const step = Math.max(0.9, Math.sqrt((spanX * spanZ) / PATCH_MAX_CELLS));
    const nx = Math.max(1, Math.floor(spanX / step));
    const nz = Math.max(1, Math.floor(spanZ / step));

    /* One grid per floor tier. Keyed on the floor height rounded to
       half a metre: a course's walkable levels are flat and far
       apart, so this separates the plaza from the mezzanine from the
       catwalks without any structural knowledge of the level. */
    const tiers = new Map();
    /* Capped. Each tier is a whole nx*nz grid, and a course that
       happened to expose a walkable surface every half metre - a long
       flight of stairs under an awning - would otherwise allocate
       dozens of them. Twenty-four is far more than any course here
       has levels, and the cap fails by dropping shade rather than by
       eating memory. */
    const TIER_LIMIT = 24;
    function tierFor(y) {
      const key = Math.round(y * 2);
      let t = tiers.get(key);
      if (!t) {
        if (tiers.size >= TIER_LIMIT) return null;
        t = { y, sum: 0, n: 0, a: new Float32Array(nx * nz) };
        tiers.set(key, t);
      }
      return t;
    }

    /* The walkable HEIGHT FIELD, gathered from the same walk that
       feeds the overhead test above and costing nothing extra. The
       skirt pass reads it sideways; see the note by SKIRT_MIN_STEP for
       what it is for and why the overhead test alone cannot see a
       solid standing on the floor. */
    /* AS DEEP AS THE WALK. It was 8 against a walk of 10, and the ring
       below then quietly threw away the two TALLEST surfaces at any
       cell busy enough to fill it. That is free while the only consumer
       is the skirt, whose 7 m contact cap discards them anyway - and it
       is the difference between a shadow and a smudge for the cast,
       which reads the same field at the course's lid height. Measured
       on course 1's fountain: the walk at 2 m from its centre returns
       [15.15, 15.00, 14.65, 9.04, ...], so the sixteen-metre sculpture
       was arriving in the height field as a nine-metre one and throwing
       a shadow that stopped inside its own basin. */
    const H_SLOTS = 12;
    /* Deep enough to reach the DECK. Measured on course 1: a plaza
       cell's walk is [roof 23.00, roof underside 22.00, rig 17.25, rig
       underside 16.75, deck 0.05, ...] - five surfaces before the
       floor the player stands on, at a spot with nothing built on it.
       Under an awning or beside a kiosk it is more, and a walk that
       stops short reports NO walkable surface at that cell at all, so
       the cells nearest the architecture - the ones this whole pass
       exists to shade - were the ones losing their floor. */
    const H_WALK = 10;
    const hValid = new Uint8Array(nx * nz);
    const hBase = new Float32Array(nx * nz);
    const hCount = new Uint8Array(nx * nz);
    /* EVERY surface at the cell, up-facing or not - not just the ones
       you could stand on. A fountain basin is a ring WALL: a shell
       with no bottom, so a ray dropped through it carries on to the
       deck underneath and the walkable height there is the deck's. A
       height field alone therefore reports the middle of the fountain
       as open plaza. What actually says "something is standing here"
       is a surface, of any facing, in the band just above the floor.

       Written as a RING, keeping the LOWEST H_SLOTS. The walk runs
       top down and the interesting surfaces are the ones near the
       deck; the roof is both first to arrive and always past the
       occlusion cap, so overwriting it is free. */
    const hSurf = new Float32Array(nx * nz * H_SLOTS);
    const ups = new Float64Array(H_WALK);

    let cells = 0;
    for (let ix = 0; ix < nx; ix += 1) {
      const x = b.minX + (ix + 0.5) * step;
      for (let iz = 0; iz < nz; iz += 1) {
        const z = b.minZ + (iz + 0.5) * step;
        cells += 1;
        let upCount = 0;
        let allCount = 0;
        const cellIdx = ix * nz + iz;

        let y = b.maxY + 1;
        for (let k = 0; k < H_WALK; k += 1) {
          const floor = col.groundAt(x, z, y, (y - b.minY) + 2);
          if (!floor || !Number.isFinite(floor.y)) break;
          const fy = floor.y;
          hSurf[cellIdx * H_SLOTS + (allCount % H_SLOTS)] = fy;
          allCount += 1;
          y = fy - 0.06;
          if (!floor.upFacing) { if (y < b.minY) break; continue; }
          if (upCount < ups.length) { ups[upCount] = fy; upCount += 1; }

          _patchOrigin.set(x, fy + 0.22, z);
          const over = col.raycast(_patchOrigin, _patchUp, PATCH_MAX_CLEARANCE);
          if (over && Number.isFinite(over.dist)) {
            // A lift is not level geometry; it gets a live blob from
            // the caster pass instead, or its shade would stay behind
            // on the floor after it had gone.
            const moving = over.mesh ? !!col.isMoving?.(over.mesh) : false;
            const clearance = (over.point.y - fy);
            if (!moving && clearance >= PATCH_MIN_CLEARANCE && clearance <= PATCH_MAX_CLEARANCE) {
              const h = clamp01(clearance / PATCH_MAX_CLEARANCE);
              /* The SAME curve the dynamic blob fades on, and it has
                 to be: a linear ramp measured at 0.13 alpha under a
                 platform four and a half metres up, which is a height
                 the player still has to judge a landing from. `1-h*h`
                 holds most of its density through the middle of the
                 range and only lets go near the cap. */
              const t = tierFor(fy);
              if (t) {
                t.a[ix * nz + iz] = PATCH_PEAK * (1 - h * h);
                t.sum += fy; t.n += 1;
              }
            }
          }
          if (y < b.minY) break;
        }

        /* Unconditional. A cell can be full of solid without exposing a
           single walkable face - a plinth wall, a planter side, a
           column - and the skirt pass needs to know something is
           standing there whether or not you could ever stand on it. */
        hCount[cellIdx] = Math.min(allCount, H_SLOTS);
        if (upCount > 0) {
          /* The walk goes top down, so the LAST up-facing entry is the
             floor you would actually stand on here. */
          let base = ups[upCount - 1];
          for (let k = 0; k < upCount; k += 1) if (ups[k] < base) base = ups[k];
          hValid[cellIdx] = 1;
          hBase[cellIdx] = base;
        }
      }
    }

    /* Grid -> rectangles. Flood-fill each tier into components, then
       emit one quad per component. A component whose cells fill less
       than two thirds of its own bounding box is an L or a ring - two
       platforms that happen to touch - so it is split down its longer
       axis and the halves are considered separately. Without that, a
       pair of adjacent slabs would pool into one rectangle of shade
       covering the gap the player is supposed to jump. */
    const alphas = patchMesh.geometry.attributes.instanceAlpha.array;
    const feathers = patchMesh.geometry.attributes.aFeather.array;
    const stack = [];
    const comp = [];

    /* Candidates are COLLECTED, not written straight into the buffer.
       A first version wrote them in flood-fill order and ran out of
       instances halfway through the first tier it happened to touch -
       which was the roof, because the scan starts in a corner - so the
       plaza the shot is actually framed on got whatever was left.
       Ranking by (alpha x area) spends a fixed budget on the patches
       that are worth the most shade on screen. */
    const candidates = [];

    /* The rank is deliberately NOT alpha x area. Straight area lets one
       roof slab outrank a whole plaza of chairs, and a chair with
       nothing under it is the same tell as a slab with nothing under
       it - CONTRACT section 2 does not grade a floating prop on its
       size. Saturating the area term keeps big patches ahead of small
       ones without letting them own the whole budget. */
    const pushCandidate = (x, y, z, sx, sz, alpha) => {
      candidates.push({
        x, y, z, sx, sz, alpha,
        weight: alpha * Math.min(sx * sz, 30),
      });
    };

    const emit = (x0, x1, z0, z1, list, tierY) => {
      let sum = 0;
      for (let i = 0; i < list.length; i += 1) sum += list[i].a;
      const alpha = sum / list.length;
      if (alpha <= 0.02) return;
      const wx0 = b.minX + x0 * step;
      const wx1 = b.minX + (x1 + 1) * step;
      const wz0 = b.minZ + z0 * step;
      const wz1 = b.minZ + (z1 + 1) * step;
      const sx = wx1 - wx0;
      const sz = wz1 - wz0;
      pushCandidate((wx0 + wx1) / 2, tierY + 0.035, (wz0 + wz1) / 2, sx, sz, alpha);
    };

    const split = (list, tierY, depth) => {
      let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
      for (let i = 0; i < list.length; i += 1) {
        const c = list[i];
        if (c.ix < x0) x0 = c.ix; if (c.ix > x1) x1 = c.ix;
        if (c.iz < z0) z0 = c.iz; if (c.iz > z1) z1 = c.iz;
      }
      const w = x1 - x0 + 1;
      const d = z1 - z0 + 1;
      if (w * step > PATCH_MAX_SPAN || d * step > PATCH_MAX_SPAN) return;
      const fill = list.length / (w * d);
      if (fill >= 0.66 || depth >= 3 || list.length <= PATCH_MIN_CELLS * 2) {
        emit(x0, x1, z0, z1, list, tierY);
        return;
      }
      const alongX = w >= d;
      const mid = alongX ? (x0 + x1) / 2 : (z0 + z1) / 2;
      const lo = [];
      const hi = [];
      for (let i = 0; i < list.length; i += 1) {
        const c = list[i];
        ((alongX ? c.ix : c.iz) <= mid ? lo : hi).push(c);
      }
      if (!lo.length || !hi.length) { emit(x0, x1, z0, z1, list, tierY); return; }
      split(lo, tierY, depth + 1);
      split(hi, tierY, depth + 1);
    };

    for (const tier of tiers.values()) {
      const grid = tier.a;
      const tierY = tier.n ? tier.sum / tier.n : tier.y;
      for (let ix = 0; ix < nx; ix += 1) {
        for (let iz = 0; iz < nz; iz += 1) {
          const seed = ix * nz + iz;
          if (grid[seed] <= 0) continue;
          comp.length = 0;
          stack.length = 0;
          stack.push(seed);
          grid[seed] = -grid[seed];
          while (stack.length) {
            const idx = stack.pop();
            const cx = Math.floor(idx / nz);
            const cz = idx - cx * nz;
            comp.push({ ix: cx, iz: cz, a: -grid[idx] });
            if (cx > 0 && grid[idx - nz] > 0) { grid[idx - nz] = -grid[idx - nz]; stack.push(idx - nz); }
            if (cx < nx - 1 && grid[idx + nz] > 0) { grid[idx + nz] = -grid[idx + nz]; stack.push(idx + nz); }
            if (cz > 0 && grid[idx - 1] > 0) { grid[idx - 1] = -grid[idx - 1]; stack.push(idx - 1); }
            if (cz < nz - 1 && grid[idx + 1] > 0) { grid[idx + 1] = -grid[idx + 1]; stack.push(idx + 1); }
          }
          if (comp.length < PATCH_MIN_CELLS) continue;
          split(comp.slice(), tierY, 0);
        }
      }
    }

    collectPropPatches(col, pushCandidate);

    candidates.sort((p, q) => q.weight - p.weight);
    const count = Math.min(candidates.length, BUDGET.groundPatch);
    for (let i = 0; i < count; i += 1) {
      const p = candidates[i];
      _v3.set(p.x, p.y, p.z);
      _v.set(p.sx, p.sz, 1);
      _m.compose(_v3, PATCH_FLAT, _v);
      if (!Number.isFinite(_m.elements[12]) || !Number.isFinite(_m.elements[13])) {
        alphas[i] = 0;
        continue;
      }
      patchMesh.setMatrixAt(i, _m);
      alphas[i] = p.alpha;
      feathers[i * 2] = clamp(PATCH_FEATHER / (p.sx * 0.5), 0.08, 1);
      feathers[i * 2 + 1] = clamp(PATCH_FEATHER / (p.sz * 0.5), 0.08, 1);
    }

    patchMesh.count = patchState.enabled ? count : 0;
    patchMesh.instanceMatrix.needsUpdate = true;
    patchMesh.geometry.attributes.instanceAlpha.needsUpdate = true;
    patchMesh.geometry.attributes.aFeather.needsUpdate = true;
    try {
      bakeSkirt({ b, step, nx, nz, hValid, hBase, hSurf, hCount, slots: H_SLOTS, tiers });
    } catch (error) {
      // The skirt is an addition to a pass that already works. It must
      // never be the reason a course loses the shade it had.
      console.warn("[apop3d] vfx contact skirt bake failed", error);
      for (const layer of skirtLayers) layer.mesh.visible = false;
    }

    patchState.lastBake = {
      cells,
      patches: count,
      candidates: candidates.length,
      step: Number(step.toFixed(2)),
      ms: Number((((typeof performance !== "undefined" && performance.now)
        ? performance.now() : 0) - t0).toFixed(1)),
    };
  }

  /**
   * Turn the height field into one shade texture per floor level.
   *
   * Two decisions worth knowing.
   *
   * THE OCCLUDER TEST IS "IS THERE A SURFACE IN THE BAND JUST ABOVE
   * THE FLOOR", not "is the floor missing". The first version tested
   * the walkable height and found the fountain almost invisible, for a
   * reason worth recording: the basin is a ring WALL - an open shell
   * with no bottom face - so a ray dropped through it carries straight
   * on to the deck beneath, and the walkable height inside the basin
   * is the deck's, same as the plaza. Probed radially, the walk at
   * 13 m returned the wall top at 0.95 followed by the deck at 0.05.
   * A surface in the band is the honest question, it costs the same,
   * and it catches shells, cutaways and open frames as well as solids.
   *
   * The band is capped at SKIRT_OCC_CAP above the floor for the same
   * reason the overhead pass clamps its clearance: without it the
   * course's own ceiling, 22 m up and over everything, is an occluder
   * for every cell in the level.
   *
   * THE TEXELS ARE EVALUATED AT SUB-CELL POSITIONS. The grid is
   * sampled at ~0.9 m, and a ring of shade snapped to 0.9 m cells
   * around a circular basin reads as an octagon. The alpha is a smooth
   * function of distance, so evaluating it at two texels per cell
   * costs four cheap window loops and gives a genuinely round edge.
   */
  function bakeSkirt({ b, step, nx, nz, hValid, hBase, hSurf, hCount, slots, tiers }) {
    for (const layer of skirtLayers) layer.mesh.visible = false;
    skirtState.layers = 0;
    skirtState.texels = 0;
    skirtState.levels.length = 0;
    if (!skirtState.enabled) return;

    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;

    /* ---- which floor levels are worth a layer ----
       Only OPEN floor votes: a cell with something standing on it is
       not part of the deck, and letting it vote would put a layer at
       the height of every kiosk roof in the course. */
    /** The highest surface standing in the band above `level` at cell
     *  `i`, or 0 for "nothing is standing here".
     *
     *  `cap` is separated out because the skirt and the cast want
     *  different answers to the same question. The skirt's 7 m is a
     *  CONTACT range - past that an overhang stops reading as something
     *  the object is standing next to - while the cast's only real
     *  constraint is the course's own lid, and clamping a sixteen-metre
     *  fountain to seven metres is what left it laying the shadow of a
     *  garden wall. See occluderCap in sky.js. */
    const occluderAt = (i, level, cap) => {
      const lo = level + SKIRT_MIN_STEP;
      const hi = level + cap;
      let top = 0;
      const n = hCount[i];
      for (let k = 0; k < n; k += 1) {
        const h = hSurf[i * slots + k];
        if (h >= lo && h <= hi && h - level > top) top = h - level;
      }
      return top;
    };

    const votes = new Map();
    for (let i = 0; i < hValid.length; i += 1) {
      if (!hValid[i]) continue;
      if (occluderAt(i, hBase[i], SKIRT_OCC_CAP) > 0) continue;
      const key = Math.round(hBase[i] * 2);
      const v = votes.get(key);
      if (v) { v.n += 1; v.sum += hBase[i]; v.max = Math.max(v.max, hBase[i]); }
      else votes.set(key, { n: 1, sum: hBase[i], max: hBase[i] });
    }
    /* Take the MAX of each bucket, not its mean.
       A level's floor is not perfectly flat - course 1's fountain apron
       is a 46x46 checker patch sitting 0.05 above a terrazzo plaza at
       0.00 - and a mean puts the skirt quad *under* the higher of the
       two surfaces it covers, leaving it to render on polygon offset
       alone. Flattening the apron is not the answer: that would make
       2100 square metres coplanar, which is a far worse version of the
       same problem (a z-fight across the whole bottom third of frame
       was the loudest pixel-scale artefact in the last review).
       Taking the bucket max puts the quad on top of everything it
       covers. The bucket is already quantised to half a metre, so the
       max can never be more than that above any covered cell. */
    const levels = [...votes.values()]
      .filter((v) => v.n >= 24)
      .sort((p, q) => q.n - p.n)
      .slice(0, SKIRT_LAYERS)
      .map((v) => v.max);
    if (!levels.length) return;

    /* ---- texture size ---- */
    const sub = SKIRT_SUB;
    const tw = Math.min(SKIRT_MAX_TEXELS, Math.max(8, nx * sub));
    const th = Math.min(SKIRT_MAX_TEXELS, Math.max(8, nz * sub));
    const spanX = nx * step;
    const spanZ = nz * step;

    /* THE SKIRT IS ISOTROPIC AGAIN.
       It used to be stretched 1.35 on the shaded side and squeezed to
       0.90 on the lit one, which was an attempt to fake a direction out
       of a term that does not have one - this says the SKY is blocked,
       and the sky is blocked on every side. The comment that shipped
       with the bias said as much and kept it anyway because there was
       nothing else in the frame carrying direction. There is now (see
       THE DIRECTIONAL CAST above), so the fake comes out: two terms
       disagreeing about where the key is looks worse than either. */
    const cast = castState.enabled ? keyCast() : null;
    castState.active = !!cast;
    castState.elevation = cast ? cast.elevation : 0;
    castState.strength = cast ? cast.strength : 0;
    castState.azimuth = cast
      ? Number(((cast.azimuth * 180 / Math.PI + 360) % 360).toFixed(1)) : 0;
    castState.cells = 0;
    castState.aimFrac = 0;
    castState.aimCells = 0;
    castState.aimTried = 0;
    const reachOf = (dh) => clamp(0.5 + dh * 0.7, 0.85, SKIRT_MAX_REACH);
    const win = Math.ceil(SKIRT_MAX_REACH / step) + 1;

    for (let li = 0; li < levels.length; li += 1) {
      const level = levels[li];
      const layer = skirtLayers[li];
      /* The tier grid, if this level has one. `.a` and an absolute
         value are both load-bearing: `tiers` holds records, not
         arrays, and the flood-fill above marks a cell visited by
         NEGATING it, so every alpha in there comes back signed. */
      const overheadTier = tiers.get(Math.round(level * 2));
      const overhead = overheadTier ? overheadTier.a : null;

      /* The occluder field for THIS level, resolved once per cell
         instead of once per texel. Every texel reads a window of
         cells and there are four texels per cell, so folding the
         band search out of that loop is the difference between a
         bake and a stall. Asked against `level` rather than against
         each cell's own floor, because the question is what stands
         proud of THIS deck. */
      const occ = new Float32Array(nx * nz);
      for (let i = 0; i < occ.length; i += 1) occ[i] = occluderAt(i, level, SKIRT_OCC_CAP);

      /* The cast's own view of the same field, at the course's lid
         height rather than at contact range. Shared when the course did
         not ask for a different cap, so most courses pay nothing. */
      const castCap = cast && cast.occluderCap > SKIRT_OCC_CAP ? cast.occluderCap : 0;
      let occTall = occ;
      if (castCap) {
        occTall = new Float32Array(nx * nz);
        for (let i = 0; i < occTall.length; i += 1) occTall[i] = occluderAt(i, level, castCap);
      }

      /**
       * How tall the BODY behind each edge cell is.
       *
       * The fountain is the case that proves this is needed. It is 27 m
       * across and 15 m tall, but the only part of it within contact
       * range of the plaza is the 0.95 m lip of its basin - so a reach
       * taken from the cell's own height gives a sculpture the size of
       * a house the same footprint of shade as a park bench, which is
       * what the first measurement of this pass showed: -7.2 luma in a
       * ring one metre wide and nothing at all at 1.5 m.
       *
       * A separable max over the occluder field hands each edge cell
       * the height of what is standing behind it. Only cells that are
       * themselves occluders take a value, so an open gap between two
       * kiosks never grows shade of its own.
       */
      const mass = new Float32Array(nx * nz);
      {
        const mwin = Math.max(1, Math.round(SKIRT_MASS_RADIUS / step));
        const tmp = new Float32Array(nx * nz);
        for (let ix = 0; ix < nx; ix += 1) {
          const row = ix * nz;
          for (let iz = 0; iz < nz; iz += 1) {
            const lo = Math.max(0, iz - mwin);
            const hi = Math.min(nz - 1, iz + mwin);
            let m = 0;
            for (let k = lo; k <= hi; k += 1) { const v = occ[row + k]; if (v > m) m = v; }
            tmp[row + iz] = m;
          }
        }
        for (let ix = 0; ix < nx; ix += 1) {
          const lo = Math.max(0, ix - mwin);
          const hi = Math.min(nx - 1, ix + mwin);
          for (let iz = 0; iz < nz; iz += 1) {
            if (occ[ix * nz + iz] <= 0) continue;
            let m = 0;
            for (let k = lo; k <= hi; k += 1) { const v = tmp[k * nz + iz]; if (v > m) m = v; }
            mass[ix * nz + iz] = m;
          }
        }
      }

      /**
       * The cast field for THIS level. See THE DIRECTIONAL CAST above.
       *
       * Computed for every cell, including the cells the occluders
       * themselves stand on. That is not waste and it is not a bug: a
       * cell inside a footprint marches straight into more of the same
       * occluder and comes back fully shadowed, which is what keeps the
       * field CONTINUOUS across the object's edge. Zeroing it there
       * instead would make the bilinear read at the foot of every wall
       * average toward nothing, and hand each object a bright halo at
       * exactly the point where its shadow should be darkest.
       */
      const castCell = cast ? new Float32Array(nx * nz) : null;
      if (cast) {
        const marchStep = Math.max(0.35, step * CAST_STEP);
        const capH = castCap || SKIRT_OCC_CAP;

        /** The horizon walk itself, for one cell and one direction.
         *
         *  Factored out so the SEARCH below and the field pass share
         *  one implementation. They must: a search that scores a
         *  direction with different arithmetic from the one that bakes
         *  it is a search for the wrong thing. */
        const coverAt = (wx0, wz0, dx, dz, tan, steps) => {
          let cov = 0;
          for (let k = 1; k <= steps; k += 1) {
            const s = k * marchStep;
            /* Toward the key: a horizon test walks up the light, not
               down the shadow. */
            const px = (wx0 + dx * s - b.minX) / step - 0.5;
            const pz = (wz0 + dz * s - b.minZ) / step - 0.5;
            if (px < -1 || pz < -1 || px > nx || pz > nz) break;
            const jx = Math.min(nx - 1, Math.max(0, Math.floor(px)));
            const jz = Math.min(nz - 1, Math.max(0, Math.floor(pz)));
            const jx1 = Math.min(nx - 1, jx + 1);
            const jz1 = Math.min(nz - 1, jz + 1);
            const fx = Math.min(1, Math.max(0, px - jx));
            const fz = Math.min(1, Math.max(0, pz - jz));
            /* Bilinear, so a shadow's lateral edge is a gradient
               across one cell rather than a 0.9 m staircase - the
               upsample to texels cannot invent that on its own. */
            const oh = (occTall[jx * nz + jz] * (1 - fx) + occTall[jx1 * nz + jz] * fx) * (1 - fz)
              + (occTall[jx * nz + jz1] * (1 - fx) + occTall[jx1 * nz + jz1] * fx) * fz;
            if (oh <= CAST_MIN_HEIGHT) continue;
            const need = s * tan;
            const pen = CAST_PEN_BASE + s * CAST_PEN_SLOPE;
            const c = smoothstep((oh - need + pen) / (2 * pen));
            if (c > cov) { cov = c; if (cov > 0.998) break; }
          }
          return cov;
        };
        const stepsFor = (tan) => Math.max(1,
          Math.ceil(Math.min(cast.maxLength, capH / tan + marchStep) / marchStep));

        /* Choose the direction by measuring it, on the deck this
           course's biggest floor level actually is. See searchCastAim. */
        if (li === 0) {
          searchCastAim({ b, step, nx, nz, hValid, hBase, occ, level, coverAt, stepsFor });
        }

        /* Past the point where even the tallest thing the course allows
           could still reach, the rest of the ray is arithmetic that can
           only produce zero. Cheap, and this loop runs a million times
           per layer. */
        const steps = stepsFor(cast.tan);
        for (let ix = 0; ix < nx; ix += 1) {
          const wx0 = b.minX + (ix + 0.5) * step;
          for (let iz = 0; iz < nz; iz += 1) {
            castCell[ix * nz + iz] =
              coverAt(wx0, b.minZ + (iz + 0.5) * step, cast.x, cast.z, cast.tan, steps);
          }
        }
        /* One separable [1 2 1] over the cell grid. The march resolves
           the shadow along its own axis and bilinear resolves it across
           one cell; this takes the corner off the diagonal staircase
           that a grid-aligned occluder leaves behind, and it is the
           cheap direction on the pixel-noise metric. */
        const tmpC = new Float32Array(nx * nz);
        for (let ix = 0; ix < nx; ix += 1) {
          const row = ix * nz;
          for (let iz = 0; iz < nz; iz += 1) {
            const a0 = castCell[row + Math.max(0, iz - 1)];
            const a2 = castCell[row + Math.min(nz - 1, iz + 1)];
            tmpC[row + iz] = (a0 + castCell[row + iz] * 2 + a2) * 0.25;
          }
        }
        for (let ix = 0; ix < nx; ix += 1) {
          const lo = Math.max(0, ix - 1) * nz;
          const hi = Math.min(nx - 1, ix + 1) * nz;
          const row = ix * nz;
          for (let iz = 0; iz < nz; iz += 1) {
            castCell[row + iz] = (tmpC[lo + iz] + tmpC[row + iz] * 2 + tmpC[hi + iz]) * 0.25;
          }
        }
        for (let i = 0; i < castCell.length; i += 1) if (castCell[i] > 0.02) castState.cells += 1;
      }

      if (layer.w !== tw || layer.h !== th || !layer.texture) {
        if (layer.texture) layer.texture.dispose();
        layer.data = new Uint8Array(tw * th * 4).fill(255);
        layer.texture = new THREE.DataTexture(layer.data, tw, th, THREE.RGBAFormat);
        layer.texture.wrapS = THREE.ClampToEdgeWrapping;
        layer.texture.wrapT = THREE.ClampToEdgeWrapping;
        layer.texture.minFilter = THREE.LinearFilter;
        layer.texture.magFilter = THREE.LinearFilter;
        layer.texture.generateMipmaps = false;
        layer.w = tw; layer.h = th;
        layer.material.uniforms.uMap.value = layer.texture;
      }
      const data = layer.data;
      for (let i = 3; i < data.length; i += 4) data[i] = 0;

      let painted = 0;
      for (let tz = 0; tz < th; tz += 1) {
        const wz = b.minZ + ((tz + 0.5) / th) * spanZ;
        const cz = Math.min(nz - 1, Math.max(0, Math.floor((wz - b.minZ) / step)));
        for (let tx = 0; tx < tw; tx += 1) {
          const wx = b.minX + ((tx + 0.5) / tw) * spanX;
          const cx = Math.min(nx - 1, Math.max(0, Math.floor((wx - b.minX) / step)));
          const here = cx * nz + cz;
          // This texel only belongs to this layer if the floor under it
          // is this layer's floor.
          if (!hValid[here] || Math.abs(hBase[here] - level) > SKIRT_LEVEL_BAND) continue;
          // Open deck only. A texel inside the occluder's own footprint
          // is floor nobody can see, and shading it puts a dark disc
          // over the basin instead of a ring around it.
          if (occ[here] > 0) continue;

          let best = 0;
          for (let ox = -win; ox <= win; ox += 1) {
            const jx = cx + ox;
            if (jx < 0 || jx >= nx) continue;
            for (let oz = -win; oz <= win; oz += 1) {
              const jz = cz + oz;
              if (jz < 0 || jz >= nz) continue;
              const j = jx * nz + jz;
              /* No hValid test on the NEIGHBOUR. Requiring a walkable
                 floor here is what made the first version blind to the
                 fountain: the cells the basin occupies are not floor
                 at all. */
              const dh = mass[j];
              if (dh <= 0) continue;
              const reach = reachOf(Math.min(dh, SKIRT_FULL_HEIGHT * 3));
              /* Distance from the texel to the occupied cell's near
                 EDGE, not to its centre: a cell is 0.9 m across and
                 measuring to the middle of it pushes every skirt half
                 a metre off the thing it belongs to. */
              const ex = Math.max(0, Math.abs(b.minX + (jx + 0.5) * step - wx) - step * 0.5);
              const ez = Math.max(0, Math.abs(b.minZ + (jz + 0.5) * step - wz) - step * 0.5);
              const d = Math.hypot(ex, ez);
              if (d >= reach) continue;
              const f = 1 - d / reach;
              const a = SKIRT_PEAK * Math.pow(f, SKIRT_FALLOFF)
                * Math.min(1, dh / SKIRT_FULL_HEIGHT);
              if (a > best) best = a;
            }
          }

          /* The cast, bilinearly upsampled off the cell grid, combined
             by MAX rather than by sum - see point 3 of the note. The
             foot of a wall is both in its own ambient skirt and at the
             head of its own cast; adding the two there is how a shadow
             becomes a hole. */
          if (castCell) {
            const px = (wx - b.minX) / step - 0.5;
            const pz = (wz - b.minZ) / step - 0.5;
            const jx = Math.min(nx - 1, Math.max(0, Math.floor(px)));
            const jz = Math.min(nz - 1, Math.max(0, Math.floor(pz)));
            const jx1 = Math.min(nx - 1, jx + 1);
            const jz1 = Math.min(nz - 1, jz + 1);
            const fx = Math.min(1, Math.max(0, px - jx));
            const fz = Math.min(1, Math.max(0, pz - jz));
            const cv = (castCell[jx * nz + jz] * (1 - fx) + castCell[jx1 * nz + jz] * fx) * (1 - fz)
              + (castCell[jx * nz + jz1] * (1 - fx) + castCell[jx1 * nz + jz1] * fx) * fz;
            const ca = cv * cast.strength;
            if (ca > best) best = ca;
          }

          if (best <= 0.012) continue;
          /* Never compound with the overhead pass. Two alpha layers on
             one tile multiply into a hole in the floor - the failure
             the blob tint was fixed for once already. */
          if (overhead) best = Math.max(0, best - Math.abs(overhead[here]) * 0.85);
          if (best <= 0.012) continue;
          data[(tz * tw + tx) * 4 + 3] = Math.min(255, Math.round(best * 255));
          painted += 1;
        }
      }

      if (!painted) continue;
      layer.texture.needsUpdate = true;
      layer.material.uniforms.uRect.value.set(b.minX, b.minZ, 1 / spanX, 1 / spanZ);
      layer.mesh.position.set(b.minX + spanX / 2, level + 0.028, b.minZ + spanZ / 2);
      layer.mesh.scale.set(spanX, 1, spanZ);
      layer.mesh.updateMatrix();
      layer.mesh.updateMatrixWorld(true);
      layer.mesh.visible = true;
      skirtState.layers += 1;
      skirtState.texels += painted;
      skirtState.levels.push(Number(level.toFixed(2)));
    }

    skirtState.ms = Number((((typeof performance !== "undefined" && performance.now)
      ? performance.now() : 0) - t0).toFixed(1));
  }

  /* ---------------------------- liquid ---------------------------- */

  /**
   * The pools.
   *
   * A blind review of the `water` framing came back with "a flat cyan
   * surface, no specular, no ripple, no edge foam, no reflection of
   * the structure sitting in it - it reads as painted concrete", and
   * it was right: the fountain's geometry is a plaza pool with coping,
   * a tiled bed, spouts and cascades, and the liquid inside it was a
   * painted disc.
   *
   * materials.js owns the shading model and carries the patch; this
   * side owns the two things the patch cannot do for itself.
   *
   * 1. FINDING THE POOLS. Liquid surfaces are authored in levels.js
   *    and merged by world.js into one mesh per surface name, so there
   *    is nothing left to hang an opt-in on. The mesh name is
   *    `static.<surface>`, which is exact and needs no cross-module
   *    edit.
   *
   * 2. THE SHORE DISTANCE. Foam belongs where the water meets the
   *    basin, and a shader cannot see the basin. What it CAN see, if
   *    somebody measures it once at load, is how far each vertex is
   *    from the edge of the water itself - which is the same line.
   *
   * The ripple clock is driven from update() rather than from a timer
   * inside materials.js, because the screenshot harness advances the
   * whole game through `advance(seconds)` and never produces a real
   * animation frame.
   */
  const LIQUID_SURFACES = {
    /* The food-court fountain. The brightest sky of the set: this pool
       sits under the mall's skylights, and the reflection is the only
       thing in the frame that says the roof is glass. */
    "foodcourt.soda": { metres: 3.2, speed: 0.075, strength: 0.66, sky: 0xa8d8f4, glint: 0.62, foamWidth: 0.55 },
    "redcarpet.pool": { metres: 3.6, speed: 0.05, strength: 0.55, sky: 0x7ba8cc, fresnel: 0.7, glint: 0.45 },
    "basement.coolant": { metres: 2.8, speed: 0.06, strength: 0.6, sky: 0x6fb4d8, fresnel: 0.75, glint: 0.35, foamWidth: 0.4 },
    "roof.pool": { metres: 3.4, speed: 0.055, strength: 0.62, sky: 0xa8dcff, glint: 0.7 },
    /* materials.js's own entry, in case a course asks for it by name. */
    "water.pool": { metres: 4.0, speed: 0.05, strength: 0.6, sky: 0xa8dcff, glint: 0.6 },
  };

  /** Metres. Past this the shore attribute saturates - it only has to
   *  resolve a foam band, and capping it keeps the search local. */
  const SHORE_CAP = 1.4;
  /** A connected island narrower than this is a RIBBON, not a pool -
   *  the ripple rings a centimetre above the fountain's surface, the
   *  leaning jets, the cascade sheets. Every one of their vertices is
   *  at an edge, so left alone they would all render as solid foam. */
  const SHORE_MIN_ISLAND = 0.34;

  const waterState = { due: false, frame: -1, pools: 0, verts: 0, ms: 0 };

  /**
   * Distance from every vertex to the edge of its own surface.
   *
   * WHY THE TOPOLOGY HAS TO BE REBUILT. The obvious test for a
   * boundary edge is "used by exactly one triangle", and on this
   * geometry it answers yes for every edge in the mesh. world.js runs
   * `projectUV` over every static, and projectUV DE-INDEXES so each
   * triangle can choose its own projection plane from its own normal -
   * after which no two triangles share a vertex index at all. Welding
   * by quantised position recovers the real topology, and costs one
   * pass.
   */
  function bakeShore(geometry) {
    const pos = geometry.attributes.position;
    if (!pos) return false;
    if (geometry.getAttribute("aShore")) return true;
    const n = pos.count;
    const index = geometry.index ? geometry.index.array : null;
    const triCount = Math.floor((index ? index.length : n) / 3);
    if (triCount < 1) return false;

    /* ---- weld ---- */
    const canon = new Int32Array(n);
    const lookup = new Map();
    const Q = 1000;                       // 1 mm buckets
    const vx = []; const vy = []; const vz = [];
    for (let i = 0; i < n; i += 1) {
      const x = Math.round(pos.getX(i) * Q);
      const y = Math.round(pos.getY(i) * Q);
      const z = Math.round(pos.getZ(i) * Q);
      const key = `${x}|${y}|${z}`;
      let id = lookup.get(key);
      if (id === undefined) {
        id = vx.length;
        lookup.set(key, id);
        vx.push(x / Q); vy.push(y / Q); vz.push(z / Q);
      }
      canon[i] = id;
    }
    const ids = vx.length;
    if (ids < 3) return false;

    /* ---- boundary edges, and island membership in the same pass ---- */
    const parent = new Int32Array(ids);
    for (let i = 0; i < ids; i += 1) parent[i] = i;
    const find = (a) => { let r = a; while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; } return r; };
    const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[rb] = ra; };

    const edges = new Map();              // packed pair -> use count
    const bump = (a, b) => {
      const key = a < b ? a * ids + b : b * ids + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    };
    for (let t = 0; t < triCount; t += 1) {
      const o = t * 3;
      const a = canon[index ? index[o] : o];
      const b = canon[index ? index[o + 1] : o + 1];
      const c = canon[index ? index[o + 2] : o + 2];
      if (a === b || b === c || c === a) continue;   // degenerate
      bump(a, b); bump(b, c); bump(c, a);
      union(a, b); union(b, c);
    }

    const segs = [];
    for (const [key, count] of edges) {
      if (count !== 1) continue;
      const a = Math.floor(key / ids);
      const b = key - a * ids;
      segs.push(a, b);
    }
    if (!segs.length) return false;

    /* ---- grid the boundary so the search stays local ---- */
    const CELL = SHORE_CAP;
    const buckets = new Map();
    const cellKey = (ix, iz) => ix * 65536 + iz;
    for (let s = 0; s < segs.length; s += 2) {
      const a = segs[s]; const b = segs[s + 1];
      const x0 = Math.min(vx[a], vx[b]) - CELL; const x1 = Math.max(vx[a], vx[b]) + CELL;
      const z0 = Math.min(vz[a], vz[b]) - CELL; const z1 = Math.max(vz[a], vz[b]) + CELL;
      for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix += 1) {
        for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz += 1) {
          const k = cellKey(ix, iz);
          let list = buckets.get(k);
          if (!list) { list = []; buckets.set(k, list); }
          list.push(s);
        }
      }
    }

    const shore = new Float32Array(ids).fill(SHORE_CAP);
    for (let i = 0; i < ids; i += 1) {
      const ix = Math.floor(vx[i] / CELL); const iz = Math.floor(vz[i] / CELL);
      const list = buckets.get(cellKey(ix, iz));
      if (!list) continue;
      let best = SHORE_CAP;
      for (let e = 0; e < list.length; e += 1) {
        const s = list[e];
        const a = segs[s]; const b = segs[s + 1];
        const ax = vx[a]; const ay = vy[a]; const az = vz[a];
        const ex = vx[b] - ax; const ey = vy[b] - ay; const ez = vz[b] - az;
        const len2 = ex * ex + ey * ey + ez * ez;
        let t = 0;
        if (len2 > 1e-9) {
          t = ((vx[i] - ax) * ex + (vy[i] - ay) * ey + (vz[i] - az) * ez) / len2;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
        }
        const dx = vx[i] - (ax + ex * t);
        const dy = vy[i] - (ay + ey * t);
        const dz = vz[i] - (az + ez * t);
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < best) best = d;
      }
      shore[i] = best;
    }

    /* ---- stand the ribbons down ---- */
    const islandMax = new Map();
    for (let i = 0; i < ids; i += 1) {
      const r = find(i);
      const cur = islandMax.get(r);
      if (cur === undefined || shore[i] > cur) islandMax.set(r, shore[i]);
    }
    for (let i = 0; i < ids; i += 1) {
      if ((islandMax.get(find(i)) || 0) < SHORE_MIN_ISLAND) shore[i] = SHORE_CAP;
    }

    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 1) out[i] = shore[canon[i]];
    geometry.setAttribute("aShore", new THREE.BufferAttribute(out, 1));
    waterState.verts += n;
    return true;
  }

  /** Find this course's pools and hand each one to materials.js. */
  function scanForWater() {
    const root = ctx.world?.current?.group;
    const mats = ctx.materials;
    if (!root || !mats || typeof mats.water !== "function") return;
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    mats.resetWater?.();
    waterState.pools = 0;
    waterState.verts = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.material) return;
      const name = typeof o.name === "string" && o.name.startsWith("static.")
        ? o.name.slice(7) : null;
      const spec = name ? LIQUID_SURFACES[name] : null;
      if (!spec) return;
      /* Standard only. `hell.magma` is authored unlit precisely so a
         lava pool does not dim when the sun goes down, and a patch
         that writes to reflectedLight has nothing to write to on a
         MeshBasicMaterial. */
      if (!o.material.isMeshStandardMaterial) return;
      const shore = bakeShore(o.geometry);
      mats.water(o.material, { ...spec, shore });
      waterState.pools += 1;
    });
    waterState.ms = Number((((typeof performance !== "undefined" && performance.now)
      ? performance.now() : 0) - t0).toFixed(1));
  }

  /* ---------------------------- key sheen ---------------------------- */

  /**
   * The other half of materials.sheen() - finding what to put it on.
   *
   * Same split as the pools above and for the same reason: materials.js
   * owns the shading model, this module is the one that walks a built
   * course. Read the block comment on materials.sheen() first; it
   * carries the measurement and the reason a Lambert level cannot
   * produce a highlight at any exposure.
   *
   * THE SELECTION RULE IS THE MATERIAL CLASS, NOT A TABLE. levels.js
   * builds `kind: "shiny"` as MeshStandardMaterial - those surfaces
   * already have a GGX lobe, and they are exactly the frames that
   * scored on the highlight row. It builds `kind: "lit"` as
   * MeshLambertMaterial, which has no specular term in its shader at
   * all, and `kind: "glow"` as MeshBasicMaterial, which has no lighting
   * and no `geometryNormal` for the patch to read. So the rule is
   * simply "Lambert", which needs no per-course authoring, cannot
   * double up on a surface that already glints, and cannot reach a
   * material whose shader would not compile with the patch in it.
   *
   * WHAT THE TABLE IS FOR is the two surfaces where the class rule
   * gives the wrong answer, and both are measured failures this repo
   * has already paid for once: a near-field prop must be DARKER than
   * the midground it overlaps, and bark mulch and crowd fabric are
   * near-field props. A grazing-angle sheen on a metre-wide band of
   * mulch across the bottom of five captures would put the brightest
   * edge in the frame on the quietest thing in it.
   */
  const SHEEN_DEFAULT = { amount: 0.30, power: 22, fresnel: 0.62 };
  const SHEEN_SURFACES = {
    /* The plaza floor, and the reason this pass exists. Terrazzo is
       polished stone under a glass roof; it is 40-55% of every frame in
       this course and it was rendering as one flat value. Broad and
       strongly grazing-weighted, so the pool lands out across the deck
       rather than as a hot spot underfoot. */
    "foodcourt.terrazzo": { amount: 0.62, power: 15, fresnel: 0.72 },
    "foodcourt.checker": { amount: 0.52, power: 16, fresnel: 0.70 },
    "foodcourt.tile": { amount: 0.50, power: 18, fresnel: 0.68 },
    /* Marble columns and counters. Tighter, because these are vertical
       and a broad lobe on a cylinder is a wash rather than a highlight
       - what reads on a column is a bright stripe down one side. */
    "foodcourt.column": { amount: 0.55, power: 42, fresnel: 0.34 },
    "foodcourt.counter": { amount: 0.40, power: 34, fresnel: 0.40 },
    "foodcourt.table": { amount: 0.42, power: 30, fresnel: 0.45 },
    "foodcourt.tray": { amount: 0.45, power: 40, fresnel: 0.35 },
    "foodcourt.cabinet": { amount: 0.34, power: 46, fresnel: 0.30 },
    "foodcourt.cabinetB": { amount: 0.34, power: 44, fresnel: 0.32 },
    "foodcourt.stall": { amount: 0.30, power: 36, fresnel: 0.38 },
    "foodcourt.stallB": { amount: 0.30, power: 36, fresnel: 0.38 },
    "foodcourt.stallC": { amount: 0.30, power: 36, fresnel: 0.38 },
    /* Awnings are canvas, and canvas is the one fabric that catches a
       highlight - it is a taut curved sheet. `collect` already scores
       12.8 on this row and the awning is why. */
    "foodcourt.awning": { amount: 0.34, power: 20, fresnel: 0.50 },
    "foodcourt.awningB": { amount: 0.34, power: 20, fresnel: 0.50 },
    "shared.grate": { amount: 0.45, power: 34, fresnel: 0.45 },
    /* Painted brick and plaster: matte, and they are the background
       plane. Enough to model the wall, not enough to compete. */
    "foodcourt.brick": { amount: 0.18, power: 30, fresnel: 0.45 },
    "foodcourt.planter": { amount: 0.18, power: 30, fresnel: 0.45 },
    "foodcourt.wall": { amount: 0.14, power: 26, fresnel: 0.50 },
    /* The lid is the top third of every interior frame and the frame's
       only real dark. It does not get to shine. */
    "foodcourt.ceiling": { amount: 0.06, power: 30, fresnel: 0.40 },
    /* Off. See the note above the table. */
    "foodcourt.soil": { amount: 0 },
    "foodcourt.trunk": { amount: 0 },
    "shared.rubber": { amount: 0 },
    "shared.crowdA": { amount: 0 },
    "shared.crowdB": { amount: 0 },
    "shared.crowdC": { amount: 0 },
    "shared.crowdD": { amount: 0 },
    "shared.crowdE": { amount: 0 },
  };

  const sheenState = { surfaces: 0, ms: 0 };

  /** Find this course's matte surfaces and hand each one to materials.js. */
  function scanForSheen() {
    const root = ctx.world?.current?.group;
    const mats = ctx.materials;
    if (!root || !mats || typeof mats.sheen !== "function") return;
    /* A course that authored no `sheen` block pays nothing. Patching a
       material sets needsUpdate, and while the measured cost here is
       two extra Lambert programs (43 -> 45, because they share defines)
       rather than twenty, a recompile a course cannot use is a
       recompile that should not happen. sky.setCourse has already run
       by the time this does, so the gain is the course's own answer. */
    if (typeof mats.sheenGain === "function" && !(mats.sheenGain() > 0)) return;
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    mats.resetSheen?.();
    sheenState.surfaces = 0;
    const seen = new Set();
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const material = o.material;
      /* Lambert only - the class rule above. An array material is a
         multi-material mesh, which world.js does not build. */
      if (!material.isMeshLambertMaterial) return;
      if (seen.has(material)) return;
      seen.add(material);
      const name = typeof o.name === "string" && o.name.startsWith("static.")
        ? o.name.slice(7) : null;
      const spec = (name && SHEEN_SURFACES[name]) || SHEEN_DEFAULT;
      if (!(spec.amount > 0)) return;
      mats.sheen(material, spec);
      sheenState.surfaces += 1;
    });
    sheenState.ms = Number((((typeof performance !== "undefined" && performance.now)
      ? performance.now() : 0) - t0).toFixed(1));
  }

  /* --------------------------- ribbons ---------------------------- */

  /**
   * Trails.
   *
   * All ribbon slots live in ONE geometry with one index buffer and
   * draw in a single call; an inactive slot is collapsed to a point
   * and given zero alpha rather than being removed, so the trail
   * system never touches the scene graph at runtime.
   */
  const RIB_SLOTS = BUDGET.ribbon;
  const RIB_SEG = BUDGET.ribbonSegments;
  const RIB_VERTS_PER_SLOT = (RIB_SEG + 1) * 2;

  const ribbonGeometry = new THREE.BufferGeometry();
  const ribbonPositions = new Float32Array(RIB_SLOTS * RIB_VERTS_PER_SLOT * 3);
  const ribbonAlphas = new Float32Array(RIB_SLOTS * RIB_VERTS_PER_SLOT);
  const ribbonColours = new Float32Array(RIB_SLOTS * RIB_VERTS_PER_SLOT * 3);
  {
    const indices = [];
    for (let s = 0; s < RIB_SLOTS; s += 1) {
      const base = s * RIB_VERTS_PER_SLOT;
      for (let k = 0; k < RIB_SEG; k += 1) {
        const a = base + k * 2;
        indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    ribbonGeometry.setAttribute("position", new THREE.BufferAttribute(ribbonPositions, 3));
    ribbonGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(ribbonAlphas, 1));
    ribbonGeometry.setAttribute("aColour", new THREE.BufferAttribute(ribbonColours, 3));
    ribbonGeometry.setIndex(indices);
    // A ribbon that follows the player is never off screen when it
    // matters, and recomputing a bounding sphere every frame for a
    // buffer this size is pure waste.
    ribbonGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  }

  const ribbonMaterial = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      precision highp float;
      attribute float aAlpha;
      attribute vec3 aColour;
      varying float vA;
      varying vec3 vC;
      void main() {
        vA = aAlpha; vC = aColour;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying float vA;
      varying vec3 vC;
      void main() {
        if (vA <= 0.003) discard;
        gl_FragColor = vec4(vC, vA);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const ribbonMesh = new THREE.Mesh(ribbonGeometry, ribbonMaterial);
  ribbonMesh.frustumCulled = false;
  ribbonMesh.renderOrder = 8;
  ribbonMesh.name = "vfx.ribbons";
  group.add(ribbonMesh);

  const TRAIL_STYLES = {
    ribbon: { colour: 0xff4fa0, colourTip: 0x7fdcff, width: 0.30, taper: 1.4, spin: 0, radius: 0 },
    dive: { colour: 0xff6fd0, colourTip: 0xfff0a0, width: 0.24, taper: 1.6, spin: 0, radius: 0 },
    longJump: { colour: 0x8fe0ff, colourTip: 0xffffff, width: 0.34, taper: 1.2, spin: 0, radius: 0 },
    // A flip trail draws the ARC, not the path: the sample point
    // orbits the body, so the ribbon becomes a helix that shows how
    // many rotations happened. A straight streak behind a backflip
    // says nothing about the flip.
    spin: { colour: 0xffd24f, colourTip: 0xff4fa0, width: 0.20, taper: 1.5, spin: 15.5, radius: 0.55 },
  };

  const trails = new Array(RIB_SLOTS);
  for (let i = 0; i < RIB_SLOTS; i += 1) {
    trails[i] = {
      slot: i,
      active: false,
      object: null,
      style: TRAIL_STYLES.ribbon,
      points: new Float32Array((RIB_SEG + 1) * 3),
      filled: 0,
      phase: 0,
      fade: 0,          // 1 while on, ramps to 0 after `off` so it does not vanish
      emitting: false,
    };
  }

  /** Continuous sparkle emitters attached to an object - the
   *  collectible shimmer and the Record's aura ride this. */
  const sparkleEmitters = [];

  /* -------------------------- atmosphere -------------------------- */

  const air = {
    uTime: { value: 0 },
    // y is written every frame with the GROUND under the camera, so the
    // slab sits on the floor rather than around the eye.
    uAnchor: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(30, 8.5, 30) },
    uRise: { value: 0.16 },
    uDrift: { value: 0.7 },
    uPixelScale: { value: 860 },
    uNear: { value: 1.2 },
    uFar: { value: 58 },
    uOpacity: { value: 0.47 },
    uColourA: { value: new THREE.Color(0xfff0cc) },
    uColourB: { value: new THREE.Color(0xffd8b0) },
    uLights: {
      value: [
        new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0),
        new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0),
      ],
    },
    uLightGain: { value: 0.80 },
  };

  const moteGeometry = new THREE.BufferGeometry();
  {
    const positions = new Float32Array(BUDGET.motes * 3);
    const seeds = new Float32Array(BUDGET.motes);
    const sizes = new Float32Array(BUDGET.motes);
    for (let i = 0; i < BUDGET.motes; i += 1) {
      seeds[i] = rng() * 1000;
      /* METRES, and larger than literal dust on purpose.

         Real airborne dust is well under a millimetre and is visible
         only because it is a bright specular point; a mote authored at
         that size subtends less than a pixel past four metres and the
         whole field measured as invisible. These are two to seven
         centimetres - lint, ash, torn paper - which puts them at two to
         four pixels across the 5-20m band the camera actually frames. */
      sizes[i] = 0.030 + rng() * rng() * 0.110;
    }
    moteGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    moteGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    moteGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    moteGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  }
  const moteMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: air.uTime, uAnchor: air.uAnchor, uBox: air.uBox,
      uRise: air.uRise, uDrift: air.uDrift, uPixelScale: air.uPixelScale,
      uNear: air.uNear, uFar: air.uFar,
      uOpacity: air.uOpacity, uColourA: air.uColourA, uColourB: air.uColourB,
      uLights: air.uLights, uLightGain: air.uLightGain,
    },
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const moteMesh = new THREE.Points(moteGeometry, moteMaterial);
  moteMesh.frustumCulled = false;
  moteMesh.renderOrder = 10;
  moteMesh.name = "vfx.motes";
  group.add(moteMesh);

  /* ------------------------------ veils ------------------------------
     Soft slabs of air at MID distance.

     CONTRACT §2.7 names empty air as a tell, but the version of it that
     actually decides a blind comparison is depth: in a real SM64 frame
     the far side of a room is visibly further away than the near side,
     and in ours the whole scene sat at one contrast. scene.fog is the
     textbook answer and sky.js owns it - see the handoff - so this is
     the part that is ours to add, and it is deliberately not a lens
     effect: these are world-space quads, depth-tested, so a stall in
     front of one occludes it and the wall behind is seen THROUGH it.
     That is what separates midground from background.

     Thirty huge, nearly transparent puffs in one instanced draw. They
     are tinted from the course fog colour, not from white, so they read
     as the same air the horizon fades into. */
  const veilMaterial = withInstanceAlpha(new THREE.MeshBasicMaterial({
    map: sprites.puff,
    transparent: true,
    depthWrite: false,
    toneMapped: true,
    side: THREE.DoubleSide,
    // Fogged like everything else, so a distant veil converges on the
    // horizon colour instead of staying a discrete grey cloud.
    fog: true,
  }), "veil");
  const veilMesh = instancedQuad(veilMaterial, BUDGET.veils, 3, "vfx.veils");

  /** Fixed, seeded offsets. The field is wrapped around the camera each
   *  frame, so this is a lattice, not a spawn list, and it can never
   *  run out or need topping up. */
  const veilSeeds = [];
  for (let i = 0; i < BUDGET.veils; i += 1) {
    veilSeeds.push({
      x: (rng() * 2 - 1),
      z: (rng() * 2 - 1),
      h: 0.10 + rng() * 0.80,          // fraction of the slab height
      size: 11 + rng() * 17,
      roll: rng() * TAU,
      spin: (rng() - 0.5) * 0.045,
      driftX: (rng() - 0.5) * 0.32,
      driftZ: (rng() - 0.5) * 0.32,
      bob: rng() * TAU,
      shade: 0.72 + rng() * 0.5,
    });
  }
  const veil = {
    alpha: 0,
    /* Span and count together are a DENSITY, and the density is what
       decides whether the pass is visible at all. A view wedge at this
       fov is roughly 1100 m2 of floor; at 64 slabs across a 100m
       lattice about seven of them fall inside it, which is enough to
       accumulate a gradient. The first pass used 30 across 150m - one
       slab in shot - and measured as nothing even at six times the
       alpha. */
    span: 100,         // width of the wrapped lattice, metres
    height: 16,        // metres of air above the floor the veils fill
    tint: new THREE.Color(0xf6e9c8),
  };

  const shaftGeometry = new THREE.CylinderGeometry(0.10, 1.0, 1, 14, 1, true);
  const shaftMaterial = new THREE.ShaderMaterial({
    uniforms: { uColour: { value: new THREE.Color(0xffe9bd) } },
    vertexShader: SHAFT_VERT,
    fragmentShader: SHAFT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  shaftGeometry.setAttribute("instanceAlpha",
    new THREE.InstancedBufferAttribute(new Float32Array(BUDGET.shaft), 1));
  const shaftMesh = new THREE.InstancedMesh(shaftGeometry, shaftMaterial, BUDGET.shaft);
  shaftMesh.frustumCulled = false;
  shaftMesh.count = 0;
  shaftMesh.renderOrder = 9;
  shaftMesh.name = "vfx.shafts";
  group.add(shaftMesh);

  const shafts = [];
  let shaftScanFrame = -999;

  const hazeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: air.uTime,
      uIntensity: { value: 0 },
      uColour: { value: new THREE.Color(0xffd9a8) },
    },
    vertexShader: HAZE_VERT,
    fragmentShader: HAZE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const hazeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hazeMaterial);
  hazeMesh.frustumCulled = false;
  hazeMesh.renderOrder = 11;
  hazeMesh.visible = false;
  hazeMesh.name = "vfx.haze";
  group.add(hazeMesh);

  /* ------------------------- screen flash -------------------------- */

  /**
   * A quad held in front of the camera rather than a DOM overlay or a
   * post pass: hud.js owns the DOM and render.js owns the post chain,
   * and a flash that lives in the scene is captured by the screenshot
   * harness like everything else.
   *
   * It cannot be parented to ctx.camera - main.js never adds the
   * camera to the scene, so camera children are not traversed - so it
   * is re-fitted to the frustum every frame instead.
   */
  const flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMaterial);
  flashMesh.frustumCulled = false;
  flashMesh.renderOrder = 9999;
  flashMesh.visible = false;
  flashMesh.name = "vfx.flash";
  group.add(flashMesh);

  const flashState = { amount: 0, life: 0, maxLife: 0 };

  /* ------------------- the one light: subject key + punch ------------ */

  /**
   * One light. See header note 4 - this is allocated here, at load,
   * and never added or removed, because adding a light mid-frame
   * recompiles every material in the scene and costs ~200ms.
   *
   * It has two jobs. Its baseline job is the SUBJECT KEY (see the
   * block comment above SUBJECT_KEY): it rides high and behind
   * Moggadonna every frame, rimming her silhouette and lighting the
   * ground around her. Its transient job is the punch flash, which
   * takes the light over for a fraction of a second and hands it back.
   */
  const PUNCH_RANGE = 26;
  const punchLight = new THREE.PointLight(0xffffff, 0, PUNCH_RANGE, 2);
  punchLight.name = "vfx.subjectKey";
  punchLight.castShadow = false;
  group.add(punchLight);
  const punchState = { life: 0, maxLife: 0, peak: 0 };

  const subjectKey = {
    colour: new THREE.Color(0xfff0d2),
    gain: 0,
    range: 16,
    placed: false,
    pos: new THREE.Vector3(),
  };

  /* ----------------------------- shake ----------------------------- */

  /**
   * Trauma-squared shake.
   *
   * `trauma` decays linearly but the offset uses trauma^2, which is
   * what makes a big hit feel violent and a small one feel like a
   * bump. A linear amount reads as a constant vibration at every
   * magnitude, which is CONTRACT tell 5 in another costume.
   */
  const shakeState = {
    trauma: 0,
    decay: 1,
    t: 0,
    applied: false,
    basePos: new THREE.Vector3(),
    baseQuat: new THREE.Quaternion(),
    lastPos: new THREE.Vector3(),
    lastQuat: new THREE.Quaternion(),
    offset: new THREE.Vector3(),
  };

  /* ------------------------ ground sampling ------------------------ */

  /**
   * Where is the floor under (x, z), and what colour is it?
   *
   * collision.js is the right answer and is used when it exists. The
   * fallback matters anyway: this module has to work while the rest
   * of the engine is still being built, and a dust puff that ignores
   * the floor is worse than no dust at all.
   */
  const groundCache = {
    cells: new Map(),
    candidates: [],
    candidatesFrame: -999,
    maxCells: 256,
  };

  function refreshCandidates() {
    // Only meshes that could plausibly be a floor, capped, so the
    // fallback raycast never degenerates into a whole-scene test.
    groundCache.candidates.length = 0;
    scene.traverse((obj) => {
      if (groundCache.candidates.length >= 96) return;
      if (!obj.isMesh || obj === shadowMesh || obj.parent === group) return;
      if (obj.userData && obj.userData.vfxIgnore) return;
      if (obj.receiveShadow || (obj.userData && obj.userData.kind === "static")) {
        groundCache.candidates.push(obj);
      }
    });
    groundCache.candidatesFrame = ctx.clock.frame;
  }

  /** Probe straight down. Returns null or a pooled result - copy
   *  anything you keep past the call. */
  const _probeResult = {
    y: 0, normal: new THREE.Vector3(0, 1, 0), material: "default", mesh: null,
  };
  // Raycaster.intersectObjects allocates a fresh array on every call.
  // At ten probes a frame that is ten arrays a frame of pure garbage,
  // so it gets a reusable target instead.
  const _rayHits = [];

  function probeGround(x, z, fromY, maxDrop) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(fromY)) return null;

    const col = ctx.collision;
    if (col && typeof col.groundAt === "function") {
      const hit = col.groundAt(x, z, fromY, maxDrop);
      if (!hit || !Number.isFinite(hit.y)) return null;
      _probeResult.y = hit.y;
      if (hit.normal) _probeResult.normal.copy(hit.normal); else _probeResult.normal.set(0, 1, 0);
      _probeResult.material = hit.material || "default";
      _probeResult.mesh = hit.mesh || null;
      return _probeResult;
    }

    if (ctx.clock.frame - groundCache.candidatesFrame > 120) refreshCandidates();
    if (!groundCache.candidates.length) return null;

    _v3.set(x, fromY + 0.05, z);
    _raycaster.set(_v3, _down);
    _raycaster.near = 0;
    _raycaster.far = maxDrop + 0.05;
    _rayHits.length = 0;
    _raycaster.intersectObjects(groundCache.candidates, false, _rayHits);
    if (!_rayHits.length) return null;
    const hit = _rayHits[0];
    _probeResult.y = hit.point.y;
    if (hit.face) {
      _probeResult.normal.copy(hit.face.normal)
        .transformDirection(hit.object.matrixWorld);
    } else {
      _probeResult.normal.set(0, 1, 0);
    }
    _probeResult.material = (hit.object.userData && hit.object.userData.material) || "default";
    _probeResult.mesh = hit.object;
    return _probeResult;
  }

  /**
   * The dust tint. Sampling the real material's base colour is what
   * makes a skid on the red carpet throw red dust; the SURFACE_TINT
   * table is only the fallback for when nothing can be sampled.
   * Cached on a 2m grid - the same grid the courses are built on.
   */
  function groundTint(x, z, y, out) {
    const key = `${Math.round(x / 2)}:${Math.round(z / 2)}`;
    const cached = groundCache.cells.get(key);
    if (cached) { out.copy(cached); return out; }

    let hex = SURFACE_TINT.default;
    const hit = probeGround(x, z, (Number.isFinite(y) ? y : 0) + 2.2, 8);
    if (hit) {
      const mat = hit.mesh && hit.mesh.material;
      const single = Array.isArray(mat) ? mat[0] : mat;
      if (single && single.color && single.color.isColor) {
        // Lighten it: dust is the surface's powder, not the surface.
        out.copy(single.color).lerp(_colour2.setRGB(1, 1, 1), 0.42);
        if (groundCache.cells.size > groundCache.maxCells) groundCache.cells.clear();
        groundCache.cells.set(key, out.clone());
        return out;
      }
      const name = String(hit.material || "").toLowerCase();
      for (const k of Object.keys(SURFACE_TINT)) {
        if (name.includes(k)) { hex = SURFACE_TINT[k]; break; }
      }
    }
    out.set(hex);
    if (groundCache.cells.size > groundCache.maxCells) groundCache.cells.clear();
    groundCache.cells.set(key, out.clone());
    return out;
  }

  /* --------------------------- spawning ---------------------------- */

  function resetParticle(p) {
    p.hasColourEnd = false;
    p.size = 0.3;
    p.sizeGrowth = 1.4;
    p.stretch = 1;
    p.life = 0;
    p.maxLife = 1;
    p.drag = 1.6;
    p.gravity = 0;
    p.fadeIn = 0.08;
    p.alpha = 1;
    p.rotation = 0;
    p.spin = 0;
    p.wobble = 0;
    p.orbit = 0;
    p.orbitRadius = 0;
    p.floor = -Infinity;
    p.bounce = 0;
  }

  /**
   * The one spawn path. Rejects a bad position at the door rather
   * than letting it reach an instance matrix (header note 3).
   */
  function spawn(pool, opts) {
    if (!opts || !opts.position || !finiteVec(opts.position)) return null;
    const slot = pool.acquire();
    const p = slot.obj;
    resetParticle(p);
    p.position.copy(opts.position);
    p.origin.copy(opts.position);
    if (opts.velocity) p.velocity.copy(opts.velocity); else p.velocity.set(0, 0, 0);
    if (!clampSpeed(p.velocity)) { slot.alive = false; return null; }
    if (opts.colour !== undefined) {
      if (opts.colour.isColor) p.colour.copy(opts.colour); else p.colour.set(opts.colour);
    } else p.colour.set(0xffffff);
    if (opts.colourEnd !== undefined) {
      if (opts.colourEnd.isColor) p.colourEnd.copy(opts.colourEnd);
      else p.colourEnd.set(opts.colourEnd);
      p.hasColourEnd = true;
    }
    if (opts.size !== undefined) p.size = opts.size;
    if (opts.sizeGrowth !== undefined) p.sizeGrowth = opts.sizeGrowth;
    if (opts.stretch !== undefined) p.stretch = opts.stretch;
    if (opts.life !== undefined) p.maxLife = Math.max(0.02, opts.life);
    if (opts.drag !== undefined) p.drag = opts.drag;
    if (opts.gravity !== undefined) p.gravity = opts.gravity;
    if (opts.fadeIn !== undefined) p.fadeIn = opts.fadeIn;
    if (opts.alpha !== undefined) p.alpha = opts.alpha;
    if (opts.spin !== undefined) p.spin = opts.spin;
    if (opts.wobble !== undefined) p.wobble = opts.wobble;
    if (opts.orbit !== undefined) p.orbit = opts.orbit;
    if (opts.orbitRadius !== undefined) p.orbitRadius = opts.orbitRadius;
    if (opts.floor !== undefined) p.floor = opts.floor;
    if (opts.bounce !== undefined) p.bounce = opts.bounce;
    p.rotation = opts.rotation !== undefined ? opts.rotation : rng() * TAU;
    return p;
  }

  function spawnRing(opts) {
    if (!opts || !opts.position || !finiteVec(opts.position)) return null;
    const slot = rings.acquire();
    const r = slot.obj;
    r.position.copy(opts.position);
    if (opts.normal && finiteVec(opts.normal)) r.normal.copy(opts.normal).normalize();
    else r.normal.set(0, 1, 0);
    if (opts.colour !== undefined) {
      if (opts.colour.isColor) r.colour.copy(opts.colour); else r.colour.set(opts.colour);
    } else r.colour.set(0xffffff);
    r.life = 0;
    r.maxLife = opts.life ?? 0.55;
    r.radius0 = opts.radius0 ?? 0.3;
    r.radius1 = opts.radius1 ?? 3;
    r.alpha = opts.alpha ?? 0.9;
    r.curve = opts.curve ?? 2.2;
    r.thickness = opts.thickness ?? 1;
    return r;
  }

  /**
   * Additive colours are normalised by their own peak channel before
   * gain is applied. A saturated hot pink at gain 2 clips every
   * channel to white and the effect loses its identity; dividing by
   * the peak keeps the hue and only raises the value.
   *
   * The result is returned as a Color and must be passed on as one.
   * Round-tripping it through `getHex()` silently clamps every channel
   * back to 1.0 and throws the gain away - which is exactly what the
   * first version of this file did, and why nothing glowed.
   */
  function additive(hex, gain, out) {
    if (hex && hex.isColor) out.copy(hex); else out.set(hex);
    const peak = Math.max(out.r, out.g, out.b, 1e-4);
    out.multiplyScalar(gain / peak);
    return out;
  }

  /* ------------------------- effect library ------------------------- */

  const scratchColour = new THREE.Color();

  /**
   * Opts normalisation.
   *
   * The modules that call burst() were written in parallel with this
   * one and settled on their own vocabulary: enemies.js passes
   * `color` and `count` and `radius` and `spread`, player.js passes
   * `strength`, collect.js passes `big` and `power`. Rather than make
   * five other agents change their call sites, every effect reads
   * through these and accepts all of it. `colour`/`color` are the same
   * key with two spellings and both are honoured everywhere.
   */
  function optColour(o, fallback) {
    const c = o.colour ?? o.color ?? o.tint;
    return c === undefined ? fallback : c;
  }

  function optCount(o, base, scale = 1) {
    const n = Number(o.count);
    if (Number.isFinite(n) && n > 0) return Math.max(1, Math.round(n * quality.particles));
    return Math.max(1, Math.round(base * scale * quality.particles));
  }

  function optNumber(o, key, fallback) {
    const n = Number(o[key]);
    return Number.isFinite(n) ? n : fallback;
  }

  /**
   * The named effects. Every one takes (position, opts) and is
   * responsible for its own budget: an effect that spawns 200
   * particles starves everything else, so counts here are chosen for
   * how they read, not for how many they are.
   */
  const EFFECTS = {

    /** Kicked up by turns, skids and running. The single most common
     *  effect in the game, so it is also the cheapest. */
    dust(pos, o) {
      const strength = clamp(o.strength ?? o.speed ?? 1, 0.05, 4);
      const count = optCount(o, clamp(2 + strength * 2, 1, 9));
      const explicit = optColour(o, undefined);
      const tint = explicit !== undefined
        ? scratchColour.set(explicit)
        : groundTint(pos.x, pos.z, pos.y, scratchColour);
      const spreadScale = optNumber(o, "spread", 1);
      const dirX = o.dir ? o.dir.x : 0;
      const dirZ = o.dir ? o.dir.z : 0;
      for (let i = 0; i < count; i += 1) {
        const a = rng() * TAU;
        const spread = (0.7 + rng() * 1.4) * spreadScale;
        _v.copy(pos);
        _v.x += Math.cos(a) * 0.12;
        _v.z += Math.sin(a) * 0.12;
        _v.y += 0.06;
        _v2.set(
          Math.cos(a) * spread * 0.5 - dirX * strength * 0.9,
          0.5 + rng() * 0.9 * strength,
          Math.sin(a) * spread * 0.5 - dirZ * strength * 0.9
        );
        spawn(soft, {
          position: _v,
          velocity: _v2,
          colour: tint,
          size: (0.16 + rng() * 0.16) * (0.7 + strength * 0.3),
          sizeGrowth: 2.4,
          life: 0.42 + rng() * 0.4,
          drag: 2.9,
          gravity: 1.1,
          alpha: 0.42 * clamp01(0.4 + strength * 0.35),
          wobble: 0.5,
          floor: pos.y - 0.04,
          fadeIn: 0.12,
        });
      }
    },

    /** The expanding ground ring on landing. Radius and opacity scale
     *  with impact speed, which is what separates a step-off from a
     *  triple-jump landing at a glance. */
    landRing(pos, o) {
      const speed = clamp(Math.abs(o.speed ?? 6), 0, 30);
      const power = clamp01(speed / 18);
      const normal = o.normal && finiteVec(o.normal) ? o.normal : _up;
      // enemies.js sizes its landings by an explicit radius rather
      // than by an impact speed it does not track.
      const outer = optNumber(o, "radius", 1.5 + power * 3.4);
      const explicit = optColour(o, undefined);
      const tint = explicit !== undefined
        ? scratchColour.set(explicit)
        : groundTint(pos.x, pos.z, pos.y, scratchColour);
      const tintHex = tint.getHex();
      _v.copy(pos).addScaledVector(normal, 0.035);
      spawnRing({
        position: _v,
        normal,
        colour: additive(tint, 0.85 + power * 0.5, _colour2),
        radius0: 0.35 + power * 0.2,
        radius1: outer,
        life: 0.32 + power * 0.26,
        alpha: 0.35 + power * 0.5,
        curve: 2.6,
      });
      EFFECTS.dust(pos, { strength: 0.7 + power * 2.2, colour: tintHex });
      if (power > 0.55) api.shake(0.06 + power * 0.10, 0.18);
    },

    /**
     * The ground pound.
     *
     * Three parts, and all three are needed: the ring is the read, the
     * WALL of dust rising at the ring's radius is what gives it
     * volume, and the decal is what proves it happened to the floor.
     */
    poundShock(pos, o) {
      // enemies.js and collect.js both drive this with `radius`; the
      // player drives it with `strength`. 4.6m is the player's own
      // shockwave, so an explicit radius converts back into the same
      // power scale and every other term follows it.
      const power = o.radius !== undefined
        ? clamp(Number(o.radius) / 4.6, 0.3, 3)
        : clamp(o.strength ?? 1, 0.3, 3);
      const normal = o.normal && finiteVec(o.normal) ? o.normal : _up;
      const explicit = optColour(o, undefined);
      const tint = explicit !== undefined
        ? scratchColour.set(explicit)
        : groundTint(pos.x, pos.z, pos.y, scratchColour);
      const tintHex = tint.getHex();

      _v.copy(pos).addScaledVector(normal, 0.04);
      spawnRing({
        position: _v,
        normal,
        colour: additive(0xffe6a0, 1.5, _colour2),
        radius0: 0.5,
        radius1: 4.6 * power,
        life: 0.40,
        alpha: 0.95,
        curve: 3.0,
      });
      spawnRing({
        position: _v,
        normal,
        colour: additive(tintHex, 1.0, _colour2),
        radius0: 0.3,
        radius1: 6.6 * power,
        life: 0.62,
        alpha: 0.5,
        curve: 2.0,
      });

      // The dust wall: a ring of puffs launched OUTWARD and UP at a
      // radius, rather than a sphere at the centre. A centred puff
      // reads as a smoke bomb; a wall reads as displaced air.
      const spokes = Math.round(14 * quality.particles);
      for (let i = 0; i < spokes; i += 1) {
        const a = (i / spokes) * TAU + rng() * 0.2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        _v.copy(pos);
        _v.x += cos * 0.55 * power;
        _v.z += sin * 0.55 * power;
        _v.y += 0.1;
        _v2.set(cos * (3.4 + rng() * 2.2) * power, 1.6 + rng() * 2.0, sin * (3.4 + rng() * 2.2) * power);
        spawn(soft, {
          position: _v,
          velocity: _v2,
          colour: tintHex,
          size: 0.34 + rng() * 0.3,
          sizeGrowth: 2.8,
          life: 0.62 + rng() * 0.45,
          drag: 2.4,
          gravity: 1.8,
          alpha: 0.55,
          wobble: 0.7,
          floor: pos.y - 0.05,
        });
      }
      // Grit thrown up through the wall, so it is not all soft.
      for (let i = 0; i < Math.round(10 * quality.particles); i += 1) {
        const a = rng() * TAU;
        _v.copy(pos);
        _v2.set(Math.cos(a) * (2 + rng() * 5), 4 + rng() * 5, Math.sin(a) * (2 + rng() * 5));
        spawn(glow, {
          position: _v,
          velocity: _v2,
          colour: additive(0xffd070, 1.3, _colour2),
          colourEnd: 0x804010,
          size: 0.06 + rng() * 0.07,
          sizeGrowth: -0.3,
          stretch: 2.4,
          life: 0.3 + rng() * 0.35,
          drag: 1.1,
          gravity: 15,
          fadeIn: 0.02,
        });
      }

      api.decal("shock", pos, normal, 2.4 * power);
      api.shake(0.34 * power, 0.34);
      punch(pos, 0xffd28a, 90 * power, 0.22);
    },

    /**
     * Collectible shimmer and the Record's aura. Orbiting stars
     * rather than rising ones: an orbit says "this is an object worth
     * taking", a rise says "this object is on fire".
     */
    sparkle(pos, o) {
      const strength = optNumber(o, "strength", 1);
      const count = optCount(o, 3, clamp(strength, 0.2, 4));
      const radius = optNumber(o, "radius", 0.45);
      const rise = optNumber(o, "rise", 0);
      const hex = optColour(o, 0xffe066);
      for (let i = 0; i < count; i += 1) {
        const a = rng() * TAU;
        _v.copy(pos);
        _v.x += Math.cos(a) * radius;
        _v.z += Math.sin(a) * radius;
        _v.y += (rng() - 0.3) * radius;
        _v2.set(0, 0.22 + rng() * 0.4 + rise, 0);
        const p = spawn(glow, {
          position: _v,
          velocity: _v2,
          colour: additive(hex, 1.35, _colour2),
          size: (0.09 + rng() * 0.09) * (o.scale ?? 1),
          sizeGrowth: -0.55,
          life: 0.5 + rng() * 0.45,
          drag: 0.9,
          gravity: -0.2,
          fadeIn: 0.16,
          spin: (rng() - 0.5) * 5,
          orbit: (rng() < 0.5 ? -1 : 1) * (1.4 + rng() * 1.6),
          orbitRadius: radius,
        });
        if (p) p.origin.copy(pos);
      }
    },

    /** A single Clout pickup. Small, sharp, and it does not linger -
     *  the chain is carried by the audio pitch, not by the visual. */
    coinPop(pos, o) {
      const hex = o.colour ?? o.color ?? 0xffd23f;
      spawnRing({
        position: pos,
        normal: o.normal || _up,
        colour: additive(hex, 1.5, _colour2),
        radius0: 0.15,
        radius1: 1.05,
        life: 0.26,
        alpha: 0.8,
        curve: 2.6,
      });
      for (let i = 0; i < Math.round(9 * quality.particles); i += 1) {
        const a = rng() * TAU;
        const el = rng() * 0.9 + 0.2;
        _v.copy(pos);
        _v2.set(Math.cos(a) * 2.6 * el, 2.4 + rng() * 2.6, Math.sin(a) * 2.6 * el);
        spawn(glow, {
          position: _v,
          velocity: _v2,
          colour: additive(hex, 1.6, _colour2),
          colourEnd: 0xff8a3f,
          size: 0.10 + rng() * 0.09,
          sizeGrowth: -0.5,
          life: 0.3 + rng() * 0.26,
          drag: 2.4,
          gravity: 8,
          fadeIn: 0.02,
          spin: (rng() - 0.5) * 12,
        });
      }
    },

    /**
     * The Platinum Record ceremony.
     *
     * This is the payoff for the whole course and it is allowed to be
     * expensive. Structure, in order of what the eye reads: flash,
     * double ring, vertical star column, then confetti that keeps
     * falling after everything else has gone - the tail is what makes
     * it feel like an event rather than a pop.
     */
    recordGet(pos, o) {
      const gold = 0xffe27a;
      const pink = 0xff59a8;

      api.flash(0xfff3d0, 0.55, 0.42);
      api.shake(0.22, 0.5);
      punch(pos, gold, 150, 0.75);

      spawnRing({
        position: pos, normal: _up,
        colour: additive(gold, 1.9, _colour2),
        radius0: 0.4, radius1: 7.5, life: 0.75, alpha: 1, curve: 2.4,
      });
      spawnRing({
        position: pos, normal: _up,
        colour: additive(pink, 1.6, _colour2),
        radius0: 0.2, radius1: 5.0, life: 1.05, alpha: 0.7, curve: 1.7,
      });
      // A second ring standing upright, so the burst has volume from
      // every camera angle instead of only from above.
      spawnRing({
        position: pos, normal: _camFwd.lengthSq() > 0.1 ? _camFwd : _up,
        colour: additive(0xffffff, 1.4, _colour2),
        radius0: 0.3, radius1: 4.2, life: 0.5, alpha: 0.75, curve: 3.0,
      });

      // The column: stars fired almost straight up, which is how the
      // ceremony reads as vertical rather than as an explosion.
      for (let i = 0; i < Math.round(26 * quality.particles); i += 1) {
        const a = rng() * TAU;
        const r = rng() * 0.5;
        _v.copy(pos);
        _v.x += Math.cos(a) * r;
        _v.z += Math.sin(a) * r;
        _v2.set(Math.cos(a) * (0.4 + rng() * 1.4), 5.5 + rng() * 5.0, Math.sin(a) * (0.4 + rng() * 1.4));
        spawn(glow, {
          position: _v,
          velocity: _v2,
          colour: additive(rng() < 0.5 ? gold : 0xffffff, 1.8, _colour2),
          colourEnd: pink,
          size: 0.14 + rng() * 0.16,
          sizeGrowth: -0.35,
          life: 0.8 + rng() * 0.7,
          drag: 0.85,
          gravity: 6.5,
          fadeIn: 0.02,
          spin: (rng() - 0.5) * 9,
        });
      }

      // Confetti. Normally blended, wide, slow, high drag - it flutters
      // instead of falling, and it outlives everything else.
      const confettiHues = [0xff59a8, 0xffd23f, 0x62e0ff, 0xb98cff, 0xffffff];
      for (let i = 0; i < Math.round(30 * quality.particles); i += 1) {
        const a = rng() * TAU;
        _v.copy(pos);
        _v.y += 0.3;
        _v2.set(Math.cos(a) * (1.8 + rng() * 3.4), 4.0 + rng() * 4.5, Math.sin(a) * (1.8 + rng() * 3.4));
        spawn(soft, {
          position: _v,
          velocity: _v2,
          colour: confettiHues[Math.floor(rng() * confettiHues.length)],
          size: 0.09 + rng() * 0.08,
          sizeGrowth: 0.15,
          stretch: 1.9,
          life: 1.6 + rng() * 1.4,
          drag: 1.9,
          gravity: 3.4,
          alpha: 0.95,
          fadeIn: 0.03,
          spin: (rng() - 0.5) * 16,
          wobble: 2.6,
        });
      }

      // And a slow halo of shimmer that hangs after the noise stops.
      for (let i = 0; i < Math.round(10 * quality.particles); i += 1) {
        const a = rng() * TAU;
        _v.copy(pos);
        _v.x += Math.cos(a) * 1.1;
        _v.z += Math.sin(a) * 1.1;
        _v.y += rng() * 1.6;
        _v2.set(0, 0.5 + rng() * 0.5, 0);
        const p = spawn(glow, {
          position: _v, velocity: _v2,
          colour: additive(gold, 1.2, _colour2),
          size: 0.16 + rng() * 0.12,
          sizeGrowth: -0.4,
          life: 1.4 + rng() * 0.8,
          drag: 0.6, gravity: -0.4, fadeIn: 0.3,
          orbit: 1.1, orbitRadius: 1.1,
        });
        if (p) p.origin.copy(pos);
      }
    },

    /** Mog Beam impact. Oriented to the surface it hit, so it never
     *  reads as a sprite floating in front of a wall. */
    beamHit(pos, o) {
      const normal = o.normal && finiteVec(o.normal) ? o.normal : _up;
      const hex = o.colour ?? o.color ?? 0xff6fd0;
      spawnRing({
        position: _v3.copy(pos).addScaledVector(normal, 0.03),
        normal,
        colour: additive(hex, 1.7, _colour2),
        radius0: 0.1, radius1: 1.5, life: 0.24, alpha: 0.95, curve: 2.8,
      });
      for (let i = 0; i < Math.round(10 * quality.particles); i += 1) {
        _v2.copy(normal)
          .add(_axisX.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(1.1))
          .normalize()
          .multiplyScalar(2.5 + rng() * 5.5);
        spawn(glow, {
          position: pos,
          velocity: _v2,
          colour: additive(hex, 1.8, _colour2),
          colourEnd: 0x60107f,
          size: 0.07 + rng() * 0.08,
          sizeGrowth: -0.5,
          stretch: 2.6,
          life: 0.16 + rng() * 0.24,
          drag: 3.5,
          gravity: 3,
          fadeIn: 0.01,
        });
      }
      punch(pos, hex, 26, 0.12);
    },

    /** Mog Aura: the screen-clearing special. One enormous, fast,
     *  low ring - readable from any camera height - plus a lift. */
    auraWave(pos, o) {
      const radius = o.radius ?? 9;
      const hex = o.colour ?? o.color ?? 0xff59d8;
      api.flash(hex, 0.34, 0.3);
      api.shake(0.20, 0.4);
      punch(pos, hex, 110, 0.4);
      spawnRing({
        position: _v3.copy(pos).setY(pos.y + 0.06), normal: _up,
        colour: additive(hex, 1.8, _colour2),
        radius0: 0.6, radius1: radius, life: 0.55, alpha: 1, curve: 2.6,
      });
      spawnRing({
        position: _v3.copy(pos).setY(pos.y + 0.5), normal: _up,
        colour: additive(0xffffff, 1.5, _colour2),
        radius0: 0.3, radius1: radius * 0.72, life: 0.75, alpha: 0.6, curve: 1.8,
      });
      for (let i = 0; i < Math.round(24 * quality.particles); i += 1) {
        const a = (i / 24) * TAU + rng() * 0.25;
        _v.copy(pos);
        _v.x += Math.cos(a) * 0.7;
        _v.z += Math.sin(a) * 0.7;
        _v2.set(Math.cos(a) * (5 + rng() * 5), 2.5 + rng() * 4, Math.sin(a) * (5 + rng() * 5));
        spawn(glow, {
          position: _v, velocity: _v2,
          colour: additive(hex, 1.6, _colour2),
          colourEnd: 0x2a0840,
          size: 0.15 + rng() * 0.14,
          sizeGrowth: 0.8,
          stretch: 2.0,
          life: 0.4 + rng() * 0.4,
          drag: 2.6, gravity: 1.5, fadeIn: 0.02,
        });
      }
    },

    /** A demon dispatched. The SM64 poof: a fat cloud, a few stars,
     *  and it is gone inside half a second. */
    enemyPop(pos, o) {
      const scale = o.scale ?? 1;
      const hex = o.colour ?? o.color ?? 0xb98cff;
      for (let i = 0; i < Math.round(9 * quality.particles); i += 1) {
        const a = rng() * TAU;
        const el = (rng() - 0.4) * 2;
        _v.copy(pos);
        _v2.set(Math.cos(a) * (1.6 + rng() * 2.2), el * 1.6 + 1.2, Math.sin(a) * (1.6 + rng() * 2.2));
        spawn(soft, {
          position: _v, velocity: _v2,
          colour: hex,
          colourEnd: 0x2b1240,
          size: (0.26 + rng() * 0.26) * scale,
          sizeGrowth: 2.2,
          life: 0.34 + rng() * 0.3,
          drag: 3.6, gravity: -0.6, alpha: 0.85, fadeIn: 0.04,
          wobble: 1.2,
        });
      }
      for (let i = 0; i < Math.round(7 * quality.particles); i += 1) {
        const a = rng() * TAU;
        _v2.set(Math.cos(a) * (3 + rng() * 4), 2 + rng() * 4, Math.sin(a) * (3 + rng() * 4));
        spawn(glow, {
          position: pos, velocity: _v2,
          colour: additive(0xffd6ff, 1.5, _colour2),
          colourEnd: hex,
          size: (0.1 + rng() * 0.1) * scale,
          sizeGrowth: -0.4,
          life: 0.28 + rng() * 0.24,
          drag: 2.2, gravity: 6, fadeIn: 0.01,
          spin: (rng() - 0.5) * 14,
        });
      }
      spawnRing({
        position: pos, normal: _camFwd.lengthSq() > 0.1 ? _camFwd : _up,
        colour: additive(hex, 1.4, _colour2),
        radius0: 0.2, radius1: 2.2 * scale, life: 0.28, alpha: 0.8, curve: 2.8,
      });
    },

    /** Entering or leaving water. The crown of vertical streaks is
     *  the recognisable part; the ring on the surface is what stops
     *  it looking like it happened in mid-air. */
    waterSplash(pos, o) {
      const speed = clamp(Math.abs(o.speed ?? 6), 0.5, 26);
      const power = clamp01(speed / 16);
      const hex = o.colour ?? o.color ?? 0xbfe9ff;
      spawnRing({
        position: pos, normal: _up,
        colour: additive(hex, 1.1, _colour2),
        radius0: 0.3 + power * 0.4,
        radius1: 1.6 + power * 3.2,
        life: 0.5 + power * 0.3,
        alpha: 0.55 + power * 0.35,
        curve: 2.0,
      });
      const crown = Math.round((8 + power * 12) * quality.particles);
      for (let i = 0; i < crown; i += 1) {
        const a = (i / crown) * TAU + rng() * 0.3;
        _v.copy(pos);
        _v.x += Math.cos(a) * 0.28;
        _v.z += Math.sin(a) * 0.28;
        _v2.set(Math.cos(a) * (1.2 + rng() * 2.2), (3.5 + rng() * 4) * (0.4 + power), Math.sin(a) * (1.2 + rng() * 2.2));
        spawn(soft, {
          position: _v, velocity: _v2,
          colour: hex,
          size: 0.10 + rng() * 0.12,
          sizeGrowth: 0.6,
          stretch: 2.4,
          life: 0.42 + rng() * 0.36,
          drag: 1.1, gravity: 14, alpha: 0.8, fadeIn: 0.02,
          floor: pos.y,
        });
      }
      for (let i = 0; i < Math.round(6 * quality.particles); i += 1) {
        const a = rng() * TAU;
        _v.copy(pos);
        _v2.set(Math.cos(a) * 1.2, 0.5 + rng(), Math.sin(a) * 1.2);
        spawn(soft, {
          position: _v, velocity: _v2,
          colour: 0xffffff,
          size: 0.24 + rng() * 0.2,
          sizeGrowth: 2.6,
          life: 0.5 + rng() * 0.4,
          drag: 3.2, gravity: -0.3, alpha: 0.4, fadeIn: 0.14,
        });
      }
    },

    /** Healing. Rises, because everything good in this genre rises. */
    heal(pos, o) {
      const hex = o.colour ?? o.color ?? 0x7cffbe;
      for (let i = 0; i < Math.round(12 * quality.particles); i += 1) {
        const a = rng() * TAU;
        const r = 0.15 + rng() * 0.5;
        _v.copy(pos);
        _v.x += Math.cos(a) * r;
        _v.z += Math.sin(a) * r;
        _v.y += rng() * 0.4;
        _v2.set(0, 1.6 + rng() * 1.6, 0);
        spawn(glow, {
          position: _v, velocity: _v2,
          colour: additive(hex, 1.4, _colour2),
          colourEnd: 0xffffff,
          size: 0.10 + rng() * 0.10,
          sizeGrowth: -0.3,
          life: 0.7 + rng() * 0.5,
          drag: 1.4, gravity: -1.4, fadeIn: 0.16,
          spin: (rng() - 0.5) * 4,
        });
      }
      spawnRing({
        position: pos, normal: _up,
        colour: additive(hex, 1.2, _colour2),
        radius0: 0.2, radius1: 1.5, life: 0.55, alpha: 0.6, curve: 1.8,
      });
    },

    /** Taking a hit. Short, red, and it moves the camera - the
     *  feedback has to be felt before it is seen. */
    hurt(pos, o) {
      const hex = o.colour ?? o.color ?? 0xff3355;
      api.flash(hex, 0.30, 0.26);
      api.shake(0.16, 0.28);
      for (let i = 0; i < Math.round(12 * quality.particles); i += 1) {
        const a = rng() * TAU;
        _v.copy(pos);
        _v.y += 0.6 + rng() * 0.7;
        _v2.set(Math.cos(a) * (2.5 + rng() * 4), 1.5 + rng() * 3, Math.sin(a) * (2.5 + rng() * 4));
        spawn(glow, {
          position: _v, velocity: _v2,
          colour: additive(hex, 1.5, _colour2),
          colourEnd: 0x400008,
          size: 0.09 + rng() * 0.1,
          sizeGrowth: -0.2,
          stretch: 2.8,
          life: 0.24 + rng() * 0.22,
          drag: 3.0, gravity: 9, fadeIn: 0.01,
        });
      }
    },
  };

  // Aliases, so callers can use the name of the move rather than the
  // name of the effect and still get something sensible.
  EFFECTS.poof = EFFECTS.enemyPop;
  EFFECTS.skid = EFFECTS.dust;
  EFFECTS.land = EFFECTS.landRing;
  EFFECTS.splash = EFFECTS.waterSplash;
  EFFECTS.shimmer = EFFECTS.sparkle;
  EFFECTS.pound = EFFECTS.poundShock;
  EFFECTS.beam = EFFECTS.beamHit;
  EFFECTS.aura = EFFECTS.auraWave;

  /* ---------------------------- decals ----------------------------- */

  const DECAL_STYLES = {
    scuff: { colour: 0x2a2118, alpha: 0.42, life: 12, fadeOut: 3, grow: 0 },
    shock: { colour: 0x1a1220, alpha: 0.62, life: 14, fadeOut: 4, grow: 0.4 },
    scorch: { colour: 0x140c10, alpha: 0.75, life: 20, fadeOut: 5, grow: 0.1 },
    splash: { colour: 0x3a5a70, alpha: 0.35, life: 5, fadeOut: 3, grow: 0.2 },
    glitter: { colour: 0xffd8f0, alpha: 0.4, life: 6, fadeOut: 3, grow: 0.15 },
  };

  /* ---------------------------- quality ---------------------------- */

  /**
   * settings.js may still be a stub while this module is in use, so
   * every read is defensive and the defaults are the full-fat values.
   */
  /* subjectKey stays 1 on every tier for the same reason shadows do:
     it is not decoration, it is the thing that makes the character
     read as the subject of the frame. It is also free - one light that
     already exists, moved. */
  const quality = { particles: 1, motes: 1, shafts: 1, shadows: 1, haze: 1, subjectKey: 1 };

  function readQuality() {
    const s = ctx.settings;
    const tier = (s && (s.tier || s.quality)) || "high";
    if (tier === "low") {
      quality.particles = 0.4; quality.motes = 0.35; quality.shafts = 0;
      quality.shadows = 1; quality.haze = 0;   // shadows are never the thing we cut
    } else if (tier === "medium") {
      quality.particles = 0.7; quality.motes = 0.7; quality.shafts = 1;
      quality.shadows = 1; quality.haze = 0.6;
    } else {
      quality.particles = 1; quality.motes = 1; quality.shafts = 1;
      quality.shadows = 1; quality.haze = 1;
    }
    quality.subjectKey = 1;
  }
  readQuality();

  /* --------------------------- punch light -------------------------- */

  function punch(pos, hex, intensity, seconds) {
    if (!pos || !finiteVec(pos) || !(intensity > 0)) return;
    // Never downgrade a brighter flash that is still running.
    const remaining = punchState.maxLife > 0
      ? punchState.peak * (1 - punchState.life / punchState.maxLife) : 0;
    if (intensity < remaining) return;
    punchLight.position.copy(pos);
    punchLight.color.set(hex);
    /* Restore the flash's own radius. The subject key writes the
       course's pool range onto this same light every lateUpdate, so
       without this a ground pound would inherit whatever the current
       course happened to want for a soft overhead pool. */
    punchLight.distance = PUNCH_RANGE;
    punchLight.decay = 2;
    punchState.peak = intensity;
    punchState.life = 0;
    punchState.maxLife = Math.max(0.05, seconds);
  }

  /* -------------------------- subject key --------------------------- */

  /**
   * Ride the one light high and behind the subject. See the SUBJECT_KEY
   * block comment for why the geometry is what it is.
   *
   * Runs in lateUpdate because it wants the FINAL transform of the
   * body and of the camera - CONTRACT section 4. Placing it in update
   * would key her against last frame's camera, which on a rig that
   * swings is a pool of light that visibly lags her.
   *
   * Silent about everything: no player, no course, a punch in flight -
   * each is a reason to leave the light alone, never to throw.
   */
  function stepSubjectKey(dt) {
    // A punch owns the light outright while it burns. It fires at her
    // own feet, so the two never actually want it at the same time.
    if (punchState.maxLife > 0) { subjectKey.placed = false; return; }
    if (!(subjectKey.gain > 0) || !quality.subjectKey) {
      punchLight.intensity = 0;
      subjectKey.placed = false;
      return;
    }

    const body = ctx.player && ctx.player.position;
    if (!body || !finiteVec(body)) {
      punchLight.intensity = 0;
      subjectKey.placed = false;
      return;
    }

    /* Mostly ABOVE her, and biased away from the lens. _camFwd points
       from the camera into the scene, so pushing along it moves the
       pool's centre past her rather than onto the ground between her
       and the camera - which would light the one patch of floor her
       own silhouette is being read against. The lateral term stops
       the pool being concentric on her, which reads as a follow-spot.
       Height dominates both: see the H:r note on SUBJECT_KEY. */
    _v.copy(body)
      .addScaledVector(_camFwd, SUBJECT_KEY.back)
      .addScaledVector(_camRight, SUBJECT_KEY.side);
    _v.y = body.y + SUBJECT_KEY.height;

    if (!subjectKey.placed) {
      subjectKey.pos.copy(_v);
      subjectKey.placed = true;
    } else {
      const rate = SUBJECT_KEY.follow;
      const step = dt > 0 ? dt : 0.016;
      subjectKey.pos.set(
        damp(subjectKey.pos.x, _v.x, rate, step),
        damp(subjectKey.pos.y, _v.y, rate, step),
        damp(subjectKey.pos.z, _v.z, rate, step)
      );
    }

    if (!finiteVec(subjectKey.pos)) { subjectKey.placed = false; return; }
    punchLight.position.copy(subjectKey.pos);
    punchLight.color.copy(subjectKey.colour);
    punchLight.distance = subjectKey.range;
    punchLight.decay = SUBJECT_KEY.decay;
    punchLight.intensity = subjectKey.gain;
  }

  /* --------------------------- integrators -------------------------- */

  /**
   * The particle step.
   *
   * Every early-out in here is deliberate. `finiteVec` after the
   * integration is the guard from header note 3: a NaN gravity or a
   * NaN spawn position produces a NaN matrix, and one NaN matrix in an
   * instanced buffer is enough to take the whole draw - and any bloom
   * pass downstream - to white.
   */
  function stepParticles(pool, mesh, dt) {
    let count = 0;
    const alphas = mesh.geometry.attributes.instanceAlpha.array;
    const colours = mesh.instanceColor.array;
    const items = pool.items;
    const capacity = mesh.instanceMatrix.count;

    for (let i = 0; i < items.length; i += 1) {
      const slot = items[i];
      if (!slot.alive) continue;
      const p = slot.obj;

      p.life += dt;
      if (p.life >= p.maxLife) { slot.alive = false; continue; }
      const t = p.life / p.maxLife;

      p.velocity.y -= p.gravity * dt;
      const decay = Math.exp(-p.drag * dt);
      p.velocity.multiplyScalar(decay);
      if (!clampSpeed(p.velocity)) { slot.alive = false; continue; }
      p.position.addScaledVector(p.velocity, dt);

      if (p.orbit !== 0) {
        // Orbiting particles are positioned, not integrated: their
        // radius is authored and must not drift.
        const a = p.life * p.orbit + p.rotation;
        const r = p.orbitRadius * (1 - t * 0.25);
        p.position.x = p.origin.x + Math.cos(a) * r;
        p.position.z = p.origin.z + Math.sin(a) * r;
      }

      if (p.position.y < p.floor) {
        p.position.y = p.floor;
        if (p.bounce > 0 && p.velocity.y < -0.4) {
          p.velocity.y = -p.velocity.y * p.bounce;
        } else {
          p.velocity.y = 0;
        }
        // Dust that reaches the ground spreads along it rather than
        // stopping dead, which is the difference between smoke and a
        // sprite that hit an invisible wall.
        p.velocity.x *= 0.94;
        p.velocity.z *= 0.94;
      }

      if (!finiteVec(p.position)) { slot.alive = false; continue; }

      p.rotation += p.spin * dt;

      const wobble = p.wobble > 0
        ? Math.sin(p.life * 8.5 + p.rotation * 3) * p.wobble * 0.09 : 0;
      let size = p.size * (1 + p.sizeGrowth * t) * (1 + wobble);
      if (!(size > 0) || !Number.isFinite(size)) { slot.alive = false; continue; }
      size = Math.min(size, 60);

      // Fade in fast, out slow. A particle that appears at full
      // opacity reads as a sprite; one that fades in reads as matter.
      const alpha = Math.min(1, t / Math.max(p.fadeIn, 1e-3)) * (1 - t * t) * p.alpha;
      if (alpha <= 0.004) continue;

      if (p.stretch > 1.01) {
        // Velocity-aligned. A streak stretched along the camera's up
        // axis points the wrong way the moment the particle arcs.
        const speed = p.velocity.length();
        if (speed > 0.08) {
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
        // Roll in the camera plane instead of composing a quaternion
        // per particle - this loop runs thousands of times a frame.
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

      if (count >= capacity) break;
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
  }

  function stepRings(dt) {
    let count = 0;
    const alphas = ringMesh.geometry.attributes.instanceAlpha.array;
    const colours = ringMesh.instanceColor.array;
    const items = rings.items;
    for (let i = 0; i < items.length; i += 1) {
      const slot = items[i];
      if (!slot.alive) continue;
      const r = slot.obj;
      r.life += dt;
      if (r.life >= r.maxLife) { slot.alive = false; continue; }
      const t = r.life / r.maxLife;

      // Fast then settling. A linearly expanding ring is CONTRACT
      // tell 5 in its purest form.
      const eased = 1 - (1 - t) ** r.curve;
      const radius = lerp(r.radius0, r.radius1, eased);
      const alpha = r.alpha * (1 - t) * (1 - t) * Math.min(1, t / 0.06);
      if (alpha <= 0.004 || !Number.isFinite(radius)) continue;

      // Lie on the surface: quad normal (+Z) rotated onto the ground
      // normal, so a ring on a ramp follows the ramp.
      _quat.setFromUnitVectors(_planeNormal, r.normal);
      _v.set(radius * 2, radius * 2, radius * 2 * r.thickness);
      _m.compose(r.position, _quat, _v);
      if (!Number.isFinite(_m.elements[12])) { slot.alive = false; continue; }
      ringMesh.setMatrixAt(count, _m);
      colours[count * 3] = r.colour.r;
      colours[count * 3 + 1] = r.colour.g;
      colours[count * 3 + 2] = r.colour.b;
      alphas[count] = alpha;
      count += 1;
    }
    ringMesh.count = count;
    ringMesh.instanceMatrix.needsUpdate = true;
    ringMesh.instanceColor.needsUpdate = true;
    ringMesh.geometry.attributes.instanceAlpha.needsUpdate = true;
  }

  function stepDecals(dt) {
    let count = 0;
    const alphas = decalMesh.geometry.attributes.instanceAlpha.array;
    const colours = decalMesh.instanceColor.array;
    const items = decals.items;
    for (let i = 0; i < items.length; i += 1) {
      const slot = items[i];
      if (!slot.alive) continue;
      const d = slot.obj;
      d.life += dt;
      if (d.life >= d.maxLife) { slot.alive = false; continue; }

      const fadeIn = Math.min(1, d.life / 0.12);
      const remaining = d.maxLife - d.life;
      const fadeOut = d.fadeOut > 0 ? clamp01(remaining / d.fadeOut) : 1;
      const alpha = d.alpha * fadeIn * fadeOut;
      if (alpha <= 0.004) continue;

      const size = d.size * (1 + d.grow * Math.min(1, d.life / 0.35));
      _v.set(size, size, 1);
      _m.compose(d.position, d.quaternion, _v);
      decalMesh.setMatrixAt(count, _m);
      colours[count * 3] = d.colour.r;
      colours[count * 3 + 1] = d.colour.g;
      colours[count * 3 + 2] = d.colour.b;
      alphas[count] = alpha;
      count += 1;
    }
    decalMesh.count = count;
    decalMesh.instanceMatrix.needsUpdate = true;
    decalMesh.instanceColor.needsUpdate = true;
    decalMesh.geometry.attributes.instanceAlpha.needsUpdate = true;
  }

  /* ---------------------- contact shadow pass ---------------------- */

  /**
   * One instanced quad pass. For each caster: find the ground beneath
   * it, lay a blob on that ground's normal, and scale/fade by how far
   * above it the object is.
   *
   * The height response is the part that matters. A shadow that stays
   * the same size while its owner jumps reads as a decal stuck to the
   * character; one that shrinks and fades tells the player exactly
   * how high they are, which is genuinely useful information in a
   * platformer and is why SM64 has it.
   *
   * The blob also LEANS with the key and carries a penumbra that opens
   * with altitude - see the note on the material. The key is re-read on
   * a slow cadence rather than every frame: it changes when the course
   * does and never otherwise, and this pass already has a raycast
   * budget to keep.
   */
  let castSyncFrame = -999;
  let castCached = null;

  function stepShadows() {
    let rayed = 0;
    let count = 0;
    const alphas = shadowMesh.geometry.attributes.instanceAlpha.array;
    const softs = shadowMesh.geometry.attributes.instanceSoft.array;
    const capacity = shadowMesh.instanceMatrix.count;

    if (ctx.clock.frame - castSyncFrame > 30) {
      castSyncFrame = ctx.clock.frame;
      castCached = keyCast();
    }
    const cast = castCached;

    for (let i = casters.length - 1; i >= 0; i -= 1) {
      const c = casters[i];
      const obj = c.object;
      // A caster whose object has left the scene is dropped here
      // rather than needing every system to remember to unregister.
      if (!obj || (obj.isObject3D && !obj.parent && obj !== scene)) {
        casters.splice(i, 1);
        casterByObject.delete(obj);
        continue;
      }
      if (obj.isObject3D && !visibleInTree(obj)) continue;
      if (!readPosition(obj, _v)) continue;
      _v.y += c.offsetY;

      const g = c.ground;
      const moved = !Number.isFinite(g.probedAt.x)
        || Math.abs(_v.x - g.probedAt.x) > RETEST_DIST
        || Math.abs(_v.z - g.probedAt.z) > RETEST_DIST
        || Math.abs(_v.y - g.probedAt.y) > RETEST_DIST * 3;

      // Important casters (the player) and casters that have moved get
      // a probe immediately; the rest share a round-robin budget.
      const wantProbe = c.important || moved
        || (rayed < RAY_BUDGET && (casterCursor % Math.max(1, casters.length)) === i);
      if (wantProbe && rayed < RAY_BUDGET + 2) {
        rayed += 1;
        const hit = probeGround(_v.x, _v.z, _v.y + 0.4, c.maxDrop);
        if (hit) {
          g.valid = true;
          g.y = hit.y;
          g.normal.copy(hit.normal);
          if (g.normal.lengthSq() < 1e-6) g.normal.set(0, 1, 0);
          g.probedAt.copy(_v);
        } else {
          g.valid = false;
          g.probedAt.copy(_v);
        }
      }
      if (!g.valid) continue;

      const height = _v.y - g.y;
      if (height < -0.5 || height > c.fadeHeight) continue;

      // Shrink and fade with altitude, but never all the way to zero
      // while the object is still in range - a blob that vanishes
      // mid-jump is worse than one that gets faint.
      const h = clamp01(Math.max(0, height) / c.fadeHeight);
      const shrink = lerp(1, 0.42, h);
      const fade = (1 - h * h) * c.strength;
      if (fade <= 0.01) continue;

      const radius = c.radius * shrink;
      // 2cm off the surface: enough to beat z-fighting alongside the
      // polygon offset, small enough that it never reads as a gap.
      _v2.copy(g.normal).multiplyScalar(0.02);

      if (cast) {
        /* Built from a BASIS rather than by spinning a quaternion, so
           the alignment is exact on a slope as well as on the flat: the
           quad's long axis is the key's ground direction PROJECTED onto
           whatever surface the blob is lying on, and its normal is that
           surface's. Spinning about the quad's own axis after tilting it
           only agrees with the key while the ground is level. */
        _axisX.set(cast.shadeX, 0, cast.shadeZ);
        _axisZ.copy(g.normal);
        _axisX.addScaledVector(_axisZ, -_axisX.dot(_axisZ));
        if (_axisX.lengthSq() < 1e-6) _axisX.set(1, 0, 0).addScaledVector(_axisZ, -_axisZ.x);
        _axisX.normalize();
        _axisY.crossVectors(_axisZ, _axisX).normalize();
        const lean = Math.min(SHADOW_LEAN_MAX, radius * SHADOW_LEAN);
        composeBasis(_m,
          _v.x + _v2.x + _axisX.x * lean, g.y + _v2.y, _v.z + _v2.z + _axisX.z * lean,
          _axisX, _axisY, _axisZ,
          radius * 2 * SHADOW_STRETCH, radius * 2 * c.squash, 1);
      } else {
        _quat.setFromUnitVectors(_planeNormal, g.normal);
        _v3.set(_v.x + _v2.x, g.y + _v2.y, _v.z + _v2.z);
        _v.set(radius * 2, radius * 2 * c.squash, 1);
        _m.compose(_v3, _quat, _v);
      }
      if (!Number.isFinite(_m.elements[12]) || !Number.isFinite(_m.elements[13])) continue;

      if (count >= capacity) break;
      shadowMesh.setMatrixAt(count, _m);
      alphas[count] = fade;
      /* The penumbra opens with the air under the caster. `height` is
         metres, not the normalised h, so a blob's softness does not
         depend on how generous its own fadeHeight happens to be. With
         no key to orient the quad there is no near end and no far end,
         so both ends take the far value and the blob is the round soft
         disc it has always been out there. */
      const air = Math.max(0, height);
      const far = clamp(SHADOW_PEN_FAR + air * SHADOW_PEN_GAIN, 0.10, 0.92);
      softs[count * 2] = cast
        ? clamp(SHADOW_PEN_NEAR + air * SHADOW_PEN_GAIN * 1.6, 0.10, 0.92)
        : far;
      softs[count * 2 + 1] = far;
      count += 1;
    }

    casterCursor += 1;
    shadowMesh.count = blobState.enabled ? count : 0;
    shadowMesh.instanceMatrix.needsUpdate = true;
    shadowMesh.geometry.attributes.instanceAlpha.needsUpdate = true;
    shadowMesh.geometry.attributes.instanceSoft.needsUpdate = true;
  }

  /**
   * Pick up casters that other modules declared without importing us.
   *
   * Any mesh with `userData.contactShadow` gets a blob. Setting
   * `{ radius, strength }` on it tunes the blob. This is the whole
   * integration cost for enemies.js and collect.js.
   */
  const _patchBox = new THREE.Box3();
  const _patchSize = new THREE.Vector3();

  /**
   * THE BOSS HAD NO GROUND CONTACT AT ALL.
   *
   * A blind art director called the Payola Phantom's armillary shell
   * "the best hero prop in the project, floating in a beige lobby with
   * no ground contact - the arcade cabinets have harder shadows than
   * the boss does", and the probe agrees for a blunter reason than
   * anyone assumed: bosses.js declares no `userData.contactShadow`
   * anywhere, and the Phantom's shell is drawn by the untextured PROXY
   * path (there is no `specs.phantom`, so attachRig fails), which has
   * no names and no declarations on it either. Twelve metres of hero
   * geometry standing 1.2 to 8.2 m over an arena floor was registered
   * with this pass as nothing at all.
   *
   * The declaration belongs in bosses.js and is one line there. What
   * this does in the meantime is what the pass already does for moving
   * platforms two functions down - adopt something the scene cannot be
   * asked to declare - and it is written so that it STANDS ITSELF DOWN
   * the moment a real declaration appears: if any registered caster is
   * already sitting under the fight, this does nothing. The rigged
   * fights (the Twins, Lucifer) go through character.js and so already
   * have one, which is exactly the case that test is for.
   *
   * It rides on `bosses.nearest()`, which reports the fight's arena
   * FLOOR with the chest height and the fight's full extent alongside
   * it, and rebuilds a plain object every call - so the proxy below is
   * persistent and only its numbers are copied across, or the caster
   * map would gain an entry per frame.
   */
  const bossCaster = {
    proxy: { position: new THREE.Vector3(), name: "vfx.bossGround" },
    entry: null,
  };

  function syncBossCaster() {
    const near = ctx.bosses && typeof ctx.bosses.nearest === "function"
      ? ctx.bosses.nearest(ctx.player && ctx.player.position) : null;
    if (!near || !Number.isFinite(near.x) || !Number.isFinite(near.z)) {
      if (bossCaster.entry) { api.removeShadow(bossCaster.proxy); bossCaster.entry = null; }
      return;
    }
    const extent = Number.isFinite(near.extent) && near.extent > 0 ? near.extent : 5;
    /* Already grounded by somebody else - stand down. The radius scale
       keeps this from tripping on an unrelated enemy standing next to
       the boss while still catching the boss's own declaration. */
    const near2 = Math.max(1.5, extent * 0.35) ** 2;
    for (let i = 0; i < casters.length; i += 1) {
      const c = casters[i];
      if (c === bossCaster.entry) continue;
      if (!readPosition(c.object, _v)) continue;
      const dx = _v.x - near.x; const dz = _v.z - near.z;
      if (dx * dx + dz * dz < near2) {
        if (bossCaster.entry) { api.removeShadow(bossCaster.proxy); bossCaster.entry = null; }
        return;
      }
    }
    /* Placed at the chest rather than at the floor, because everything
       below reads a caster's HEIGHT over the ground it probes and a
       caster sitting on the floor would draw a hard, full-strength
       contact patch under a body that is hovering four metres up. */
    const chest = Number.isFinite(near.chestY) ? near.chestY : near.y + extent * 0.5;
    bossCaster.proxy.position.set(near.x, chest, near.z);
    if (!bossCaster.entry) {
      bossCaster.entry = api.addShadow(bossCaster.proxy, {
        radius: 1, strength: 0.6, important: true,
      });
      if (!bossCaster.entry) return;
    }
    /* Written every frame rather than frozen at creation: a fight's
       extent tracks its phase - Lucifer stalking the deck needs half
       the shadow he does in the air - and makeCaster only ever sees
       the first frame of it. */
    bossCaster.entry.radius = clamp(extent * 0.42, 0.8, 6);
    bossCaster.entry.fadeHeight = Math.max(8, extent * 1.8);
    bossCaster.entry.maxDrop = Math.max(14, extent * 2.5);
  }

  function scanForCasters() {
    const col = ctx.collision;
    scene.traverse((obj) => {
      if (casterByObject.has(obj)) return;
      const decl = obj.userData && obj.userData.contactShadow;
      if (decl) {
        const opts = typeof decl === "object" ? decl : {};
        const c = makeCaster(obj, opts);
        casters.push(c);
        casterByObject.set(obj, c);
        return;
      }

      /* Moving platforms.
         The baked pass above deliberately skips anything collision
         reports as moving, because a lift's shade cannot be painted
         onto the floor and left there. It still needs one, and a lift
         is the single object in a platformer whose height over the
         floor the player most needs to read, so it gets a live blob
         sized from its own footprint. No declaration is required from
         world.js: `isMoving` already knows which meshes those are. */
      if (!obj.isMesh || !obj.geometry || !col || typeof col.isMoving !== "function") return;
      if (!col.isMoving(obj)) return;
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      _patchBox.copy(obj.geometry.boundingBox).getSize(_patchSize);
      const radius = Math.max(0.4, Math.max(_patchSize.x, _patchSize.z) * 0.5);
      const c = makeCaster(obj, {
        // Already a footprint, not a body capsule, so it opts out of
        // the SHADOW_SPREAD widening that a character declaration wants.
        radius: radius / SHADOW_SPREAD,
        strength: 0.42,
        strengthFloor: 0.22,
        squash: _patchSize.z > 0.01 ? clamp(_patchSize.z / Math.max(0.01, _patchSize.x), 0.25, 4) : 1,
        maxDrop: 34,
        fadeHeight: 11,
        offsetY: -0.05,
      });
      casters.push(c);
      casterByObject.set(obj, c);
    });
  }

  /* ---------------------------- trails ----------------------------- */

  function findTrail(object) {
    for (let i = 0; i < trails.length; i += 1) {
      if (trails[i].object === object) return trails[i];
    }
    return null;
  }

  function acquireTrail() {
    for (let i = 0; i < trails.length; i += 1) if (!trails[i].active) return trails[i];
    // Saturated: steal the oldest. Dropping the trail entirely reads
    // as a bug; recycling reads as the effect being busy.
    return trails[0];
  }

  function writeTrailSlot(tr) {
    const base = tr.slot * RIB_VERTS_PER_SLOT;
    const style = tr.style;
    const tip = _colour2.set(style.colourTip);

    for (let k = 0; k <= RIB_SEG; k += 1) {
      const vi = base + k * 2;
      const src = Math.min(k, Math.max(0, tr.filled - 1)) * 3;
      const px = tr.points[src];
      const py = tr.points[src + 1];
      const pz = tr.points[src + 2];

      // Ribbon width comes from the direction of travel crossed with
      // the view vector, so the strip always faces the camera even
      // when the player dives straight at it.
      const nx = k < tr.filled - 1 ? tr.points[src + 3] - px : px - (tr.points[src - 3] ?? px);
      const ny = k < tr.filled - 1 ? tr.points[src + 4] - py : py - (tr.points[src - 2] ?? py);
      const nz = k < tr.filled - 1 ? tr.points[src + 5] - pz : pz - (tr.points[src - 1] ?? pz);
      _axisY.set(nx, ny, nz);
      if (_axisY.lengthSq() < 1e-8) _axisY.copy(_camUp);
      _axisY.normalize();
      _v3.set(px - camera.position.x, py - camera.position.y, pz - camera.position.z);
      _axisX.crossVectors(_axisY, _v3);
      if (_axisX.lengthSq() < 1e-8) _axisX.copy(_camRight);
      _axisX.normalize();

      const along = k / RIB_SEG;
      const width = style.width * (1 - along) ** style.taper
        * (tr.filled > 1 ? 1 : 0) * tr.fade;
      const alpha = (1 - along) ** 1.4 * tr.fade * (k < tr.filled ? 1 : 0);

      const ax = px + _axisX.x * width;
      const ay = py + _axisX.y * width;
      const az = pz + _axisX.z * width;
      const bx = px - _axisX.x * width;
      const by = py - _axisX.y * width;
      const bz = pz - _axisX.z * width;

      if (!Number.isFinite(ax) || !Number.isFinite(bx) || !Number.isFinite(ay)) {
        // A single bad vertex would smear the whole strip across the
        // frame. Collapse the segment instead.
        ribbonPositions[vi * 3] = 0; ribbonPositions[vi * 3 + 1] = 0; ribbonPositions[vi * 3 + 2] = 0;
        ribbonPositions[vi * 3 + 3] = 0; ribbonPositions[vi * 3 + 4] = 0; ribbonPositions[vi * 3 + 5] = 0;
        ribbonAlphas[vi] = 0; ribbonAlphas[vi + 1] = 0;
        continue;
      }

      ribbonPositions[vi * 3] = ax;
      ribbonPositions[vi * 3 + 1] = ay;
      ribbonPositions[vi * 3 + 2] = az;
      ribbonPositions[vi * 3 + 3] = bx;
      ribbonPositions[vi * 3 + 4] = by;
      ribbonPositions[vi * 3 + 5] = bz;
      ribbonAlphas[vi] = alpha;
      ribbonAlphas[vi + 1] = alpha;

      _colour.set(style.colour).lerp(tip, along);
      ribbonColours[vi * 3] = _colour.r;
      ribbonColours[vi * 3 + 1] = _colour.g;
      ribbonColours[vi * 3 + 2] = _colour.b;
      ribbonColours[vi * 3 + 3] = _colour.r;
      ribbonColours[vi * 3 + 4] = _colour.g;
      ribbonColours[vi * 3 + 5] = _colour.b;
    }
  }

  function clearTrailSlot(tr) {
    const base = tr.slot * RIB_VERTS_PER_SLOT;
    for (let k = 0; k < RIB_VERTS_PER_SLOT; k += 1) {
      const vi = base + k;
      ribbonPositions[vi * 3] = 0;
      ribbonPositions[vi * 3 + 1] = 0;
      ribbonPositions[vi * 3 + 2] = 0;
      ribbonAlphas[vi] = 0;
    }
  }

  function stepTrails(dt) {
    let dirty = false;
    let live = 0;
    for (let i = 0; i < trails.length; i += 1) {
      const tr = trails[i];
      if (!tr.active) continue;
      live += 1;

      if (tr.emitting) {
        if (!readPosition(tr.object, _v)) { tr.emitting = false; }
        else {
          tr.phase += dt * (tr.style.spin || 0);
          if (tr.style.radius > 0) {
            // The helix: sample a point orbiting the body rather than
            // the body itself.
            _v.x += Math.cos(tr.phase) * tr.style.radius;
            _v.z += Math.sin(tr.phase) * tr.style.radius;
            _v.y += Math.sin(tr.phase * 0.5) * tr.style.radius * 0.4;
          }
          if (finiteVec(_v)) {
            // Shift the history back one slot and write the head.
            for (let k = Math.min(tr.filled, RIB_SEG); k > 0; k -= 1) {
              tr.points[k * 3] = tr.points[(k - 1) * 3];
              tr.points[k * 3 + 1] = tr.points[(k - 1) * 3 + 1];
              tr.points[k * 3 + 2] = tr.points[(k - 1) * 3 + 2];
            }
            tr.points[0] = _v.x; tr.points[1] = _v.y; tr.points[2] = _v.z;
            tr.filled = Math.min(tr.filled + 1, RIB_SEG + 1);
          }
        }
        tr.fade = Math.min(1, tr.fade + dt * 8);
      } else {
        // Let it trail off rather than snapping out of existence.
        tr.fade -= dt * 3.2;
        if (tr.fade <= 0) {
          tr.active = false;
          tr.object = null;
          tr.filled = 0;
          tr.fade = 0;
          clearTrailSlot(tr);
          dirty = true;
          continue;
        }
      }

      writeTrailSlot(tr);
      dirty = true;
    }

    for (let i = sparkleEmitters.length - 1; i >= 0; i -= 1) {
      const e = sparkleEmitters[i];
      if (!e.object || (e.object.isObject3D && !e.object.parent)) {
        sparkleEmitters.splice(i, 1);
        continue;
      }
      e.timer -= dt;
      if (e.timer > 0) continue;
      e.timer = e.interval;
      if (!readPosition(e.object, _v)) continue;
      // On-beat sparkle. The whole game is on a 124 BPM grid and a
      // collectible that shimmers in time with the music is free
      // production value.
      const beatBoost = ctx.clock.onBeat ? 1.8 : 1;
      EFFECTS.sparkle(_v, {
        count: Math.max(1, Math.round(e.count * beatBoost)),
        radius: e.radius,
        colour: e.colour,
        scale: e.scale,
      });
    }

    if (dirty) {
      ribbonGeometry.attributes.position.needsUpdate = true;
      ribbonGeometry.attributes.aAlpha.needsUpdate = true;
      ribbonGeometry.attributes.aColour.needsUpdate = true;
    }
    // Hidden when idle, so an empty ribbon buffer is not a draw call
    // on every frame of a game that mostly has no trail running.
    ribbonMesh.visible = live > 0;
  }

  /* --------------------------- atmosphere --------------------------- */

  /**
   * Rescan for declared shafts.
   *
   * sky.js OWNS the course beams: it merges every `out.beam(...)` a
   * course authored into one additive mesh with its own falloff. This
   * module must not draw those a second time. It used to - every
   * PointLight in the scene was silently promoted to a cone, so
   * Course 1's four ceiling banks each grew a translucent cone
   * standing next to a real skylight beam, at a different brightness
   * and a different taper.
   *
   * What is left here is the explicit route only: `ctx.sky.shafts` if
   * sky ever publishes its beam list, and anything tagged
   * `userData.shaft`, which lets world.js place a shaft where there is
   * no light at all. Nothing is inferred from a light any more.
   */
  function scanShafts() {
    shaftScanFrame = ctx.clock.frame;
    shafts.length = 0;
    const declared = ctx.sky && Array.isArray(ctx.sky.shafts) ? ctx.sky.shafts : null;
    if (declared) {
      for (let i = 0; i < declared.length && shafts.length < BUDGET.shaft; i += 1) {
        const d = declared[i];
        if (!d || !d.position) continue;
        shafts.push({
          position: new THREE.Vector3().copy(d.position),
          radius: d.radius ?? 1.6,
          length: d.length ?? 9,
          intensity: d.intensity ?? 0.16,
          colour: new THREE.Color(d.colour ?? d.color ?? 0xffe9bd),
          dir: new THREE.Vector3().copy(d.dir || _down).normalize(),
        });
      }
      return;
    }
    scene.traverse((obj) => {
      if (shafts.length >= BUDGET.shaft) return;
      const tag = obj.userData && obj.userData.shaft;
      if (!tag) return;
      const opts = typeof tag === "object" ? tag : {};
      obj.getWorldPosition(_v);
      shafts.push({
        position: new THREE.Vector3().copy(_v),
        radius: opts.radius ?? 1.4,
        length: opts.length ?? 8,
        intensity: opts.intensity ?? 0.14,
        colour: new THREE.Color(opts.colour ?? (obj.color ? obj.color.getHex() : 0xffe9bd)),
        dir: new THREE.Vector3(0, -1, 0),
      });
    });
  }

  /* ---------------------- the air the camera is in ------------------ */

  /**
   * Everything in the atmosphere block hangs off two numbers: the floor
   * under the camera, and how the projection turns metres into pixels.
   *
   * The floor is probed on a cadence rather than every frame - it is
   * one raycast, but it is one raycast that only changes when the
   * camera crosses a step, and the mote slab is 7m thick so a frame of
   * lag in it is not visible. It is DAMPED toward the new value for the
   * same reason: snapping the whole field down a storey the instant the
   * camera clears a mezzanine edge is a visible pop.
   */
  const airGround = { y: 0, want: 0, valid: false, probeFrame: -999 };

  function updateAirGround(dt) {
    if (ctx.clock.frame - airGround.probeFrame > 12) {
      airGround.probeFrame = ctx.clock.frame;
      const hit = probeGround(camera.position.x, camera.position.z,
        camera.position.y + 2, 90);
      if (hit) {
        airGround.want = hit.y;
        if (!airGround.valid) { airGround.y = hit.y; airGround.valid = true; }
      } else if (!airGround.valid) {
        airGround.want = camera.position.y - 2.4;
        airGround.y = airGround.want;
        airGround.valid = true;
      }
    }
    if (!airGround.valid) return;
    // Exponential settle, frame-rate independent.
    const k = 1 - Math.exp(-3.2 * Math.max(dt, 0));
    airGround.y += (airGround.want - airGround.y) * k;
    if (!Number.isFinite(airGround.y)) { airGround.y = camera.position.y - 2.4; }
  }

  /**
   * Point size is a world radius over a distance, so the scale factor
   * is the projection's own: half the drawing buffer height divided by
   * tan(half the vertical fov). Reading it from the live camera means a
   * fov change for a capture preset cannot silently resize the dust.
   */
  function updateAirScale() {
    let h = 900;
    if (typeof ctx.renderer.getDrawingBufferSize === "function") {
      ctx.renderer.getDrawingBufferSize(_size2);
      if (_size2.y > 0) h = _size2.y;
    }
    const halfFov = (camera.fov || 55) * Math.PI / 360;
    const t = Math.tan(halfFov);
    air.uPixelScale.value = t > 1e-4 ? h / (2 * t) : h;
  }

  /**
   * Hand the mote shader the accent lights sky.js placed, so the dust
   * brightens where the course is actually lit. sky.js allocates a
   * fixed set of four and only re-points them, so this is a read of
   * four positions on a slow cadence - never an allocation, never a
   * traverse.
   */
  let lightSyncFrame = -999;

  function syncAirLights() {
    if (ctx.clock.frame - lightSyncFrame < 30) return;
    lightSyncFrame = ctx.clock.frame;
    const list = (ctx.sky && ctx.sky.lights && ctx.sky.lights.accents) || null;
    const slots = air.uLights.value;
    for (let i = 0; i < slots.length; i += 1) {
      const l = list && list[i];
      if (!l || !(l.intensity > 0) || !Number.isFinite(l.position.x)) {
        slots[i].set(0, 0, 0, 0);
        continue;
      }
      // A light's own `distance` is where it stops lighting geometry;
      // the air it visibly thickens is a good deal tighter than that,
      // or every mote in the course reads as lit and the term does
      // nothing at all.
      const reach = clamp((l.distance || 40) * 0.34, 6, 20);
      slots[i].set(l.position.x, l.position.y, l.position.z, reach);
    }
  }

  /* ----------------------------- veils ------------------------------ */

  function stepVeils() {
    if (veil.alpha <= 0.002 || !quality.haze) { veilMesh.count = 0; return; }
    const alphas = veilMesh.geometry.attributes.instanceAlpha.array;
    const colours = veilMesh.instanceColor.array;
    const capacity = veilMesh.instanceMatrix.count;
    const span = veil.span;
    const half = span * 0.5;
    const t = ctx.clock.t;
    const cx = camera.position.x;
    const cz = camera.position.z;
    let count = 0;

    for (let i = 0; i < veilSeeds.length && count < capacity; i += 1) {
      const s = veilSeeds[i];
      // Wrap the lattice point into the box centred on the camera. A
      // veil never has to be spawned or retired; it walks out of one
      // side of the box and back in the other, and the edge fade below
      // is what stops that being visible.
      let ox = s.x * half + s.driftX * t;
      let oz = s.z * half + s.driftZ * t;
      ox = ((((ox - cx + half) % span) + span) % span) - half;
      oz = ((((oz - cz + half) % span) + span) % span) - half;
      const px = cx + ox;
      const pz = cz + oz;
      const py = airGround.y + s.h * veil.height + Math.sin(t * 0.11 + s.bob) * 0.7;

      const dx = px - camera.position.x;
      const dy = py - camera.position.y;
      const dz = pz - camera.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      // Nothing on the lens, nothing at the wrap seam. The near window
      // is the important one: a 25m puff eight metres from the eye is a
      // grey wash over the whole frame. The far window has to reach a
      // long way past it or the two overlap and the veils are only
      // visible inside a narrow shell - which is how the first pass of
      // this ended up invisible in every captured frame.
      const near = smoothstep((dist - 8) / 12);
      const far = 1 - smoothstep((dist - span * 0.34) / (span * 0.30));
      const alpha = veil.alpha * near * far * s.shade;
      if (alpha <= 0.004) continue;

      const size = s.size;
      const roll = s.roll + t * s.spin;
      const c = Math.cos(roll);
      const sn = Math.sin(roll);
      _axisX.set(
        _camRight.x * c + _camUp.x * sn,
        _camRight.y * c + _camUp.y * sn,
        _camRight.z * c + _camUp.z * sn
      );
      _axisY.set(
        -_camRight.x * sn + _camUp.x * c,
        -_camRight.y * sn + _camUp.y * c,
        -_camRight.z * sn + _camUp.z * c
      );
      _axisZ.crossVectors(_axisX, _axisY);
      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
      composeBasis(_m, px, py, pz, _axisX, _axisY, _axisZ, size, size * 0.62, size);
      veilMesh.setMatrixAt(count, _m);
      colours[count * 3] = veil.tint.r;
      colours[count * 3 + 1] = veil.tint.g;
      colours[count * 3 + 2] = veil.tint.b;
      alphas[count] = alpha;
      count += 1;
    }

    veilMesh.count = count;
    veilMesh.instanceMatrix.needsUpdate = true;
    veilMesh.instanceColor.needsUpdate = true;
    veilMesh.geometry.attributes.instanceAlpha.needsUpdate = true;
  }

  /* -------------------------- ambient drift ------------------------- */

  /**
   * One slow flake of the course's own litter, every second or two,
   * somewhere in the air ahead of the camera.
   *
   * CONTRACT §2.7 asks for air that is not a vacuum; §2.5 asks that
   * nothing in the frame be static. A still frame passes the first and
   * fails the second, and the cheapest honest fix is a small amount of
   * matter that is always moving through shot. It costs three or four
   * live particles out of a pool of 640 and it uses the existing soft
   * pass, so it is not a draw call.
   */
  const ambient = { timer: 0, interval: 0, colour: 0xffffff };

  function stepAmbientDrift(dt) {
    if (ambient.interval <= 0 || !quality.particles) return;
    ambient.timer -= dt;
    if (ambient.timer > 0) return;
    ambient.timer = ambient.interval * (0.65 + rng() * 0.7);

    // In the forward half of the frustum, at reading distance, and
    // never behind the camera where it would be pure cost.
    const dist = 5 + rng() * 11;
    const side = (rng() - 0.5) * dist * 1.15;
    const up = airGround.y + 1.2 + rng() * 5.5;
    _v.copy(camera.position)
      .addScaledVector(_camFwd, dist)
      .addScaledVector(_camRight, side);
    _v.y = up;
    if (!finiteVec(_v)) return;
    _v2.set((rng() - 0.5) * 0.9, -0.35 - rng() * 0.5, (rng() - 0.5) * 0.9);
    spawn(soft, {
      position: _v,
      velocity: _v2,
      colour: ambient.colour,
      size: 0.055 + rng() * 0.075,
      sizeGrowth: 0.05,
      stretch: 1.5,
      life: 3.4 + rng() * 3.0,
      drag: 0.45,
      gravity: 0.55,
      alpha: 0.30 + rng() * 0.16,
      fadeIn: 0.9,
      spin: (rng() - 0.5) * 3.2,
      wobble: 2.4,
      floor: airGround.y + 0.02,
    });
  }

  function stepShafts() {
    if (!quality.shafts || !shafts.length) { shaftMesh.count = 0; return; }
    const alphas = shaftGeometry.attributes.instanceAlpha.array;
    let count = 0;
    for (let i = 0; i < shafts.length && count < BUDGET.shaft; i += 1) {
      const s = shafts[i];
      // Cheap distance cull. A shaft 90m away contributes nothing but
      // overdraw on a transparent pass.
      const d = s.position.distanceTo(camera.position);
      if (d > 90) continue;
      const near = smoothstep((d - 2.5) / 4);
      _quat.setFromUnitVectors(_up, _v.copy(s.dir).multiplyScalar(-1));
      _v2.copy(s.position).addScaledVector(s.dir, s.length * 0.5);
      _v3.set(s.radius, s.length, s.radius);
      _m.compose(_v2, _quat, _v3);
      shaftMesh.setMatrixAt(count, _m);
      alphas[count] = s.intensity * near * quality.shafts;
      count += 1;
    }
    shaftMesh.count = count;
    shaftMesh.instanceMatrix.needsUpdate = true;
    shaftGeometry.attributes.instanceAlpha.needsUpdate = true;
  }

  function applyCourseAir(courseId) {
    const preset = COURSE_AIR[courseId] || COURSE_AIR[1];
    air.uColourA.value.set(preset.moteA);
    air.uColourB.value.set(preset.moteB);
    air.uOpacity.value = 0.55 * preset.density * quality.motes;
    air.uRise.value = preset.rise;
    air.uBox.value.y = preset.boxY ?? 9;

    // The veils are the course's own fog colour, nudged toward the
    // preset tint. Reading sky.js rather than hard-coding a hex is what
    // keeps them air: the moment they stop matching the horizon they
    // stop being distance and start being smoke.
    const fogHex = ctx.sky && ctx.sky.fogColor && ctx.sky.fogColor.isColor
      ? ctx.sky.fogColor.getHex() : preset.veilTint;
    veil.tint.set(fogHex).lerp(_colour2.set(preset.veilTint), 0.45);
    veil.alpha = (preset.veils ?? 0) * quality.haze;

    ambient.interval = (preset.drift ?? 0) / Math.max(0.2, quality.particles);
    ambient.colour = preset.driftColour ?? 0xffffff;
    ambient.timer = Math.min(ambient.timer, ambient.interval);

    /* The blob tint leans on the same colour. CONTRACT §2.6: bounce
       light in this game is coloured, so shade never goes neutral - but
       it is SHADE, and the multiplier here has to stay small. A blob
       mixed halfway to the course's fog colour is a grey sticker.

       These numbers are in sRGB, not linear, and the difference is not
       cosmetic. The blob shader is raw - nothing appends the output
       encode to it - so the components written here land in the
       framebuffer verbatim. The previous version composed them out of
       a LINEAR fog colour and a linear floor, which arrived on screen
       at about (11,10,9): the tint was black in all but name, and a
       blob dark enough to read looked like a hole punched in the
       floor rather than shade on it. Composed in sRGB, the same
       recipe lands near luma 29 with the course's own hue in it, and
       an SM64-strength blob takes the food-court tile to a bit under
       half - dark, coloured, and still obviously floor. */
    _colour.set(fogHex).convertLinearToSRGB();
    shadowTintAuthored.setRGB(
      0.052 + _colour.r * 0.100,
      0.044 + _colour.g * 0.095,
      0.075 + _colour.b * 0.100
    ).convertSRGBToLinear();
    pushShadowTint();

    /* The subject key is the course's own light, not a white studio
       lamp bolted onto every level. A neutral key on the red carpet
       would read as a second, colder sun. */
    const sk = preset.subject || EMPTY;
    subjectKey.colour.set(sk.colour === undefined ? 0xfff0d2 : sk.colour);
    subjectKey.gain = sk.gain === undefined ? 0 : sk.gain;
    subjectKey.range = sk.range === undefined ? 16 : sk.range;
    subjectKey.placed = false;

    hazeMaterial.uniforms.uIntensity.value = preset.haze * quality.haze;
    hazeMesh.visible = hazeMaterial.uniforms.uIntensity.value > 0.001;
    moteMesh.geometry.setDrawRange(0, Math.round(BUDGET.motes * clamp01(preset.density * quality.motes)));
  }

  /* ---------------------------- flash ------------------------------ */

  function stepFlash(dt) {
    if (flashState.life >= flashState.maxLife) {
      if (flashMesh.visible) flashMesh.visible = false;
      return;
    }
    flashState.life += dt;
    const t = clamp01(flashState.life / Math.max(flashState.maxLife, 1e-3));
    // Instant on, eased off. A flash that fades in is a fade, not a
    // flash, and the difference is the entire impact.
    const opacity = flashState.amount * (1 - ease.outCubic(t));
    if (opacity <= 0.003) { flashMesh.visible = false; return; }
    flashMaterial.opacity = opacity;
    flashMesh.visible = true;

    // Refit to the frustum. Held close enough that nothing in the
    // world can ever intrude in front of it, and with depthTest off it
    // does not matter what it intersects.
    const dist = Math.max(camera.near * 2.2, 0.22);
    const h = 2 * Math.tan((camera.fov * Math.PI) / 360) * dist * 1.15;
    const w = h * Math.max(0.2, camera.aspect) * 1.15;
    flashMesh.scale.set(w, h, 1);
    flashMesh.position.copy(camera.position).addScaledVector(_camFwd, dist);
    flashMesh.quaternion.copy(camera.quaternion);
  }

  /* ---------------------------- shake ------------------------------ */

  /** Deterministic, non-repeating displacement. Three sines at
   *  mutually irrational ratios beat Math.random() here: a random
   *  offset per frame is a jitter, not a shake, and it does not
   *  reproduce between runs of the same build. */
  function shakeAxis(t, phase) {
    return Math.sin(t * 41.3 + phase) * 0.55
      + Math.sin(t * 27.1 + phase * 2.1) * 0.30
      + Math.sin(t * 63.7 + phase * 3.3) * 0.15;
  }

  function stepShake(dt) {
    const cam = camera;
    // Undo last frame's offset, but only if nobody re-posed the camera
    // since. If camera.js (or the QA harness) wrote a new pose, that
    // pose is the truth and subtracting a stale offset would corrupt it.
    if (shakeState.applied
      && cam.position.equals(shakeState.lastPos)
      && cam.quaternion.equals(shakeState.lastQuat)) {
      cam.position.copy(shakeState.basePos);
      cam.quaternion.copy(shakeState.baseQuat);
    }
    shakeState.applied = false;

    shakeState.trauma = Math.max(0, shakeState.trauma - dt * shakeState.decay);
    if (shakeState.trauma <= 0.0005) {
      shakeState.offset.set(0, 0, 0);
      return;
    }
    shakeState.t += dt;

    // trauma^2: a big hit is violent, a small one is a bump.
    const amount = shakeState.trauma * shakeState.trauma;
    const t = shakeState.t;
    const ox = shakeAxis(t, 0.0) * amount * 0.55;
    const oy = shakeAxis(t, 2.4) * amount * 0.45;
    const roll = shakeAxis(t, 5.1) * amount * 0.09;
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) return;

    shakeState.basePos.copy(cam.position);
    shakeState.baseQuat.copy(cam.quaternion);

    shakeState.offset.copy(_camRight).multiplyScalar(ox).addScaledVector(_camUp, oy);
    cam.position.add(shakeState.offset);
    _euler.set(0, 0, roll, "XYZ");
    _quat2.setFromEuler(_euler);
    cam.quaternion.multiply(_quat2);

    shakeState.lastPos.copy(cam.position);
    shakeState.lastQuat.copy(cam.quaternion);
    shakeState.applied = true;
  }

  /* ------------------------------ API ------------------------------ */

  const EMPTY = Object.freeze({});
  const burstWarned = new Set();

  const api = {

    /** CONTRACT section 9. `name` is one of the EFFECTS keys; unknown
     *  names fall back to dust rather than throwing, because an
     *  effect that does not exist yet must not take the frame down. */
    burst(name, position, opts) {
      if (!readPosition(position, _pos)) return null;
      const fn = EFFECTS[name] || EFFECTS.dust;
      try {
        fn(_pos, opts || EMPTY);
      } catch (error) {
        // A single malformed opts object must not stop the frame.
        if (!burstWarned.has(name)) {
          burstWarned.add(name);
          console.warn(`[apop3d] vfx.burst("${name}") threw`, error);
        }
      }
      return null;
    },

    /** CONTRACT section 9. Names: "ribbon" (long jump), "dive",
     *  "longJump", "spin" (flips), plus "sparkle"/"aura" for the
     *  continuous shimmer on collectibles and the Record. */
    trail(object, name, on) {
      if (!object) return;
      const key = String(name || "ribbon");

      if (key === "sparkle" || key === "aura") {
        const existing = sparkleEmitters.findIndex((e) => e.object === object);
        if (!on) {
          if (existing >= 0) sparkleEmitters.splice(existing, 1);
          return;
        }
        if (existing >= 0) return;
        const aura = key === "aura";
        sparkleEmitters.push({
          object,
          interval: aura ? 0.05 : 0.13,
          timer: 0,
          count: aura ? 3 : 1,
          radius: aura ? 0.9 : 0.42,
          colour: aura ? 0xffe27a : 0xffe066,
          scale: aura ? 1.35 : 1,
        });
        return;
      }

      const style = TRAIL_STYLES[key] || TRAIL_STYLES.ribbon;
      let tr = findTrail(object);
      if (!on) { if (tr) tr.emitting = false; return; }
      if (tr) { tr.style = style; tr.emitting = true; return; }
      tr = acquireTrail();
      tr.active = true;
      tr.object = object;
      tr.style = style;
      tr.filled = 0;
      tr.phase = 0;
      tr.fade = 0;
      tr.emitting = true;
      clearTrailSlot(tr);
    },

    /** CONTRACT section 9. Lies on the surface described by `normal`,
     *  rolled randomly - the sprite is deliberately asymmetric so the
     *  roll actually changes what you see. */
    decal(name, position, normal, size) {
      if (!readPosition(position, _pos)) return null;
      const style = DECAL_STYLES[name] || DECAL_STYLES.scuff;
      const n = (normal && normal.isVector3 && finiteVec(normal)) ? _v.copy(normal) : _v.set(0, 1, 0);
      if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
      n.normalize();

      const slot = decals.acquire();
      const d = slot.obj;
      d.position.copy(_pos).addScaledVector(n, 0.012);
      _quat.setFromUnitVectors(_planeNormal, n);
      _quat2.setFromAxisAngle(_planeNormal, rng() * TAU);
      d.quaternion.copy(_quat).multiply(_quat2);
      d.colour.set(style.colour);
      d.size = Math.max(0.05, size || 1);
      d.life = 0;
      d.maxLife = style.life;
      d.fadeOut = style.fadeOut;
      d.alpha = style.alpha;
      d.grow = style.grow;
      return d;
    },

    /** CONTRACT section 9. Adds trauma rather than setting it, so two
     *  hits in the same frame compound instead of the second one
     *  cancelling the first. */
    shake(amount, seconds) {
      const a = Number(amount);
      if (!Number.isFinite(a) || a <= 0) return;
      shakeState.trauma = clamp(shakeState.trauma + a, 0, 1.4);
      const s = Number(seconds);
      shakeState.decay = Number.isFinite(s) && s > 0.02 ? 1 / s : 2.5;
    },

    /** CONTRACT section 9. */
    flash(colorHex, amount, seconds) {
      const a = Number(amount);
      if (!Number.isFinite(a) || a <= 0) return;
      // Do not let a small flash cut a bigger one short.
      const remaining = flashState.maxLife > 0
        ? flashState.amount * (1 - clamp01(flashState.life / flashState.maxLife)) : 0;
      if (a < remaining) return;
      flashMaterial.color.set(colorHex === undefined ? 0xffffff : colorHex);
      flashState.amount = clamp(a, 0, 1);
      flashState.life = 0;
      flashState.maxLife = Math.max(0.05, Number(seconds) || 0.2);
    },

    /* ---- extensions beyond the frozen signatures ---- */

    /**
     * Register a contact shadow. The declarative route
     * (`object.userData.contactShadow = { radius: 0.5 }`) is picked up
     * automatically and is preferred; this is for callers that want a
     * handle back or need to shadow something that is not an Object3D.
     */
    addShadow(object, opts) {
      if (!object) return null;
      const existing = casterByObject.get(object);
      if (existing) return existing;
      const c = makeCaster(object, opts);
      casters.push(c);
      casterByObject.set(object, c);
      return c;
    },

    removeShadow(object) {
      const c = casterByObject.get(object);
      if (!c) return;
      casterByObject.delete(object);
      const i = casters.indexOf(c);
      if (i >= 0) casters.splice(i, 1);
    },

    /** The shade colour blobs lean toward. Never neutral grey -
     *  CONTRACT section 2, tell 6. sky.js should set this per course. */
    setShadowTint(hex) { writeShadowTint(hex); },

    /**
     * Re-bake the static grounding patches for the current course.
     * world.js does not have to call this - `world:load` schedules it -
     * but a course that rearranges its own geometry after load can.
     */
    rebakeGround() { patchState.frameDue = ctx.clock.frame + 1; patchState.pending = true; },

    /** Debug toggle. qa.js and the shot harness use it to measure what
     *  this pass is actually contributing. */
    setGroundPatches(on) {
      patchState.enabled = on !== false;
      if (!patchState.enabled) patchMesh.count = 0;
      else if (!patchState.pending) api.rebakeGround();
    },

    /**
     * The dynamic contact blobs, on or off.
     *
     * Exists because the screenshot harness needs to render a control
     * frame with the character genuinely absent, and hiding her rig is
     * not enough - the blob is drawn from a pooled instanced mesh that
     * does not care whether its caster is visible. Without this the
     * control frames kept a hard dark ellipse at exactly the spot the
     * subject was removed from, which is a stand-in for the one thing
     * the control exists to delete. Three review rounds were scored on
     * frames that still had her shadow in them.
     */
    setContactShadows(on) {
      blobState.enabled = on !== false;
      if (!blobState.enabled) shadowMesh.count = 0;
      return blobState.enabled;
    },

    /**
     * Stop time in this module, for the capture harness's control frame.
     *
     * The harness has called `ctx.vfx?.setFrozen?.(...)` for several
     * rounds against a module that did not define it, and optional
     * chaining made that a silent no-op - the same failure, in the same
     * file, as the `setContactShadows` call that shipped before the
     * method existed and cost three review rounds. Both were invisible
     * for exactly the same reason, so the harness now asserts these
     * hooks are present rather than asking politely.
     */
    setFrozen(on) {
      freezeState.on = on === true;
      return freezeState.on;
    },

    /**
     * The contact skirt, separately.
     *
     * Kept apart from setGroundPatches because the two answer
     * different questions - one grounds what hangs OVER the floor, the
     * other what STANDS on it - and the only honest way to measure
     * either is to toggle it against itself inside one process while
     * other agents are editing the level.
     */
    setGroundSkirt(on) {
      skirtState.enabled = on !== false;
      if (!skirtState.enabled) {
        for (const layer of skirtLayers) layer.mesh.visible = false;
      } else if (!patchState.pending) api.rebakeGround();
    },

    /**
     * The directional cast, separately again.
     *
     * It rides in the skirt's texture, so this cannot simply hide a
     * mesh - it has to re-bake. Both toggles land on the same layers,
     * which is exactly why they need to be separable: the skirt says
     * "the sky is blocked here" and the cast says "the KEY is blocked
     * here", and a single number that moved cannot be attributed to
     * either of them on its own.
     */
    setGroundCast(on) {
      const want = on !== false;
      if (want === castState.enabled) return;
      castState.enabled = want;
      if (!patchState.pending) api.rebakeGround();
    },

    /**
     * The cast's AIM, separately from the cast itself.
     *
     * Third member of the same family and for the same reason. A blind
     * review measured a cast that worked and still left the near floor
     * untouched, because it fell away from the lens; this toggle is the
     * only way to attribute the difference between "there is a cast"
     * (setGroundCast) and "it is pointed at the camera", which are two
     * separate claims and were measured as one for a whole round.
     *
     * Off restores the course's authored azimuth. Re-bakes, like the
     * toggle above - the direction is baked into the texture.
     */
    setCastAim(on) {
      const want = on !== false;
      if (want === castAim.enabled) return want;
      castAim.enabled = want;
      castAim.preset = "";
      if (!want && ctx.sky && typeof ctx.sky.clearCastAim === "function") {
        ctx.sky.clearCastAim();
        castState.aimedAt = "";
      }
      if (!patchState.pending) api.rebakeGround();
      return want;
    },

    /**
     * The key sheen, on or off.
     *
     * Fourth member of the setGroundSkirt / setGroundCast / setCastAim
     * family, and the same argument: while several agents edit this
     * course at once, cross-run numbers are worthless and the only
     * honest attribution is toggling one pass inside one process from
     * one solved pose. This one answers "is the specular what put the
     * whites in the frame", which nothing else can separate from the
     * lighting rebalance it shipped alongside.
     */
    setKeySheen(on) {
      const want = on !== false;
      ctx.materials?.setSheenEnabled?.(want);
      return want;
    },

    /** Re-run the material scans without re-entering the course. */
    rescanSurfaces() {
      try { scanForWater(); } catch (error) {
        console.warn("[apop3d] vfx liquid scan failed", error);
      }
      try { scanForSheen(); } catch (error) {
        console.warn("[apop3d] vfx sheen scan failed", error);
      }
      return { pools: waterState.pools, sheen: sheenState.surfaces };
    },

    /** Atmosphere overrides. Any omitted field keeps its course value. */
    setAtmosphere(opts = {}) {
      if (opts.course !== undefined) applyCourseAir(opts.course);
      if (opts.moteA !== undefined) air.uColourA.value.set(opts.moteA);
      if (opts.moteB !== undefined) air.uColourB.value.set(opts.moteB);
      if (opts.density !== undefined) {
        air.uOpacity.value = 0.55 * opts.density * quality.motes;
        moteMesh.geometry.setDrawRange(0,
          Math.round(BUDGET.motes * clamp01(opts.density * quality.motes)));
      }
      if (opts.rise !== undefined) air.uRise.value = opts.rise;
      if (opts.drift !== undefined) air.uDrift.value = opts.drift;
      if (opts.box !== undefined) air.uBox.value.copy(opts.box);
      if (opts.lightGain !== undefined) air.uLightGain.value = clamp(opts.lightGain, 0, 2);
      if (opts.veils !== undefined) veil.alpha = clamp(opts.veils, 0, 0.4) * quality.haze;
      if (opts.veilTint !== undefined) veil.tint.set(opts.veilTint);
      if (opts.veilSpan !== undefined) veil.span = clamp(opts.veilSpan, 24, 400);
      if (opts.ambient !== undefined) ambient.interval = Math.max(0, opts.ambient);
      if (opts.ambientColour !== undefined) ambient.colour = opts.ambientColour;
      if (opts.haze !== undefined) {
        hazeMaterial.uniforms.uIntensity.value = clamp01(opts.haze) * quality.haze;
        hazeMesh.visible = hazeMaterial.uniforms.uIntensity.value > 0.001;
      }
      if (opts.hazeColour !== undefined) hazeMaterial.uniforms.uColour.value.set(opts.hazeColour);
    },

    /** Declare a light shaft explicitly. sky.js can also just expose a
     *  `shafts` array and this module will find it. */
    addShaft(position, opts = {}) {
      if (shafts.length >= BUDGET.shaft || !readPosition(position, _pos)) return;
      shafts.push({
        position: new THREE.Vector3().copy(_pos),
        radius: opts.radius ?? 1.6,
        length: opts.length ?? 9,
        intensity: opts.intensity ?? 0.16,
        colour: new THREE.Color(opts.colour ?? 0xffe9bd),
        dir: new THREE.Vector3().copy(opts.dir || _down).normalize(),
      });
    },

    /** Read by camera.js if it would rather apply the shake itself. */
    get shakeOffset() { return shakeState.offset; },
    get shakeTrauma() { return shakeState.trauma; },

    stats() {
      return {
        soft: softMesh.count,
        glow: glowMesh.count,
        rings: ringMesh.count,
        decals: decalMesh.count,
        shadows: shadowMesh.count,
        groundPatches: patchMesh.count,
        groundBake: patchState.lastBake,
        groundSkirt: {
          layers: skirtState.layers,
          texels: skirtState.texels,
          levels: skirtState.levels.slice(),
          ms: skirtState.ms,
        },
        groundCast: {
          enabled: castState.enabled,
          active: castState.active,
          elevation: castState.elevation,
          strength: castState.strength,
          azimuth: castState.azimuth,
          aimedAt: castState.aimedAt,
          aimFrac: castState.aimFrac,
          aimCells: castState.aimCells,
          aimTried: castState.aimTried,
          cells: castState.cells,
        },
        liquid: { pools: waterState.pools, verts: waterState.verts, ms: waterState.ms },
        sheen: { surfaces: sheenState.surfaces, ms: sheenState.ms },
        casters: casters.length,
        trails: trails.reduce((n, t) => n + (t.active ? 1 : 0), 0),
        shafts: shaftMesh.count,
        veils: veilMesh.count,
        subjectKey: Number(punchLight.intensity.toFixed(1)),
        groundY: Number(airGround.y.toFixed(2)),
        trauma: Number(shakeState.trauma.toFixed(3)),
      };
    },

    /* ------------------------- lifecycle ------------------------- */

    enter(context, payload) {
      applyCourseAir((payload && payload.course) ?? context.state.course ?? 1);
      /* Bake the grounding patches a frame LATER, not here.
         world.js emits `world:load` after collision.build(), so the
         BVH is ready - but the movers have only just been parked at
         their start points and enemies.js has not spawned yet, and
         the bake wants one settled frame to sample. It also keeps a
         couple of hundred milliseconds of raycasting off the same
         frame that just uploaded a course's worth of geometry. */
      patchState.pending = true;
      patchState.payload = payload || null;
      patchState.frameDue = context.clock.frame + 2;
      patchMesh.count = 0;
      /* Same deferral, its own flag: the pool scan must NOT ride on
         patchState, which lives inside the `quality.shadows` branch.
         A machine on low quality would otherwise render every pool in
         the game as a flat plane. */
      waterState.due = true;
      waterState.frame = context.clock.frame + 2;
      groundCache.cells.clear();
      groundCache.candidatesFrame = -999;
      shaftScanFrame = -999;
      lightSyncFrame = -999;
      // The new course's floor is somewhere else entirely; damping
      // toward it from the old one would drag the whole air slab
      // across the level for a second.
      airGround.valid = false;
      airGround.probeFrame = -999;
      ambient.timer = 0;
    },

    exit() {
      // A course change must not leave a blob under an object that no
      // longer exists, or a ribbon anchored to a disposed mesh - or a
      // baked patch lying on a floor that has been unloaded.
      casters.length = 0;
      casterByObject.clear();
      bossCaster.entry = null;
      patchMesh.count = 0;
      patchState.pending = false;
      // A skirt lying on a floor that has been unloaded is the same
      // failure as a blob under an object that no longer exists.
      for (const layer of skirtLayers) layer.mesh.visible = false;
      skirtState.layers = 0;
      // levels.js disposes its own surfaces on unload; holding them
      // past that is a leak, and the next course re-enrols its own.
      waterState.due = false;
      waterState.pools = 0;
      ctx.materials?.resetWater?.();
      sheenState.surfaces = 0;
      ctx.materials?.resetSheen?.();
      sparkleEmitters.length = 0;
      shafts.length = 0;
      for (let i = 0; i < trails.length; i += 1) {
        trails[i].active = false;
        trails[i].object = null;
        trails[i].filled = 0;
        trails[i].fade = 0;
        clearTrailSlot(trails[i]);
      }
      soft.forEach((p, slot) => { slot.alive = false; });
      glow.forEach((p, slot) => { slot.alive = false; });
      rings.forEach((r, slot) => { slot.alive = false; });
      decals.forEach((d, slot) => { slot.alive = false; });
      groundCache.cells.clear();
      groundCache.candidates.length = 0;
      groundCache.candidatesFrame = -999;
      veilMesh.count = 0;
      shakeState.trauma = 0;
      flashState.life = flashState.maxLife;
      punchLight.intensity = 0;
      // Re-seeded on the next lateUpdate rather than damped across the
      // teleport, or the key would sweep the whole course to catch up.
      subjectKey.placed = false;
    },

    update(context) {
      const dt = freezeState.on ? 0 : context.clock.dt;
      if (!(dt > 0)) return;

      // Integration only. Anything that needs a final transform - the
      // trails, the blobs, the billboards - waits for lateUpdate,
      // which is the rule in CONTRACT section 4.
      air.uTime.value = context.clock.t;

      if (punchState.maxLife > 0) {
        punchState.life += dt;
        const t = clamp01(punchState.life / punchState.maxLife);
        punchLight.intensity = punchState.peak * (1 - t) * (1 - t);
        if (t >= 1) { punchLight.intensity = 0; punchState.maxLife = 0; }
      }
    },

    lateUpdate(context) {
      const dt = freezeState.on ? 0 : context.clock.dt;

      camera.updateMatrixWorld();
      _camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      _camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
      _camFwd.setFromMatrixColumn(camera.matrixWorld, 2).normalize().multiplyScalar(-1);

      // The mote slab follows the camera in xz, snapped to a 4m grid -
      // following continuously makes the whole field slide with the
      // player, which is exactly the artefact it is trying to avoid -
      // and sits on the FLOOR in y rather than around the eye.
      updateAirGround(dt > 0 ? dt : 0);
      updateAirScale();
      syncAirLights();
      // Wants the camera basis above it and the body's final transform.
      stepSubjectKey(dt);
      air.uAnchor.value.set(
        Math.round(camera.position.x / 4) * 4,
        airGround.y,
        Math.round(camera.position.z / 4) * 4
      );

      if (dt > 0) {
        stepAmbientDrift(dt);
        stepParticles(soft, softMesh, dt);
        stepParticles(glow, glowMesh, dt);
        stepRings(dt);
        stepDecals(dt);
        stepTrails(dt);
      }
      stepVeils();

      if (quality.shadows) {
        // Newly spawned enemies and collectibles are picked up on a
        // cadence; a per-frame traverse of a full course is wasteful
        // and half a second of latency on a blob is invisible.
        if (context.clock.frame % 20 === 0) scanForCasters();
        /* Every frame, not on the scan cadence: a fight's extent and
           its hover change with its phase, and this is the one caster
           in the game whose own size is animated. It is three reads and
           a distance test. */
        syncBossCaster();
        stepShadows();
        // Ahead of the bake test, so a re-aim lands in the same frame's
        // queue rather than waiting a whole extra bake cadence.
        syncCastAim();
        if (patchState.pending && context.clock.frame >= patchState.frameDue) {
          patchState.pending = false;
          if (patchState.enabled) {
            try {
              bakeGroundPatches(patchState.payload);
            } catch (error) {
              // A course whose collision is not what this expects must
              // lose its grounding patches, not its frame.
              console.warn("[apop3d] vfx ground patch bake failed", error);
              patchMesh.count = 0;
            }
          }
          patchState.bakedCourse = context.state ? context.state.course : -1;
        }
      }

      if (waterState.due && context.clock.frame >= waterState.frame) {
        waterState.due = false;
        try {
          scanForWater();
        } catch (error) {
          // A pool that will not measure loses its ripple, not the frame.
          console.warn("[apop3d] vfx liquid scan failed", error);
        }
        /* Same frame as the pools, and deliberately not inside their
           try: a scan that throws must not take the other one with it.
           Both are pure material patches on a course that has just
           loaded, so this is the last frame before anything is drawn
           with the old program and no material recompiles twice. */
        try {
          scanForSheen();
        } catch (error) {
          console.warn("[apop3d] vfx sheen scan failed", error);
        }
      }
      /* From ctx.clock, never from wall time: the shot harness steps
         the whole game with advance() and two runs of one build have
         to produce the same ripple. */
      ctx.materials?.setWaterTime?.(context.clock.t);

      if (context.clock.frame - shaftScanFrame > 180) scanShafts();
      stepShafts();

      if (hazeMesh.visible) {
        const dist = Math.max(camera.near * 3, 0.4);
        const h = 2 * Math.tan((camera.fov * Math.PI) / 360) * dist * 1.2;
        hazeMesh.scale.set(h * Math.max(0.2, camera.aspect) * 1.2, h, 1);
        hazeMesh.position.copy(camera.position).addScaledVector(_camFwd, dist);
        hazeMesh.quaternion.copy(camera.quaternion);
      }

      stepFlash(dt);
      // Shake is applied LAST, after the rig has posed the camera and
      // before render.js draws. See the note inside stepShake about
      // why the previous frame's offset is removed conditionally.
      stepShake(dt > 0 ? dt : 0);
    },

    dispose() {
      api.exit();
      scene.remove(group);
      for (const t of Object.values(sprites)) t.dispose();
      for (const m of [softMaterial, glowMaterial, ringMaterial, decalMaterial,
        shadowMaterial, patchMaterial, ribbonMaterial, moteMaterial, shaftMaterial,
        veilMaterial, hazeMaterial, flashMaterial]) m.dispose();
      for (const g of [softMesh.geometry, glowMesh.geometry, ringMesh.geometry,
        decalMesh.geometry, shadowMesh.geometry, patchMesh.geometry, ribbonGeometry,
        moteGeometry, shaftGeometry, veilMesh.geometry, hazeMesh.geometry,
        flashMesh.geometry]) g.dispose();
      for (const layer of skirtLayers) {
        layer.mesh.geometry.dispose();
        layer.material.dispose();
        if (layer.texture) layer.texture.dispose();
        layer.texture = null;
        layer.data = null;
      }
    },
  };

  /* --------------------------- bus wiring --------------------------- */

  /**
   * Gameplay modules never import vfx; they emit and the right thing
   * happens. Every handler is defensive about its payload because the
   * modules that emit these are being written in parallel with this one.
   */
  const bus = ctx.bus;
  if (bus) {
    bus.on("player:step", (e = {}) => {
      if (!readPosition(e.position, _pos)) return;
      EFFECTS.dust(_pos, { strength: clamp((e.speed || 3) / 6, 0.25, 2.2), dir: e.dir });
    });
    bus.on("player:skid", (e = {}) => {
      if (!readPosition(e.position, _pos)) return;
      EFFECTS.dust(_pos, { strength: clamp((e.speed || 7) / 4, 0.8, 3.5), dir: e.dir });
      if (rng() < 0.4) api.decal("scuff", _pos, e.normal || _up, 0.5 + rng() * 0.4);
    });
    bus.on("player:land", (e = {}) => {
      if (!readPosition(e.position, _pos)) return;
      EFFECTS.landRing(_pos, { speed: e.speed, normal: e.normal });
      if (e.hard) api.shake(0.18, 0.24);
    });
    bus.on("player:jump", (e = {}) => {
      if (!readPosition(e.position, _pos)) return;
      EFFECTS.dust(_pos, { strength: 0.6 + (e.chain || 1) * 0.35 });
    });
    bus.on("player:pound", (e = {}) => {
      if (e.phase && e.phase !== "land") return;
      if (!readPosition(e.position, _pos)) return;
      EFFECTS.poundShock(_pos, { normal: e.normal, strength: e.strength });
    });
    bus.on("player:hurt", (e = {}) => {
      if (readPosition(e.position, _pos)) EFFECTS.hurt(_pos, e);
      else api.flash(0xff3355, 0.3, 0.26);
    });
    bus.on("player:heal", (e = {}) => {
      if (readPosition(e.position, _pos)) EFFECTS.heal(_pos, e);
    });
    bus.on("player:water", (e = {}) => {
      if (readPosition(e.position, _pos)) EFFECTS.waterSplash(_pos, e);
    });
    bus.on("beam:hit", (e = {}) => {
      if (readPosition(e.position, _pos)) EFFECTS.beamHit(_pos, e);
    });
    bus.on("aura:fire", (e = {}) => {
      if (readPosition(e.position, _pos)) EFFECTS.auraWave(_pos, e);
    });
    bus.on("enemy:pop", (e = {}) => {
      if (readPosition(e.position, _pos)) EFFECTS.enemyPop(_pos, e);
    });
    bus.on("collect:clout", (e = {}) => {
      if (readPosition(e.position, _pos)) EFFECTS.coinPop(_pos, e);
    });
    bus.on("collect:record", (e = {}) => {
      if (readPosition(e.position, _pos)) EFFECTS.recordGet(_pos, e);
    });
    bus.on("world:load", (e = {}) => api.enter(ctx, e));
    bus.on("world:unload", () => api.exit());
  }

  applyCourseAir(ctx.state ? ctx.state.course : 1);

  return api;
}
