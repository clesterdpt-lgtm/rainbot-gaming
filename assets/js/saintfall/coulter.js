/* ============================================================
   SAINTFALL - the Coulter

   The burrowing boss, and everything about it that is not geometry:
   how it hunts under the sand, how it comes out, what it spits, and
   what standing in that does to you.

   WHY THIS IS ITS OWN MODULE

   combat.js is a four-state machine driven by distance and line of
   sight, and it is the right shape for every walker in the game: they
   are always visible, always hittable, and always either closing or
   shooting. None of that is true here. This animal is INVULNERABLE
   for most of its cycle because it is eight metres underground, it has
   a trail of its own past positions instead of a position, and it
   spawns hazards that outlive it. Bolting those onto `stepEnemy` would
   have put four `if (key === "coulter")` branches into the file every
   other enemy depends on.

   So combat.js keeps what it is authoritative about - hit volumes,
   damage, the player's health - and hands the behaviour of anything
   with a body chain to this module.

   THE CYCLE IS THE ENCOUNTER

     BURROW   4-8s. Untouchable. A ridge of displaced sand crossing
              the basin toward the player, and nothing else. The player
              cannot fight this phase, only read it and move.
     RISE     1.4s. It erupts where the ridge was, hitting anything
              standing on it, and rears eleven metres of body out of
              the ground.
     CREST    9.5s. THE FIGHT. Anchored, reared, and hittable - it
              bites what is close and spits venom at what is not, and
              the mouth it does both with is the weak point.
     DIVE     It goes back down through its own hole and the venom it
              left stays where it landed.

   Every number in COULTER_CONFIG below is in service of one property:
   the player must never be punished for a phase they could not read.
   The wake is visible for seconds before the eruption, the eruption is
   avoidable by moving off the ridge, and the spew is telegraphed by
   the sacs filling and the mouth opening green.

   AND THE ANIMAL ITSELF - see THE HIDE, below. The .glb is one skinned
   mesh with one material, so everything that makes a wet segmented
   burrower look different from a matte black slab is done in the
   fragment shader off the BIND POSE, on top of the shared surface kit.
   ============================================================ */

import { TAU, clamp, clamp01, damp, dampAngle, lerp, makeBus } from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { applySurface, setSurfaceDamage } from "saintfall/boss-surface.js";
import { SURVIVAL_CONFIG } from "saintfall/combat.js";

export const COULTER_CONFIG = Object.freeze({
  /* Deep enough that the body is unambiguously gone - a worm you can
     see the top of is a worm the player will try to shoot - and
     shallow enough that the ridge it pushes up is a strong read. */
  burrowDepth: 16,
  /* The submerged window, and the difficulty curve. It is the only
     value the boss escalates on, because it is the one the player
     feels: a wounded Coulter gives you less time to reposition
     between surfacings, rather than more health to chew through. */
  huntSecondsMax: 8.0,
  huntSecondsMin: 4.2,
  /* How close it gets before it commits to coming up. Well inside the
     bite reach on purpose: the eruption should land beside the player,
     not politely across the arena. */
  /* Where it commits, and it is tuned against the ARC below rather than
     chosen: the rise carries the head about eighteen metres forward, so
     committing at this range puts the mouth over the player rather than
     leaving it towering politely in the middle distance. */
  riseRange: 54,
  riseSeconds: 3.8,
  riseSpeed: 28,
  /* How high the head has to get before the rise is called done. Raised
     from 7.2 with the arc: the animal was cutting its own eruption short
     and standing up like a post, with three vertebrae out of the sand
     and the rest of the body buried directly underneath them. */
  riseClearance: 32,
  crestSeconds: 12.5,
  diveSpeed: 26,
  diveDepth: 18,
  turnRate: { burrow: 0.95, rise: 0.35, crest: 1.15, dive: 0.45 },
  /* The eruption. Survivable at full health and only just - it is the
     price of ignoring a ridge of sand travelling toward you. */
  breachDamage: 42,
  breachRadius: 18,
  breachKnock: 16,
  biteDamage: 56,
  biteReach: 28,
  biteVertical: 34,
  biteSlack: 6,
  biteCadence: 2.05,
  /* The contact frame of the `strike` clip. Authored at frame 10 of
     32 - see the Blender script - so the damage lands as the petals
     close rather than as they open. */
  biteContact: 0.17,
  /* The launch frame of the `spew` clip, likewise a contract with the
     model: frame 18 of 54. */
  spewLaunch: 0.30,
  spewCadence: 2.9,
  spewGlobules: 3,
  spewSpeed: 27,
  spewSpread: 0.085,
  spewDirect: 16,
  spewsPerCrest: [2, 4],
  poolRadius: 7.0,
  poolSeconds: 9.0,
  poolMax: 12,
  /* Venom is not burst damage, it is a DENIAL. Standing in a pool for
     a full second costs less than a Thresher's swipe; standing in one
     because you did not notice it costs the fight. */
  toxinRise: 0.66,
  toxinDecay: 0.20,
  toxinDps: 9.5,
  toxinTick: 0.5,
  /* Simulated far past combat.js's own 240m horizon. It is a landmark
     with a wake, and a boss that stops moving because the player
     walked away is a boss that is never where they left it. */
  simRange: 620,
});

const GLOBULES = 18;
const VENOM_COLOUR = "#4f7a12";
const VENOM_EMISSIVE = "#b8f23e";

/* ============================================================
   THE HIDE

   What the animal is made of, and it is one material because the
   model is one skinned mesh: POSITION, NORMAL, COLOR_0, JOINTS_0,
   WEIGHTS_0, no UVs, no images. So every distinction below - wet
   flank against dry crust, hide against jaw plate against gullet -
   is zoned in the fragment shader off the BIND POSE, which does not
   move when the animal does.

   THE THREE THINGS THIS ANIMAL IS, in the Scarab's proportions: a
   lot of the neutral, a little of the warm, a spot of the saturated.

     SLICK HIDE   the dominant surface. Cold near-black, gradient from
                  belly to back, and its whole read is SPECULAR - a
                  small hard highlight that travels as the camera
                  moves. Wet is a highlight that MOVES, not a
                  highlight that is bright.
     SAND CRUST   a minority, on the dorsal facets that still point
                  at the sky, packed hardest into the segment grooves.
                  Dry, pale, desaturated and utterly matte - the one
                  place on the animal with no specular at all, which
                  is what makes the rest of it read as wet.
     THE GULLET   the weak point, and the only saturated thing in the
                  silhouette: warm coral gum, the wettest roughness on
                  the model, lit from inside by the venom it is about
                  to throw.

   FOUR TRAPS THIS COST.

   1. THE SHARED KIT FADES ITSELF OUT AT 108 METRES. Every number in
      `SURFACES` was tuned against a three-metre Thresher, and this
      animal is a hundred and eighteen metres long: the gallery's own
      portrait framing stands the camera about a hundred metres back,
      which is exactly where `fadeFar` has already faded the grain to
      nothing. The surface was not weak, it was ABSENT in every frame
      anyone had looked at. `fadeNear`/`fadeFar` are overridden here
      to 220/520 m. That is safe because the distance fade is a COST
      control, not the antialiasing: each octave already fades itself
      out on its own screen footprint.

   2. THE SEGMENTS ARE A HEIGHT FIELD, NOT A TEXTURE. A worm's read is
      its rings, so they perturb the normal for real - one sine of the
      bind-pose Z, its 3x harmonic through the triple-angle identity,
      and Mikkelsen's surface-gradient form for the normal. It reuses
      the kit's own `sfSigX`/`sfSigY` world derivatives, so the whole
      thing costs ONE extra derivative pair and two transcendentals.
      Painted rings would light from a direction the surface does not
      have, which reads as "the bump map is a bit off" forever.

   3. THE MOUTH HAS TO BE FOUND WITHOUT UVs. The jaws are a tube, and
      the inside of a tube is exactly the facets whose BIND-POSE normal
      points at the body axis. That test needs the un-skinned normal,
      which is one extra varying (`vCoObjN`, taken at
      `beginnormal_vertex` before skinning touches it) and cannot be
      derived from the shading normal, because by then the jaw has
      rotated.

   4. `customProgramCacheKey` IS A PROPERTY, NOT A CHAIN. `patchMaterial`
      says so in its own header: chaining a second `onBeforeCompile`
      composes, because it calls the previous one first - but whoever
      writes the cache key LAST wins, and the loser's variants collapse
      into one program. So both are wrapped here, explicitly, and the
      wrapper appends to the key the kit's patch already built. Getting
      it wrong looks exactly like "my shader did nothing".
   ============================================================ */
const COULTER_SKIN = Object.freeze({
  /* Metres between segment rings, in WORLD space. At the gallery's
     ~100m portrait distance this lands a ring about every 45 screen
     pixels, which is a macro read; the 3x harmonic under it lands at
     15px, which is the micro one. */
  /* 5.2 rather than the 3.8 the first pass used. At 3.8 the rings
     landed about ten screen pixels apart at fighting distance and the
     animal came back reading as a BARCODE - a corrugated ribbon
     rather than a segmented body. The segment has to be big enough
     that the eye counts vertebrae rather than stripes; the 3x
     harmonic underneath it is what carries the fine detail. */
  ringMetres: 5.2,
  /* SOFTENED ONCE AND PUT BACK. The close-range frames read a little
     like chain-link, so the ring contrast was taken down about twenty
     per cent - and the measurement said no: microDetail fell from 7.29
     to 5.94, out of the pool's band, while rmsContrast did not move at
     all, because the frame-wide contrast this animal is being marked
     on is the SAND, not the boss. The banding is the surface. */
  ringRelief: 0.13,
  /* THREE OCTAVES, not two, and the third is what the metric asked
     for. `microDetail` measures high-frequency energy and at the
     distance this animal is photographed from, every octave the
     shared kit owns is already sub-pixel and antialiased away - its
     finest cell is 6cm on a body photographed from a hundred metres.
     So the only sub-facet detail that survives has to be MINE, and it
     is a third harmonic of the ring train at 58cm: about seven screen
     pixels at fighting distance, which is exactly the band the
     measurement is looking in. It costs no transcendental at all -
     the triple-angle recursion produces it from the sine already
     taken for the segments. */
  ringFine: 0.075,
  ringMicro: 0.022,
  /* How long the topside stays caked after it comes up. The crust is
     the phase read: full while it is under the sand, sheeting off
     through the rise, and only a residue by the time the player is
     shooting at it. */
  /* Drained to NOTHING, not to a residue. Two reasons and they agree:
     the shed is the drama - the crust belongs to the rise, which is
     the frame the eruption is sold on - and a floor above zero would
     hold the crust's shader branch open for the whole fight on an
     animal that fills the screen. */
  sandDrain: 0.45,
  sandFloor: 0.0,
  /* Wet is the whole animal. It never fully dries in one surfacing -
     eleven metres of it are still in the ground. */
  dryRate: 0.16,
  wetFloor: 0.62,
  /* AUTHORED IN sRGB AND THEN RAISED, twice. The first pass used
     #0d1416 on the reasoning that a slick black animal is black -
     which in linear light is 0.0055, a value no amount of relief and
     no specular lobe can be seen against. The animal came back from
     the gallery as an unbroken silhouette with the segment rings
     invisible ON it. Dark has to mean "much darker than the sand",
     not "zero": the sand sits near 0.4 linear and these two sit at
     0.023 and 0.12, which is a quarter of it and still leaves the
     rings a stop and a half to work in. */
  /* AND THEY HAD TO GO COLD, which is the third pass on these two
     numbers. Neutral grey was the obvious choice for a slick black
     animal that needed lifting - and a neutral albedo under a
     golden-hour key is an ORANGE animal. The gallery came back with
     the segment rings finally reading and the whole boss wearing the
     Fallen Saint's own sand, which is the one thing the art direction
     forbids outright. The albedo has to fight the light: a dark teal
     under a warm sun lands as a cold grey-green, and that is the
     separation. */
  hide: "#26383c",
  back: "#5c7370",
  crust: "#c2ad8f",
  gum: "#cf7f70",
  venom: "#8fe33a",
});

/* NO BACKTICKS ANYWHERE IN THE GLSL BELOW, comments included. One
   backtick ends the template literal silently and this project has
   already paid for that lesson once. */
const HIDE_PARS = /* glsl */`
uniform vec4 uCoSkin;   // sand load, wetness, maw open, venom fill
uniform vec4 uCoRing;   // wavenumber (1/object unit), relief, 3x relief, 9x relief (m)
uniform vec3 uCoHide;
uniform vec3 uCoBack;
uniform vec3 uCoCrust;
uniform vec3 uCoGum;
uniform vec3 uCoVenom;
varying vec3 vCoObjN;
`;

/* Injected before `lights_physical_fragment`, and the anchor is worth
   a paragraph because the obvious one is wrong in a way that looks
   like the shader is not running.

   `lights_fragment_begin` reads as the natural "last moment before the
   lighting" - the surface kit's own header says as much about
   `normal`. It is one chunk too late for everything else.
   `lights_physical_fragment` sits immediately above it and is where
   three FOLDS the writable terms into the material struct:

       material.roughness     = max(roughnessFactor, 0.0525);
       material.diffuseColor  = diffuseColor.rgb * (1.0 - metalnessFactor);
       material.specularColor = mix(vec3(0.04), diffuseColor.rgb, metalnessFactor);

   Written after that, a new albedo and a new roughness are dead
   stores. The first version of this block anchored there and the
   gallery came back with the venom glow correct - emissive is summed
   later, so THAT half worked - and a hide that was still authored
   black, still matte, with the segment relief lighting nothing. An
   hour was spent looking for the bug in the colour remap.

   `lights_physical_fragment` is also free: neither `patchMaterial`
   nor the kit anchors on it, so nothing is displaced. */
const HIDE_FRAG = /* glsl */`
  /* --- where on the animal are we, in the pose it was modelled in ---
     vSFObj is the raw position attribute (the kit's varying) and
     vCoObjN the raw normal: both are the bind pose, so nothing below
     swims when the animal coils. Object Z runs +1.4 at the jaws to
     -24 at the tail. */
  vec3  coWN   = inverseTransformDirection(normal, viewMatrix);
  vec3  coObjN = normalize(vCoObjN);
  float coZ    = vSFObj.z;
  float coDors = coObjN.y;                      // -1 belly .. +1 back

  /* --- the segment rings -------------------------------------------
     One sine and its 3x and 9x harmonics through the triple-angle
     identity, so three octaves cost two transcendentals. The screen
     derivative of the PHASE is taken once and does two jobs: it
     antialiases every octave on its own exact footprint, and it is
     the d(phase)/d(screen) the surface gradient needs.

     BOTH DERIVATIVES ARE ABOVE EVERY BRANCH BELOW, for the reason the
     shared kit records: a derivative taken in non-uniform control
     flow is undefined, and the failure mode is one flickering row of
     pixels at a boundary. */
  float coPhase = coZ * uCoRing.x;
  float coDx = dFdx(coPhase);
  float coDy = dFdy(coPhase);
  float coW  = abs(coDx) + abs(coDy);
  float coAA1 = 1.0 / (1.0 + coW * coW * 0.55);
  float coAA2 = 1.0 / (1.0 + coW * coW * 4.95);
  float coAA3 = 1.0 / (1.0 + coW * coW * 44.6);

  float coS1 = sin(coPhase);
  float coC1 = cos(coPhase);
  float coS2 = coS1 * (3.0 - 4.0 * coS1 * coS1);
  float coC2 = coC1 * (4.0 * coC1 * coC1 - 3.0);
  float coS3 = coS2 * (3.0 - 4.0 * coS2 * coS2);
  float coC3 = coC2 * (4.0 * coC2 * coC2 - 3.0);

  /* Varied along the body on a much longer wave, because a ring train
     of constant amplitude is a machined thread. Four zones over
     twenty-five model units - swollen where the animal is thick,
     tight where it tapers - for one extra sine. */
  float coVar = 0.78 + 0.22 * sin(coZ * 0.9 + 1.3);
  /* A narrow deep groove and a broad crest, and the crest is skewed
     to the leading side of it - a symmetric ripple reads as a
     corrugation, and an overlapping plate is what a segmented animal
     actually has. */
  float coTrough = smoothstep(-0.15, -0.92, coS1) * coAA1 * coVar;
  float coLip    = clamp(coS1, 0.0, 1.0) * (0.55 + 0.45 * coC1) * coAA1 * coVar;

  /* --- which material is this facet --------------------------------
     COLOR_0 is the authored mask and it is already a two-band
     painting: the body is authored at luminance under 0.1 and the jaw
     plates between 0.3 and 0.8. Splitting on value is therefore
     reading the author's own intent rather than inventing a mask. */
  float coLum  = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float coHide = 1.0 - smoothstep(0.045, 0.17, coLum);

  /* 1. THE HIDE. Authored flat black, which is a value the lighting
        cannot do anything with: no specular sits on zero and no
        cavity can darken it. Remapped to a cold near-black with a
        belly-to-back gradient, the ring relief driving it, and both
        harmonics TINTING as well as tilting - relief alone only shows
        where a light happens to rake it, and half this animal is
        turned away from the sun at any moment. */
  vec3 coSlick = mix(uCoHide, uCoBack, clamp(0.5 + 0.5 * coDors, 0.0, 1.0));
  coSlick *= 1.0 + 0.34 * coLip - 0.42 * coTrough
    + (0.16 * coS2 * coAA2 + 0.09 * coS3 * coAA3) * coVar;
  vec3 coAlb = mix(diffuseColor.rgb, coSlick, coHide * 0.92);

  /* 2. THE JAW PLATES go cold and grey. They were the same warm tan
        as the dune behind them, which is the one thing the art
        direction forbids outright. */
  coAlb = mix(coAlb, vec3(coLum) * vec3(0.80, 0.93, 1.06), (1.0 - coHide) * 0.72);

  /* 3. THE RELIEF, through Mikkelsen's surface gradient on the kit's
        own world derivatives. The height is in METRES and its
        derivative is analytic, which is the same distinction the kit
        turns on: a finite difference of an aliased height is an
        aliased normal. */
  float coDh = uCoRing.y * coC1 * coAA1 + 3.0 * uCoRing.z * coC2 * coAA2
    + 9.0 * uCoRing.w * coC3 * coAA3;
  vec3  coR1 = cross(sfSigY, coWN);
  vec3  coR2 = cross(coWN, sfSigX);
  float coJ  = dot(sfSigX, coR1);
  vec3  coSG = clamp((coDh * coDx * coR1 + coDh * coDy * coR2)
                     * (sign(coJ) / max(abs(coJ), 1e-9)), vec3(-3.0), vec3(3.0));
  vec3  coN2 = normalize(coWN - coSG);

  /* 4. WET, which is a roughness story and nothing else. 0.14 rather
        than a mirror-smooth 0.10: a tighter lobe is not a stronger
        read, and at 0.10 the sun's highlight was a couple of pixels
        wide on a hundred-metre animal. Wet is a highlight with AREA
        that moves. */
  float coRough = mix(roughnessFactor, 0.14, uCoSkin.y * (0.66 + 0.34 * coLip));

  /* 5. THE SAND CRUST, and it is BEHIND A UNIFORM BRANCH. Every pixel
        of a hundred-metre animal pays for this block, and for most of
        the fight there is no crust left on it to pay for - it sheets
        off through the rise. A branch on a uniform is coherent across
        every quad in the draw, so this costs nothing when it is off.
        Dorsal facets that still point at the sky, packed hardest into
        the grooves where sand actually lodges, with the edge washed
        by the kit's metre-scale mottle - a hard gate on the cell
        field turned the jaw plates into houndstooth. */
  if (uCoSkin.x > 0.02) {
    float coUp = smoothstep(-0.05, 0.55, coN2.y);
    float coCrust = clamp(uCoSkin.x * smoothstep(-0.10, 0.80, coDors) * coUp
      * (0.62 + 0.38 * coTrough)
      * (0.55 + 0.45 * smoothstep(-0.90, 0.60, sfMot + 0.5 * sfCav)), 0.0, 1.0);
    coAlb = mix(coAlb, uCoCrust * (0.94 + 0.12 * sfMot), coCrust);
    coRough = mix(coRough, 0.97, coCrust);
    metalnessFactor = mix(metalnessFactor, 0.0, coCrust);
  }

  /* 6. THE GULLET - the weak point, and the only saturated thing in
        the silhouette. It is a tube, and it has to be masked like
        one: forward of the jaw hinge, facing the axis, AND inside the
        throat's own radius. The first mask had only the first two, so
        it also caught the inward face of every palp - four fronds
        standing over the head, which came back from the gallery lit
        flat venom green and reading as foliage.

        Branched on Z, which is a VARYING and not a uniform - but the
        jaws are one contiguous region at one end of a very long
        animal, so the branch is coherent across every quad except the
        few on its boundary, and it takes this whole block off the
        other ninety per cent of the body. */
  if (coZ > -2.4) {
    float coR  = max(length(vSFObj.xy), 1e-3);
    float coIn = -dot(vSFObj.xy / coR, coObjN.xy);
    float coGullet = smoothstep(-2.2, -0.2, coZ) * smoothstep(0.30, 0.85, coIn)
      * (1.0 - smoothstep(0.9, 1.5, coR));
    coAlb = mix(coAlb, uCoGum, coGullet * 0.88);
    coRough = mix(coRough, 0.075, coGullet * (0.5 + 0.5 * uCoSkin.y));
    totalEmissiveRadiance += uCoVenom * coGullet
      * (0.06 + 0.44 * uCoSkin.w) * (0.25 + 0.75 * uCoSkin.z);
  }

  /* 7. THE TELEGRAPH. sfBio is the kit's vertex-alpha emission - the
        glands are painted into COLOR_0's alpha as a ramp - so the
        sacs are DIMMED between spews and overcharged as one fills. A
        telegraph that is always on is not a telegraph. */
  totalEmissiveRadiance += sfBio * (uCoSkin.w * 0.85 - 0.30);
  /* And the wounds weep the same green. The kit's own damage ember is
     turned nearly off in the options for this material: an orange
     glow in the cracks reads as a furnace, and this animal is a wet
     thing full of venom. Uniform branch again - an undamaged boss
     pays nothing for its damage response. */
  if (uSfWear.z > 0.0) {
    totalEmissiveRadiance += uCoVenom * 0.55 * uSfWear.z * uSfWear.z * sfCrack;
  }

  roughnessFactor = clamp(coRough, 0.045, 1.0);
  diffuseColor.rgb = coAlb;
  normal = normalize((viewMatrix * vec4(coN2, 0.0)).xyz);
#include <lights_physical_fragment>
`;

export function buildCoulter(ctx) {
  const { THREE, scene, atmos, enemies } = ctx;
  const bus = makeBus();
  const C = COULTER_CONFIG;
  const bodyScale = (inst) => Math.max(1, Number(inst?.spec?.bodyScale) || 1);
  const groundAt = (x, z) => (ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : ctx.terrain.heightAt(x, z));

  const group = new THREE.Group();
  group.name = "coulter-venom";
  group.matrixWorldAutoUpdate = true;
  scene.add(group);

  /* ------------------------------------------------------------
     THE HIDE, in JavaScript. The GLSL is at the top of the file.

     Built LAZILY, at the first frame a burrower is alive, for two
     reasons. It needs `inst.spec.scale` to size the grain and the
     rings in world metres, and a dormant boss must cost nothing -
     a material built at load is a program compiled at load for an
     animal that may never be armed this session.
     ------------------------------------------------------------ */
  const skin = {
    mat: null,
    uniforms: null,
    sand: 1,
    wet: 1,
    fill: 0,
    damage: 0,
  };

  function colour(hex) {
    return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
  }

  function hideMaterial(spec) {
    if (skin.mat) return skin.mat;
    const scale = Number(spec?.scale) || 1;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      /* Under the species value of 0.50, because the shader above only
         ever pulls roughness DOWN toward wet - the authored centre has
         to leave room for the crust to push it back up to 0.97. */
      roughness: 0.44,
      metalness: 0.06,
      /* WET IS A REFLECTION OF THE SKY, and at 4% dielectric F0 a dark
         hide reflects almost none of it. Pushing the environment term
         is the one lever that puts an actual highlight on a
         low-albedo surface without lying about its metalness - and a
         highlight is the axis the whole cast was measured as failing:
         a creature with no blown pixel anywhere on it has no wet, no
         polish and no metal. */
      envMapIntensity: 1.25,
    });
    mat.name = "sf-coulter-hide";

    skin.uniforms = {
      uCoSkin: { value: new THREE.Vector4(1, 1, 0, 0) },
      uCoRing: {
        value: new THREE.Vector4(
          (TAU * scale) / COULTER_SKIN.ringMetres,
          COULTER_SKIN.ringRelief, COULTER_SKIN.ringFine, COULTER_SKIN.ringMicro),
      },
      uCoHide: { value: colour(COULTER_SKIN.hide) },
      uCoBack: { value: colour(COULTER_SKIN.back) },
      uCoCrust: { value: colour(COULTER_SKIN.crust) },
      uCoGum: { value: colour(COULTER_SKIN.gum) },
      uCoVenom: { value: colour(COULTER_SKIN.venom) },
    };

    /* THROUGH the kit, which goes through `patchMaterial`: one
       onBeforeCompile and one cache key so far. The overrides are all
       consequences of the animal's SIZE - a hundred-and-eighteen-metre
       burrower photographed from a hundred metres - except `ember`,
       which is a colour decision recorded in the header. */
    applySurface(mat, atmos, "chitin", {
      rim: spec?.material?.rim ?? 1.2,
      bio: spec?.material?.bio ?? 1.95,
      glitter: 0,
      scale,
      /* THE GRAIN HAD TO COME DOWN WHEN THE FADE WENT OUT. Extending
         fadeFar to 520m means the kit's cell field is now at FULL
         strength on plates that used to receive a third of it, and a
         quasi-periodic field at full contrast across a flat jaw petal
         four metres wide still reads as woven cloth. Coarser cells and
         about two thirds of the cavity and mottle: the macro read on
         this animal is its segment rings, which are mine, so the kit
         is carrying texture and not pattern. */
      wavelength: 1.6,
      score: 0.0024,
      pore: 0.0008,
      cavity: 0.28,
      gloss: 0.32,
      sheen: 0.10,
      wear: 0.06,
      mottle: 0.10,
      ember: 0.08,
      /* 130/260 rather than the kit's 46/108, and rather than the
         220/520 the first pass used. The kit's default assumes a
         three-metre creature; at 108m this animal's grain was already
         gone in every frame anyone had looked at. But 520 made the
         WHOLE hundred-and-eighteen metres of it pay the kit's six
         transcendentals at every range, and a paired measurement put
         that at most of a millisecond on a frame that is fill-bound.
         130 covers the band the fight and the gallery both live in
         and lets the far half of a very long animal go cheap. */
      fadeNear: 130,
      fadeFar: 260,
    });

    /* And now the Coulter's own half, wrapped around what the kit
       left. BOTH halves are wrapped: `onBeforeCompile` composes by
       calling the previous one first, and `customProgramCacheKey`
       does not compose at all unless it is done by hand. */
    const prevCompile = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = (shader, renderer) => {
      if (prevCompile) prevCompile(shader, renderer);
      Object.assign(shader.uniforms, skin.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vCoObjN;")
        /* The BIND-POSE normal, before skinning rotates it. Taken here
           because `objectNormal` is what `beginnormal_vertex` has just
           declared and the skinning chunk is the very next one to
           touch it. */
        .replace("#include <beginnormal_vertex>",
          "#include <beginnormal_vertex>\n  vCoObjN = objectNormal;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${HIDE_PARS}`)
        .replace("#include <lights_physical_fragment>", HIDE_FRAG);
    };
    mat.customProgramCacheKey = () =>
      `${prevKey ? prevKey.call(mat) : ""}|coulter1`;
    mat.needsUpdate = true;
    skin.mat = mat;
    return mat;
  }

  /** Put the Coulter's own material on the Coulter.
   *
   *  enemies.js builds ONE material per species and registers it
   *  `shared: true`, which is correct for forty Threshers and wrong
   *  for a boss: the kit refuses a per-instance damage write on a
   *  shared material, so a shared boss can never accumulate damage.
   *  This is the same material family through the same door, owned by
   *  one animal. */
  function adoptSkin(inst) {
    if (inst.coulterSkin || !inst.root) return;
    inst.coulterSkin = true;
    const mat = hideMaterial(inst.spec);
    inst.root.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) child.material = mat;
    });
  }

  /** Drive the skin from the phase the animal is actually in. */
  function updateSkin(inst, dt) {
    if (!skin.uniforms) return;
    const b = inst.body;
    /* Caked while it is in the ground, and it SHEETS OFF as it comes
       out - which is the one thing the art direction asks this animal
       to do that no other boss does. Driven off the phase rather than
       off a timer so a forced phase in QA looks the same as a fought
       one. */
    const buried = b.phase === "burrow" || b.phase === "dive";
    const want = buried ? 1 : COULTER_SKIN.sandFloor;
    skin.sand = buried
      ? Math.min(1, skin.sand + dt * 1.4)
      : Math.max(want, skin.sand - dt * COULTER_SKIN.sandDrain);
    skin.wet = buried
      ? Math.min(1, skin.wet + dt * 1.6)
      : Math.max(COULTER_SKIN.wetFloor, skin.wet - dt * COULTER_SKIN.dryRate);

    /* The sacs fill against the same clock the spew fires on, so what
       the player watches swell IS the cooldown. Dumped the instant it
       launches. */
    let fill = 0;
    if (b.phase === "crest" && b.spewsLeft > 0) {
      fill = clamp01(1 - Math.max(0, b.fireTimer || 0) / C.spewCadence);
    }
    if (b.actionKind === "spew" && b.action > 0 && !(b.pending > 0)) fill = 0;
    skin.fill = damp(skin.fill, fill, 7, dt);

    const u = skin.uniforms.uCoSkin.value;
    u.set(skin.sand, skin.wet, clamp01(b.mawOpen || 0), skin.fill);

    /* Damage accumulates and STAYS: the kit's soot, cracking and wet
       breaks all key on one uniform, and it is written from health
       rather than from hit events so a save that loads at 20% health
       loads an animal that looks it. */
    const hurt = 1 - clamp01(inst.health / Math.max(1, inst.maxHealth));
    if (Math.abs(hurt - skin.damage) > 0.004) {
      skin.damage = hurt;
      setSurfaceDamage(skin.mat, hurt);
    }
  }

  /* ============================================================
     THE WAKE

     What the player actually fights for two thirds of the cycle. It
     has to say three things at once - where the animal is, which way
     it is going, and how fast - from any distance, with nothing above
     the sand to say them with.

     WHAT IT IS NOW: a furrow built out of the animal's own path, a
     ring of cross sections dropped every couple of metres it travels
     and rebuilt every frame so that each one SLUMPS with its own age.

     WHAT IT WAS: one enormous ellipsoid, sunk so that only its top
     sixth showed, slid along under the head. Every objection to that
     shape is the same objection - it is RIGID. Sand that is being
     displaced is not rigid, and the eye knows it at a glance:

       - a rigid body translating along a heading has no relationship
         to the path actually taken, so the ridge swung like a boat
         hull whenever the animal turned rather than curving after it;
       - it was scaled off the animal (four times), which at this
         boss's size made a sixty-nine metre swell barely a metre
         proud - a shape so flat it was indistinguishable from the
         dune it was drawn on. The wake plates in the review sheet
         are photographs of empty sand and nobody noticed for two
         milestones;
       - nothing about it ever settled. Ground that is pushed up has
         to come back down behind, and that collapse is the single
         strongest cue that something MOVED through here.

     The section is a twin levee with a groove between them, not a
     dome: sand forced out of a bore goes sideways and heaps at the
     angle of repose on both sides, and the trench between the heaps
     is what carries the read at distance because it is the only part
     of the shape that holds a shadow. Directly over the animal the
     groove is filled - it is still being lifted from underneath - so
     the profile morphs from swell to split furrow as it ages, which
     is the movement itself rather than a decoration on it.
     ============================================================ */

  /* Ring of cross sections, newest first. Thirty at two metres of
     travel each is sixty metres of furrow - about four and a half
     seconds at burrowing speed, which is roughly how long displaced
     sand should still be readable before it has slumped back. */
  const WAKE_NODES = 30;
  const WAKE_STEP = 2.0;
  /* Two ahead of the head as well, because the sand in FRONT of a
     burrower is already lifting. Without them the ridge ends in a
     wall exactly where the eye is looking hardest. */
  const WAKE_PROW = 2;
  const WAKE_RIB = WAKE_NODES + WAKE_PROW;
  /* lateral offset (x half width), height (x crest), shade.
     The shade multiplies vertex colour: the groove is darker than the
     sand around it and the levee tops catch a little more light,
     which is a contact shadow the lighting cannot give a shape this
     shallow on its own. */
  const WAKE_SECTION = [
    [-1.00, 0.00, 1.00],
    [-0.70, 0.30, 1.05],
    [-0.38, 1.00, 1.10],
    [ 0.00, 0.46, 0.70],
    [ 0.38, 1.00, 1.10],
    [ 0.70, 0.30, 1.05],
    [ 1.00, 0.00, 1.00],
  ];
  const WAKE_ACROSS = WAKE_SECTION.length;
  const WAKE_VERTS = WAKE_RIB * WAKE_ACROSS;

  const wakeIndex = [];
  for (let r = 0; r < WAKE_RIB - 1; r += 1) {
    for (let c = 0; c < WAKE_ACROSS - 1; c += 1) {
      const a0 = r * WAKE_ACROSS + c;
      const a1 = a0 + 1;
      const b0 = a0 + WAKE_ACROSS;
      const b1 = b0 + 1;
      wakeIndex.push(a0, b0, b1, a0, b1, a1);
    }
  }

  /* Sand, and only just darker than the sand it is made of. The first
     pass used a saturated mid-brown, which at any distance read as a
     boat hull parked on a dune rather than as ground being pushed up
     from underneath - a foreign object, and the eye files foreign
     objects as scenery. Freshly turned sand is the same colour with the
     ripples knocked off it, so what has to carry the read is the SHAPE
     and the spray, not the tint. */
  const wakeMat = new THREE.MeshStandardMaterial({
    color: 0xdcaa76,
    roughness: 1,
    metalness: 0,
    /* Smooth, which is the one place this disagrees with the rest of
       the animal - and it agrees with the collar and with art.js's
       `sand` for the same reason. A faceted ridge reads as debris
       piled on the ground rather than as the ground itself. */
    flatShading: false,
    vertexColors: true,
  });
  wakeMat.name = "sf-coulter-wake";
  /* The ripple train the terrain wears, at about half strength: the
     same material with the wind pattern partly knocked off it, which
     is what freshly turned sand is. Take it at full strength and the
     furrow disappears into the dune; leave it off entirely and the
     furrow is the one smooth object in a rippled desert. */
  patchMaterial(wakeMat, atmos, { rim: 0.42, glitter: 0.18, dunes: 0.45 });

  const wakes = new Map();

  function wakeFor(inst) {
    let rig = wakes.get(inst.id);
    if (rig) return rig;
    const geo = new THREE.BufferGeometry();
    const position = new Float32Array(WAKE_VERTS * 3);
    const colour = new Float32Array(WAKE_VERTS * 3).fill(1);
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 3));
    geo.setIndex(wakeIndex);
    const mesh = new THREE.Mesh(geo, wakeMat);
    mesh.name = `sf-wake-${inst.id}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    /* Never culled and never transformed. Every vertex is written in
       world space straight off the animal's path, so a bounding
       sphere would have to be recomputed every frame anyway and a
       local origin would only add a subtraction to each of them. */
    mesh.frustumCulled = false;
    mesh.visible = false;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);
    group.add(mesh);
    rig = {
      mesh, geo,
      nodes: [],
      spray: 0, rumble: 0, markX: 1e9, markZ: 1e9,
      lastX: 1e9, lastZ: 1e9,
    };
    wakes.set(inst.id, rig);
    return rig;
  }

  function hideWake(inst) {
    const rig = wakes.get(inst.id);
    if (rig) rig.mesh.visible = false;
  }

  function disposeWake(id) {
    const rig = wakes.get(id);
    if (!rig) return;
    group.remove(rig.mesh);
    rig.geo.dispose();
    wakes.delete(id);
  }

  /* ============================================================
     THE COLLAR

     Where twenty metres of animal goes into the ground, and until now
     that was a hard polygon intersection: the body met the dune on a
     clean mathematical line with nothing displaced, no rim, no
     shadow, which is the single loudest "this is a model standing in
     a heightfield" tell in the whole gallery. Nothing looks placed
     without a contact.

     ONE MESH, POSITIONED, NOT ONE PER SURFACING. It is a lathe of four
     rings - inner lip, crest, slump, feather - and every vertex is put
     on the sand under it exactly the way a venom pool is, because a
     flat ring laid across a dune slip face is half buried and half
     floating and reads as a decal from another game.

     Rebuilt on a THROTTLE and on MOVEMENT, not every frame. The
     crossing point creeps at half a metre a second during a crest,
     and seventy-two height lookups a frame for a shape that has not
     changed is exactly the kind of cost a dormant boss is not allowed
     to have.
     ============================================================ */
  const COLLAR_SIDES = 18;
  // radius multiple, height multiple. The lip stands proud, the slump
  // runs out to nothing: the angle of repose, not a wall.
  const COLLAR_PROFILE = [[0.80, 0.34], [1.10, 0.62], [1.62, 0.22], [2.30, 0.0]];
  const COLLAR_VERTS = COLLAR_SIDES * COLLAR_PROFILE.length;

  const collarGeo = new THREE.BufferGeometry();
  {
    const position = new Float32Array(COLLAR_VERTS * 3);
    const index = [];
    for (let r = 0; r < COLLAR_PROFILE.length - 1; r += 1) {
      for (let s = 0; s < COLLAR_SIDES; s += 1) {
        const n = (s + 1) % COLLAR_SIDES;
        const a0 = r * COLLAR_SIDES + s;
        const a1 = r * COLLAR_SIDES + n;
        const b0 = (r + 1) * COLLAR_SIDES + s;
        const b1 = (r + 1) * COLLAR_SIDES + n;
        index.push(a0, b0, b1, a0, b1, a1);
      }
    }
    collarGeo.setAttribute("position",
      new THREE.BufferAttribute(position, 3));
    collarGeo.setIndex(index);
  }
  const collarMat = new THREE.MeshStandardMaterial({
    color: 0xd7a973,
    roughness: 0.98,
    metalness: 0,
    /* NOT flat-shaded, and that is the one place this disagrees with
       the rest of the animal: it is sand, and sand in this game is the
       documented exception to faceting (see art.js's `sand`). A
       faceted collar reads as debris rather than as ground. */
    flatShading: false,
  });
  collarMat.name = "sf-coulter-collar";
  /* The same ripple train the terrain wears, at nearly full strength.
     Freshly turned sand is the same material with the wind pattern
     knocked off it, so it takes the dune shader and a little less of
     the ripple, not a tint of its own. */
  patchMaterial(collarMat, atmos, { rim: 0.5, glitter: 0.10, dunes: 0.8 });

  const collar = new THREE.Mesh(collarGeo, collarMat);
  collar.name = "sf-coulter-collar";
  collar.castShadow = false;
  collar.receiveShadow = true;
  collar.visible = false;
  collar.frustumCulled = false;
  group.add(collar);
  const collarState = { x: 0, z: 0, radius: 0, tick: 0, shed: 0 };

  /** Where the body crosses the sand, walking the chain from the head
   *  back until a joint goes under. Returns null while it is entirely
   *  above or entirely below. */
  function crossing(inst) {
    const joints = inst.body.joints;
    let px = inst.body.head.x;
    let pz = inst.body.head.z;
    let pAbove = inst.body.head.y - groundAt(px, pz);
    for (let i = 0; i < joints.length; i += 1) {
      const j = joints[i];
      const above = j.y - groundAt(j.x, j.z);
      if (pAbove > 0 && above <= 0) {
        const t = pAbove / Math.max(1e-4, pAbove - above);
        return { x: px + (j.x - px) * t, z: pz + (j.z - pz) * t, index: i };
      }
      px = j.x; pz = j.z; pAbove = above;
    }
    return null;
  }

  function rebuildCollar(x, z, radius) {
    const y = groundAt(x, z);
    const p = collarGeo.attributes.position.array;
    for (let r = 0; r < COLLAR_PROFILE.length; r += 1) {
      const [rf, hf] = COLLAR_PROFILE[r];
      for (let s = 0; s < COLLAR_SIDES; s += 1) {
        const a = (s / COLLAR_SIDES) * TAU;
        /* Wobbled per ring and per side. A circle is a decal; a
           collar thrown up by an animal forcing through a surface is
           lobed, and the lobes have to disagree between rings or the
           whole thing reads as one scaled circle. */
        const wob = 1 - 0.14 * Math.sin(a * 3 + r * 1.9) - 0.08 * Math.cos(a * 5 - r);
        const px = Math.cos(a) * radius * rf * wob;
        const pz = Math.sin(a) * radius * rf * wob;
        const i = (r * COLLAR_SIDES + s) * 3;
        p[i] = px;
        p[i + 1] = groundAt(x + px, z + pz) - y
          + radius * hf * (0.82 + 0.36 * Math.sin(a * 4 + r));
        p[i + 2] = pz;
      }
    }
    collar.position.set(x, y + 0.05, z);
    collarGeo.attributes.position.needsUpdate = true;
    collarGeo.computeVertexNormals();
    collarGeo.computeBoundingSphere();
    collarState.x = x;
    collarState.z = z;
    collarState.radius = radius;
  }

  function updateCollar(inst, dt) {
    const b = inst.body;
    const live = b.phase !== "dead" && !b.hidden;
    const hit = live ? crossing(inst) : null;
    if (!hit) {
      if (collar.visible) collar.visible = false;
      return;
    }
    const size = bodyScale(inst);
    /* Sized off the animal, not off the arena: the body is 2.2 model
       units across and drawn at `scale`, so the hole it makes is about
       ten metres wide and a collar smaller than that is a ring the
       animal is standing outside of. */
    const radius = 2.35 * size * 1.16;
    collarState.tick -= dt;
    const moved = Math.hypot(hit.x - collarState.x, hit.z - collarState.z);
    if (!collar.visible || collarState.tick <= 0 || moved > 1.1) {
      collarState.tick = 0.18;
      rebuildCollar(hit.x, hit.z, radius);
      collar.visible = true;
    }

    /* And it SHEDS. The crust the shader is draining off the animal's
       back has to land somewhere, or the topside simply gets cleaner
       for no reason the player can see. */
    collarState.shed -= dt;
    if (collarState.shed > 0) return;
    collarState.shed = b.phase === "rise" ? 0.07 : 0.30;
    const power = (0.7 + skin.sand * 1.9) * Math.sqrt(size);
    const a = Math.random() * TAU;
    ctx.vfx?.sandSpray?.(hit.x + Math.cos(a) * radius * 0.55,
      groundAt(hit.x, hit.z) + 0.5,
      hit.z + Math.sin(a) * radius * 0.55,
      power, Math.cos(a) * 0.5, Math.sin(a) * 0.5);
  }

  /* ============================================================
     GLOBULES

     A travelling ballistic projectile, distinct from the Gleaner's
     straight swept bolt. Venom has to arc and actually fly, because the
     whole point of it is that it can be walked out from under - a
     hitscan spew would just be a stronger Gleaner attack.
     ============================================================ */
  const globuleGeo = new THREE.IcosahedronGeometry(0.42, 1);
  const globuleMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(VENOM_COLOUR),
    emissive: new THREE.Color(VENOM_EMISSIVE),
    emissiveIntensity: 1.55,
    roughness: 0.34,
    metalness: 0,
    flatShading: true,
  });
  globuleMat.name = "sf-venom-globule";
  patchMaterial(globuleMat, atmos, { rim: 0.55, glitter: 0 });

  const globules = [];
  for (let i = 0; i < GLOBULES; i += 1) {
    const mesh = new THREE.Mesh(globuleGeo, globuleMat);
    mesh.visible = false;
    mesh.castShadow = false;
    group.add(mesh);
    globules.push({
      mesh, live: false, life: 0,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, scale: 1,
    });
  }
  let globuleCursor = 0;

  function launchGlobule(x, y, z, vx, vy, vz, scale = 1) {
    const g = globules[globuleCursor];
    globuleCursor = (globuleCursor + 1) % GLOBULES;
    g.live = true;
    g.life = 4.5;
    g.x = x; g.y = y; g.z = z;
    g.vx = vx; g.vy = vy; g.vz = vz;
    g.scale = scale;
    g.spin = (Math.random() - 0.5) * 9;
    g.mesh.position.set(x, y, z);
    g.mesh.scale.setScalar(scale);
    g.mesh.visible = true;
    return g;
  }

  /* ============================================================
     POOLS

     The hazard that outlives the animal. Pooled meshes rather than
     allocated ones, and each one's geometry is REWRITTEN on landing so
     its rim sits on the sand it actually landed on - a flat disc laid
     across a dune slip face is half buried and half floating, which
     reads as a decal from a different game.
     ============================================================ */
  const POOL_RINGS = 3;
  const POOL_SIDES = 22;
  const POOL_VERTS = 1 + POOL_RINGS * POOL_SIDES;

  const poolVertex = /* glsl */`
    attribute float aRadial;
    varying float vRadial;
    varying vec3 vWorld;
    void main() {
      vRadial = aRadial;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;
  /* NOT ADDITIVE, and that is the whole difference between this reading
     as venom and reading as a light on the floor.

     The first version added bright green to the ground, which on lit
     orange sand mostly cancels: the pool came out as a pale wash you
     had to be told about. A liquid on sand is DARKER than the sand -
     it soaks in - so the bed is drawn as a dark stain over the top with
     ordinary alpha, and only the creeping rim is bright. Darkening is
     something additive blending cannot do at any intensity. */
  const poolFragment = /* glsl */`
    precision highp float;
    uniform vec3 uCore;
    uniform vec3 uEdge;
    uniform vec3 uBed;
    uniform float uFade;
    uniform float uTime;
    varying float vRadial;
    varying vec3 vWorld;
    void main() {
      float r = clamp(vRadial, 0.0, 1.0);
      // A soaked bed, a bright creeping rim, and a slow crawl outward so
      // the pool reads as spreading rather than as painted on.
      float bed = 1.0 - smoothstep(0.42, 1.0, r);
      float crawl = 0.55 + 0.45 * sin(uTime * 1.6 - r * 6.0);
      float rim = smoothstep(0.48, 0.88, r) * (1.0 - smoothstep(0.88, 1.0, r));
      vec3 c = mix(uBed, uEdge, bed * 0.6);
      c = mix(c, uCore, clamp(rim * crawl * 1.6, 0.0, 1.0));
      // Faded with distance so a pool two districts away does not draw a
      // hard green disc through the aerial perspective everything else
      // obeys.
      float dist = length(cameraPosition - vWorld);
      float far = 1.0 - smoothstep(180.0, 300.0, dist);
      float a = (bed * 0.74 + rim * 0.86) * uFade * far;
      if (a < 0.006) discard;
      gl_FragColor = vec4(c, clamp(a, 0.0, 0.94));
    }
  `;

  const pools = [];
  for (let i = 0; i < C.poolMax; i += 1) {
    const geo = new THREE.BufferGeometry();
    const position = new Float32Array(POOL_VERTS * 3);
    const radial = new Float32Array(POOL_VERTS);
    const index = [];
    for (let s = 0; s < POOL_SIDES; s += 1) {
      const n = (s + 1) % POOL_SIDES;
      index.push(0, 1 + s, 1 + n);
      for (let r = 0; r < POOL_RINGS - 1; r += 1) {
        const a0 = 1 + r * POOL_SIDES + s;
        const a1 = 1 + r * POOL_SIDES + n;
        const b0 = 1 + (r + 1) * POOL_SIDES + s;
        const b1 = 1 + (r + 1) * POOL_SIDES + n;
        index.push(a0, b0, b1, a0, b1, a1);
      }
    }
    for (let r = 0; r < POOL_RINGS; r += 1) {
      const t = (r + 1) / POOL_RINGS;
      for (let s = 0; s < POOL_SIDES; s += 1) radial[1 + r * POOL_SIDES + s] = t;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("aRadial", new THREE.BufferAttribute(radial, 1));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCore: { value: new THREE.Color(VENOM_EMISSIVE) },
        uEdge: { value: new THREE.Color("#5c8f14") },
        uBed: { value: new THREE.Color("#15250a") },
        uFade: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: poolVertex,
      fragmentShader: poolFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `sf-venom-pool-${i}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    pools.push({
      mesh, mat, position, life: 0, span: 1, x: 0, y: 0, z: 0,
      radius: C.poolRadius, gas: 0,
    });
  }
  let poolCursor = 0;

  function spillPool(x, z, radius = C.poolRadius, seconds = C.poolSeconds) {
    const pool = pools[poolCursor];
    poolCursor = (poolCursor + 1) % pools.length;
    const y = groundAt(x, z);
    pool.x = x; pool.y = y; pool.z = z;
    pool.radius = radius;
    pool.span = seconds;
    pool.life = seconds;
    pool.gas = 0;
    const p = pool.position;
    p[0] = 0; p[1] = 0.09; p[2] = 0;
    for (let r = 0; r < POOL_RINGS; r += 1) {
      const rr = radius * ((r + 1) / POOL_RINGS);
      for (let s = 0; s < POOL_SIDES; s += 1) {
        const a = (s / POOL_SIDES) * TAU + r * 0.14;
        // Wobbled, so a pool is never a circle. A circle is a decal.
        const wob = 1 - 0.13 * Math.sin(a * 3 + r * 1.7) - 0.07 * Math.cos(a * 5);
        const px = Math.cos(a) * rr * wob;
        const pz = Math.sin(a) * rr * wob;
        const i = (1 + r * POOL_SIDES + s) * 3;
        p[i] = px;
        // Every rim vertex put on the sand under it. This is the whole
        // difference between a puddle and a sticker.
        p[i + 1] = groundAt(x + px, z + pz) - y + 0.085;
        p[i + 2] = pz;
      }
    }
    pool.mesh.position.set(x, y, z);
    pool.mesh.geometry.attributes.position.needsUpdate = true;
    pool.mesh.geometry.computeBoundingSphere();
    pool.mesh.visible = true;
    ctx.vfx?.venomBurst?.(x, y + 0.35, z, radius * 0.42);
    bus.emit("spill", { x, y, z, radius });
    return pool;
  }

  /* ============================================================
     THE PLAYER'S PROBLEM

     Venom is tracked as one scalar that fills while standing in it and
     drains slowly afterwards, and the damage is applied in HALF-SECOND
     TICKS rather than per frame. Per frame is the obvious way and it
     is wrong twice: it fires the hurt bus sixty times a second, so the
     audio layer stutters a wince every frame, and it makes the number
     the player sees depend on their frame rate.
     ============================================================ */
  const toxin = { level: 0, tick: 0, inPool: false, source: null };

  function poolAt(x, y, z) {
    for (const pool of pools) {
      if (pool.life <= 0) continue;
      const dx = x - pool.x;
      const dz = z - pool.z;
      if (dx * dx + dz * dz > pool.radius * pool.radius) continue;
      // Standing on a roof above a pool is not standing in it.
      if (Math.abs(y - pool.y) > 3.4) continue;
      return pool;
    }
    return null;
  }

  function updateToxin(dt) {
    const combat = ctx.combat;
    const ps = ctx.player?.state;
    if (!combat || !ps) return;
    const standing = combat.player.dead ? null : poolAt(ps.x, ps.y, ps.z);
    toxin.inPool = !!standing;
    if (standing) {
      if (toxin.level <= 0.001) bus.emit("poisoned", { x: ps.x, z: ps.z });
      toxin.level = clamp01(toxin.level + dt * C.toxinRise);
    } else {
      toxin.level = Math.max(0, toxin.level - dt * C.toxinDecay);
    }
    if (toxin.level <= 0) { toxin.tick = 0; return; }
    toxin.tick += dt;
    if (toxin.tick < C.toxinTick) return;
    const seconds = toxin.tick;
    toxin.tick = 0;
    combat.hurtPlayer(C.toxinDps * toxin.level * seconds, {
      source: "venom",
      x: ps.x,
      y: ps.y + 1.0,
      z: ps.z,
    });
  }

  /** A direct hit, which is worth a fifth of a pool's worth of toxin
   *  on its own so that dodging the globules matters. */
  function splash(x, y, z, direct) {
    if (direct && ctx.combat) {
      ctx.combat.hurtPlayer(C.spewDirect * SURVIVAL_CONFIG.enemyDamageMultiplier, {
        source: "venom-globule", x, y, z,
      });
      toxin.level = clamp01(toxin.level + 0.34);
    }
    spillPool(x, z, C.poolRadius * (direct ? 0.82 : 1));
  }

  /* ============================================================
     BEING SHOT

     A flinch has to say WHERE it was hit or it is a wince, and a
     twenty-metre animal winces in one place at a time.

     IMPLEMENTED AS A DECAYING OFFSET ON THE JOINTS, not as a push on
     the trail, and the difference is the whole reason this is written
     down. Pushing the trail is the obvious answer - the body is laid
     along it, so a shove there ripples down the animal exactly the way
     flesh does. It also never comes back: every shove is away from the
     shooter, an automatic weapon lands eight a second, and after one
     crest the boss has walked thirty metres sideways out of its own
     fight. The offset below rings and dies, is bounded by its own
     decay, and leaves the trail - which is the animal's actual path -
     untouched.
     ============================================================ */
  function hurtSkin(inst, ev, strength) {
    const b = inst.body;
    /* Nearest joint to the impact, because that is the piece of the
       animal that has to move; the head is included by hand because it
       is not in the joint list. */
    let bx = b.head.x;
    let by = b.head.y;
    let bz = b.head.z;
    let bd = (bx - ev.x) ** 2 + (by - ev.y) ** 2 + (bz - ev.z) ** 2;
    for (const j of b.joints) {
      const d = (j.x - ev.x) ** 2 + (j.y - ev.y) ** 2 + (j.z - ev.z) ** 2;
      if (d < bd) { bd = d; bx = j.x; by = j.y; bz = j.z; }
    }
    let nx = bx - ev.x;
    let ny = by - ev.y;
    let nz = bz - ev.z;
    const n = Math.hypot(nx, ny, nz) || 1;
    nx /= n; ny /= n; nz /= n;
    const cap = 0.9 * Math.sqrt(bodyScale(inst));
    const prev = b.flinch && b.flinch.mag > 0.01 ? b.flinch.mag : 0;
    b.flinch = {
      x: ev.x, y: ev.y, z: ev.z, nx, ny, nz, t: 0,
      mag: Math.min(cap, prev + 0.26 * strength * Math.sqrt(bodyScale(inst))),
    };
  }

  function applyFlinch(inst, dt) {
    const b = inst.body;
    const f = b.flinch;
    if (!f || f.mag < 0.012) return;
    f.t += dt;
    f.mag *= Math.exp(-5.5 * dt);
    /* Rings rather than simply relaxing. Meat that takes a hit
       oscillates once or twice; a pure exponential return reads as the
       animal being pushed and then dragged back on a rail. */
    const swing = Math.sin(f.t * 19) * f.mag;
    const reach = 8.5 * bodyScale(inst);
    for (const j of b.joints) {
      const d = Math.hypot(j.x - f.x, j.y - f.y, j.z - f.z);
      if (d > reach) continue;
      const w = (1 - d / reach) ** 2 * swing;
      j.x += f.nx * w;
      j.y += f.ny * w;
      j.z += f.nz * w;
    }
  }

  /** Ichor: what a wet animal does when it is opened. Rate-limited
   *  because an automatic weapon would otherwise ask for a burst every
   *  eighth of a second and the impact pool has other customers. */
  let ichorTick = 0;

  function onDamaged(ev) {
    const key = ev.enemyKey || ev.key;
    if (key !== "coulter") return;
    const inst = enemies.live.find((e) => e.body && e.state !== "death");
    if (!inst) return;
    const strength = clamp01((ev.actual || 0) / Math.max(1, inst.maxHealth * 0.02));
    hurtSkin(inst, ev, strength);
    if (atmos.elapsed - ichorTick < 0.12) return;
    ichorTick = atmos.elapsed;
    /* The weak point bleeds harder, which is the only feedback in the
       fight that says the mouth was worth aiming at. */
    ctx.vfx?.venomBurst?.(ev.x, ev.y, ev.z,
      (ev.weak || ev.head ? 1.5 : 0.75) * (0.6 + strength * 0.7));
    /* And it LANDS. A stain under the animal is the difference between
       damage that happened and damage that happened here. */
    const ground = groundAt(ev.x, ev.z);
    if (ev.y - ground < 26 && Math.random() < 0.35) {
      ctx.vfx?.skidMark?.(ev.x + (Math.random() - 0.5) * 9, ev.z + (Math.random() - 0.5) * 9,
        Math.random() * TAU, 0.55 + strength * 0.4, 1.6);
    }
  }

  const offDamaged = ctx.combat?.bus?.on?.("enemyDamaged", onDamaged) || null;

  /* ============================================================
     BEHAVIOUR
     ============================================================ */

  function headTarget() {
    const ps = ctx.player.state;
    return { x: ps.x, y: ps.y + 1.1, z: ps.z };
  }

  /** Advance the head along its heading. */
  function travel(inst, dt, speed) {
    const b = inst.body;
    const cp = Math.cos(b.pitch);
    b.dir.set(Math.sin(b.heading) * cp, Math.sin(b.pitch), Math.cos(b.heading) * cp);
    b.head.addScaledVector(b.dir, speed * dt);
    b.head.x = clamp(b.head.x, -955, 955);
    b.head.z = clamp(b.head.z, -955, 955);
  }

  /**
   * THE TRAIL. Called once per frame, AFTER every other thing that can
   * move the head.
   *
   * Each sample carries its distance behind the head, and that distance
   * is bumped by how far the head ACTUALLY moved this frame - measured
   * from its previous position rather than taken from the travel speed.
   * Those two numbers are not the same and the difference is a real bug
   * with a very confusing signature: the crest phase also lifts the head
   * out of the sand, and a version of this that trusted `speed * dt`
   * recorded a hundredth of a metre of arc for most of a metre of real
   * movement. The body was then sampled at arc lengths that no longer
   * matched the path, so consecutive vertebrae ended up nine metres
   * apart and the animal came out as a row of disconnected chunks.
   *
   * New samples are only laid every 0.9m. Denser is wasted - the body is
   * sampled at 1.72m intervals - and sparser lets a hard turn cut a
   * corner the body then visibly straightens out.
   */
  function layTrail(inst) {
    const b = inst.body;
    const trail = b.trail;
    const moved = Math.hypot(b.head.x - b.prev.x, b.head.y - b.prev.y,
      b.head.z - b.prev.z);
    b.prev.copy(b.head);
    if (moved > 1e-6) {
      for (let i = 0; i < trail.length; i += 1) trail[i].d += moved;
    }
    /* Laid, never moved. A sample records where the head WAS, and the
       gap between the newest sample and the head is covered by the
       sampler, which anchors on the live head position - see
       `trailAt`. */
    if (!trail.length || trail[0].d >= 0.9) {
      trail.unshift({ x: b.head.x, y: b.head.y, z: b.head.z, d: 0 });
    }
    // Keep just enough tail to lay the body along, plus a margin.
    const keep = inst.spineLength + 4;
    while (trail.length > 4 && trail[trail.length - 2].d > keep) trail.pop();
  }

  /** Is every part of the animal under the sand? */
  function submergedFully(inst) {
    const b = inst.body;
    const surface = groundAt(b.head.x, b.head.z);
    const hideDepth = 1.2 * bodyScale(inst);
    if (b.head.y > surface - hideDepth) return false;
    for (const joint of b.joints) {
      if (joint.y > groundAt(joint.x, joint.z) - hideDepth) return false;
    }
    return true;
  }

  function setPhase(inst, phase, seconds) {
    const b = inst.body;
    b.phase = phase;
    b.timer = seconds;
    return b;
  }

  function huntSeconds(inst) {
    // The one place the boss escalates: a wounded Coulter gives the
    // player less time between surfacings, not more health.
    const hurt = 1 - clamp01(inst.health / Math.max(1, inst.maxHealth));
    return lerp(C.huntSecondsMax, C.huntSecondsMin, hurt);
  }

  function stepBurrow(inst, dt, target) {
    const b = inst.body;
    b.hidden = submergedFully(inst);
    b.mawOpen = 0;
    if (inst.state !== "idle" && inst.state !== "alert") enemies.play(inst, "idle", 0.4);

    const dx = target.x - b.head.x;
    const dz = target.z - b.head.z;
    const dist = Math.hypot(dx, dz);
    b.heading = dampAngle(b.heading, Math.atan2(dx, dz), C.turnRate.burrow, dt);

    /* Depth autopilot: aim the head at where the floor will be a few
       metres ahead, rather than at where it is now. Chasing the
       current height makes the animal climb dune faces in steps; a
       lookahead makes it swim. */
    const ahead = 11 * bodyScale(inst);
    const wantY = groundAt(b.head.x + Math.sin(b.heading) * ahead,
      b.head.z + Math.cos(b.heading) * ahead) - C.burrowDepth;
    b.pitch = clamp(Math.atan2(wantY - b.head.y, ahead), -0.5, 0.5);
    travel(inst, dt, inst.spec.speed.charge);

    // Floored rather than left to run away negative: a timer at -400
    // is a save file that fails validation, and "ready" is a state
    // rather than a quantity.
    b.timer = Math.max(-1, b.timer - dt);
    if (b.timer <= 0 && dist < C.riseRange) {
      beginRise(inst, target);
    }
  }

  /** Commit to the eruption. The district intro also calls this once,
   *  because its protected camera hold must reveal the animal rather
   *  than spend three seconds filming the wake above a six-second
   *  burrow timer. `dangerous=false` keeps that cinematic breach from
   *  damaging a player whose controls are deliberately locked. */
  function beginRise(inst, target, dangerous = true) {
    if (!inst?.body || inst.state === "death") return false;
    const b = inst.body;
    const dx = target.x - b.head.x;
    const dz = target.z - b.head.z;
    b.heading = Math.atan2(dx, dz);
    setPhase(inst, "rise", C.riseSeconds);
    b.spewsLeft = Math.round(lerp(C.spewsPerCrest[0], C.spewsPerCrest[1],
      1 - clamp01(inst.health / Math.max(1, inst.maxHealth))));
    b.hidden = false;
    breach(inst, dangerous);
    return true;
  }

  /** The eruption, resolved at the moment it starts. */
  function breach(inst, dangerous = true) {
    const b = inst.body;
    const surface = groundAt(b.head.x, b.head.z);
    const combat = ctx.combat;
    enemies.play(inst, "alert", 0.08);
    ctx.vfx?.breach?.(b.head.x, surface, b.head.z, C.breachRadius * 1.5, 2.2);
    ctx.vfx?.sandSpray?.(b.head.x, surface + 0.4, b.head.z,
      2.6 * Math.sqrt(bodyScale(inst)),
      Math.sin(b.heading), Math.cos(b.heading));
    bus.emit("breach", { x: b.head.x, y: surface, z: b.head.z, id: inst.id });

    /* THE GROUND ANSWERS, whether or not the player was standing on
       it. A hundred metres of animal coming out of a dune is felt from
       the far side of the basin, and a shake that only fires when the
       damage lands teaches the player that a breach they dodged did
       not happen. Falls off over 190m, which is most of the arena. */
    const watcher = ctx.player?.state;
    if (watcher) {
      const far = Math.hypot(watcher.x - b.head.x, watcher.z - b.head.z);
      ctx.player.punch?.(clamp(2.1 * (1 - far / 190), 0, 2.1));
    }
    /* Sand thrown outward on eight bearings rather than one. The
       single directional spray it had reads as a jet; an eruption
       throws a curtain. */
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * TAU + Math.random() * 0.3;
      ctx.vfx?.sandSpray?.(b.head.x + Math.sin(a) * C.breachRadius * 0.55,
        surface + 0.5, b.head.z + Math.cos(a) * C.breachRadius * 0.55,
        1.9 * Math.sqrt(bodyScale(inst)), Math.sin(a), Math.cos(a));
    }

    const ps = ctx.player?.state;
    if (!dangerous || !combat || !ps || combat.player.dead) return;
    const d = Math.hypot(ps.x - b.head.x, ps.z - b.head.z);
    if (d > C.breachRadius) return;
    /* Falls off to nothing at the rim, so being caught by the edge of
       an eruption is a warning and being caught by the middle of it is
       most of a life. */
    const falloff = 1 - 0.55 * (d / C.breachRadius);
    combat.hurtPlayer(C.breachDamage * falloff * SURVIVAL_CONFIG.enemyDamageMultiplier
      * (Number.isFinite(inst.damageScale) ? inst.damageScale : 1), {
      source: "coulter-breach",
      x: b.head.x, y: surface + 1.5, z: b.head.z, enemy: inst.key,
    });
    ctx.player.punch?.(1.6);
  }

  function stepRise(inst, dt, target) {
    const b = inst.body;
    b.hidden = false;
    const t = 1 - clamp01(b.timer / C.riseSeconds);
    /* THE PITCH CURVE IS THE ARC, because the body is laid along the
       path the head took. Three stages, and each one is answering
       something a review frame showed:

         BREAK OUT, steeply, for the first third. It starts 5.6m under
         the sand and every metre of path spent underground is a metre
         of body that will not be visible, so the fastest way out is up.

         FLATTEN through the middle. This is where the arch is made: the
         head keeps climbing but the path turns over, so what follows it
         out of the ground is a CURVE. A constant pitch here gave a
         straight ramp - a submarine surfacing - and finishing the rise
         steep gave a black post standing in a dune with the whole
         animal buried under it.

         LEVEL at the top, so the last few metres of travel carry the
         head forward over the player rather than further up away from
         them. Nine metres of clearance is a landmark; fifteen is a
         creature the player cannot shoot. */
    b.pitch = t < 0.34
      ? lerp(0.62, 1.22, t / 0.34)
      : t < 0.72
        ? lerp(1.22, 0.44, (t - 0.34) / 0.38)
        : lerp(0.44, 0.06, (t - 0.72) / 0.28);
    const dx = target.x - b.head.x;
    const dz = target.z - b.head.z;
    b.heading = dampAngle(b.heading, Math.atan2(dx, dz), C.turnRate.rise, dt);
    travel(inst, dt, C.riseSpeed);
    b.mawOpen = clamp01(t * 1.6) * 0.45;

    const clearance = b.head.y - groundAt(b.head.x, b.head.z);
    b.timer -= dt;
    if (b.timer <= 0 || clearance > C.riseClearance) {
      setPhase(inst, "crest", C.crestSeconds);
      b.surfacings += 1;
      b.fireTimer = 0.55;
      bus.emit("crest", { x: b.head.x, y: b.head.y, z: b.head.z, id: inst.id });
    }
  }

  /**
   * ANTICIPATION, THRUST, RECOVERY - as a speed along the heading,
   * which is the only way to animate this animal's body.
   *
   * The clips own the mouth and nothing else: the body is laid along
   * the path the head took, so a strike that is only a jaw clip is a
   * jaw clip on a post. Driving the HEAD instead writes the whole
   * motion into the trail, and twenty metres of body follow it a beat
   * later for free - which is the secondary motion this animal was
   * missing.
   *
   * The curve is pinned to the clip's own contact frame: the mouth
   * closes at `biteContact` (0.17s of 0.53), so the coil has to be
   * finished and the drive has to be at full speed by then, or the
   * damage lands while the head is still travelling backwards.
   */
  function strikeSurge(inst) {
    const b = inst.body;
    if (!(b.action > 0)) return 0;
    const size = bodyScale(inst) * 0.55;
    if (b.actionKind === "bite") {
      const el = 0.53 - b.action;
      if (el < 0.11) return -16 * (el / 0.11) * size;
      if (el < 0.20) return 30 * ((el - 0.11) / 0.09) * size;
      return 30 * Math.exp(-5 * (el - 0.20)) * size;
    }
    /* The spew is the mirror image: it rears BACK to fill, and heaves
       forward on the launch frame. The recoil is what makes a
       telegraph readable from sixty metres without a UI element. */
    const el = 0.90 - b.action;
    if (el < C.spewLaunch) return -7 * (el / C.spewLaunch) * size;
    return 13 * Math.exp(-4.5 * (el - C.spewLaunch)) * size;
  }

  function stepCrest(inst, dt, target) {
    const b = inst.body;
    b.hidden = false;
    b.timer -= dt;

    /* Reared and anchored. It creeps rather than freezing, because a
       boss that is exactly still for nine seconds looks like the
       simulation stopped - but the creep is slow enough that the arc
       it came up in is preserved, which is what makes it read as
       standing rather than as swimming through the air. */
    const dx = target.x - b.head.x;
    const dz = target.z - b.head.z;
    const flat = Math.hypot(dx, dz);
    /* THE WEAVE. Aimed a few degrees either side of the player on a
       slow clock rather than exactly at them: a boss that holds a
       perfect bearing for twelve seconds is a turret, and because the
       heading writes into the trail the whole reared column sways with
       a lag that gets longer the further down the body you look. It is
       an offset on the TARGET, never on the heading itself - added to
       the state it would integrate into a slow spin. */
    const weave = Math.sin(atmos.elapsed * 0.63) * 0.11;
    b.heading = dampAngle(b.heading, Math.atan2(dx, dz) + weave,
      C.turnRate.crest, dt);
    /* Crane over toward the player: pitch down as they get closer, so
       the animal is looking AT them rather than at the horizon. The
       floor of the clamp is steep enough to reach a player standing
       directly under a nine-metre head - anything shallower and the
       most dangerous place to stand is also the one place the mouth
       cannot point. */
    const wantPitch = clamp(Math.atan2(target.y - b.head.y, Math.max(3, flat)),
      -0.95, 0.30);
    b.pitch = damp(b.pitch, wantPitch, 2.4, dt);
    travel(inst, dt, inst.spec.speed.walk * 0.24 + strikeSurge(inst));
    /* And it BREATHES. A cosine velocity integrates to a bounded sine
       of displacement, so this heaves the head about two metres up and
       down without any state to drift - and, again, the body reads it
       out of the trail a beat behind. */
    b.head.y += Math.cos(atmos.elapsed * 0.71) * 1.45 * Math.sqrt(bodyScale(inst)) * dt;

    // Keep the head out of the sand: a crane-down that drives the
    // mouth into a dune would bury the weak point.
    const floor = groundAt(b.head.x, b.head.z) + 3.4 * bodyScale(inst);
    if (b.head.y < floor) b.head.y = damp(b.head.y, floor, 6, dt);

    b.fireTimer = (b.fireTimer || 0) - dt;
    b.action = Math.max(0, (b.action || 0) - dt);

    if (b.action > 0) {
      // Mid-attack: the clip owns the mouth, so only the pending
      // damage/launch beat is resolved here.
      resolveAction(inst, dt, target);
    } else if (b.fireTimer <= 0) {
      const vertical = Math.abs(target.y - b.head.y);
      if (flat < C.biteReach && vertical < C.biteVertical) beginBite(inst);
      else if (b.spewsLeft > 0) beginSpew(inst, target);
      else b.fireTimer = 0.6;
    }

    if (b.timer <= 0 && b.action <= 0) {
      setPhase(inst, "dive", 6);
      enemies.play(inst, "idle", 0.3);
      bus.emit("dive", { x: b.head.x, y: b.head.y, z: b.head.z, id: inst.id });
    }
    /* The maw's opening is read off the clip's own progress rather than
       tracked separately: it is what gates the weak point, so a
       divergence between "the mouth looks open" and "the mouth counts
       as open" would be the single most unfair bug this fight could
       have. */
    b.mawOpen = mawFromClip(inst);
  }

  function mawFromClip(inst) {
    const b = inst.body;
    if (!b.action || !b.actionKind) return inst.state === "alert" ? 0.34 : 0.12;
    const spec = b.actionKind === "spew"
      ? { total: 0.90, peak: C.spewLaunch }
      : { total: 0.53, peak: C.biteContact };
    const elapsed = spec.total - b.action;
    if (elapsed < 0) return 0.12;
    // Up to the contact frame, then shut.
    return elapsed < spec.peak
      ? clamp01(elapsed / Math.max(0.05, spec.peak))
      : clamp01(1 - (elapsed - spec.peak) / Math.max(0.05, spec.total - spec.peak));
  }

  function beginBite(inst) {
    const b = inst.body;
    enemies.play(inst, "strike", 0.08);
    b.action = 0.53;
    b.actionKind = "bite";
    b.pending = C.biteContact;
    b.fireTimer = C.biteCadence;
    bus.emit("bite", { x: b.head.x, y: b.head.y, z: b.head.z, id: inst.id });
  }

  function beginSpew(inst, target) {
    const b = inst.body;
    enemies.play(inst, "spew", 0.1);
    b.action = 0.90;
    b.actionKind = "spew";
    b.pending = C.spewLaunch;
    b.spewsLeft -= 1;
    b.fireTimer = C.spewCadence;
    b.aim = { x: target.x, y: target.y, z: target.z };
  }

  function resolveAction(inst, dt, target) {
    const b = inst.body;
    if (!(b.pending > 0)) return;
    b.pending -= dt;
    if (b.pending > 0) return;
    b.pending = 0;
    if (b.actionKind === "bite") landBite(inst, target);
    else launchSpew(inst);
  }

  function landBite(inst, target) {
    const b = inst.body;
    const combat = ctx.combat;
    /* THE JAWS CLOSING IS A PHYSICAL EVENT, and it happens whether or
       not they closed on anybody. Resolved before the hit test for
       exactly that reason: a strike the player dodged has to look and
       feel like a strike that missed, not like nothing. */
    const ground = groundAt(b.head.x, b.head.z);
    const low = b.head.y - ground;
    if (low < 14 * bodyScale(inst)) {
      ctx.vfx?.sandSpray?.(b.head.x, ground + 0.4, b.head.z,
        2.2 * Math.sqrt(bodyScale(inst)), Math.sin(b.heading), Math.cos(b.heading));
    }
    const watcher = ctx.player?.state;
    if (watcher) {
      const far = Math.hypot(watcher.x - b.head.x, watcher.z - b.head.z);
      ctx.player.punch?.(clamp(1.0 * (1 - far / 90), 0, 1.0));
    }
    if (!combat || combat.player.dead) return;
    const flat = Math.hypot(target.x - b.head.x, target.z - b.head.z);
    // Re-tested at the contact frame, not at the wind-up: the mouth
    // closing on where the player WAS is what makes backing out of
    // reach a real answer.
    if (flat > C.biteReach + C.biteSlack
      || Math.abs(target.y - b.head.y) > C.biteVertical + 2) {
      bus.emit("biteMiss", { x: b.head.x, z: b.head.z });
      return;
    }
    combat.hurtPlayer(C.biteDamage * SURVIVAL_CONFIG.enemyDamageMultiplier
      * (Number.isFinite(inst.damageScale) ? inst.damageScale : 1), {
      source: "coulter-bite",
      x: b.head.x, y: b.head.y, z: b.head.z, enemy: inst.key,
    });
    ctx.player.punch?.(1.35);
  }

  /** Throw the clutch of globules the sacs have been filling for. */
  function launchSpew(inst) {
    const b = inst.body;
    const aim = b.aim || headTarget(inst);
    // Out of the mouth, not out of the origin: the mouth is 1.5m in
    // front of the head joint and it is where the player is looking.
    const cp = Math.cos(b.pitch);
    const size = bodyScale(inst);
    const mouth = 1.5 * size;
    const mx = b.head.x + Math.sin(b.heading) * cp * mouth;
    const my = b.head.y + Math.sin(b.pitch) * mouth;
    const mz = b.head.z + Math.cos(b.heading) * cp * mouth;
    const count = C.spewGlobules;
    for (let i = 0; i < count; i += 1) {
      const spread = count > 1 ? (i / (count - 1) - 0.5) * 2 : 0;
      const tx = aim.x + spread * 3.6 * Math.sqrt(size);
      const tz = aim.z + spread * 2.4 * Math.sqrt(size);
      const v = ballistic(mx, my, mz, tx, aim.y, tz, C.spewSpeed);
      launchGlobule(mx, my, mz,
        v.x + (Math.random() - 0.5) * C.spewSpread * C.spewSpeed,
        v.y + (Math.random() - 0.5) * C.spewSpread * C.spewSpeed,
        v.z + (Math.random() - 0.5) * C.spewSpread * C.spewSpeed,
        (0.85 + Math.random() * 0.4) * Math.sqrt(size));
    }
    ctx.vfx?.venomBurst?.(mx, my, mz, 1.5 * Math.sqrt(size));
    bus.emit("spew", { x: mx, y: my, z: mz, id: inst.id, count });
  }

  /**
   * A lobbed solution, falling back to a flat one.
   *
   * The low-arc root of the ballistic equation, because a mortar arc
   * over a nine-metre-tall animal takes three seconds to arrive and
   * the player has walked out of it. When the target is out of range
   * for any arc the shot is thrown flat and short, which reads as the
   * animal trying and failing rather than as it declining to fire.
   */
  function ballistic(x, y, z, tx, ty, tz, speed) {
    const dx = tx - x;
    const dz = tz - z;
    const flat = Math.hypot(dx, dz) || 1e-4;
    const dy = ty - y;
    const g = 22;
    const s2 = speed * speed;
    const root = s2 * s2 - g * (g * flat * flat + 2 * dy * s2);
    const ux = dx / flat;
    const uz = dz / flat;
    if (root < 0) {
      const pitch = 0.42;
      return {
        x: ux * Math.cos(pitch) * speed,
        y: Math.sin(pitch) * speed,
        z: uz * Math.cos(pitch) * speed,
      };
    }
    const angle = Math.atan2(s2 - Math.sqrt(root), g * flat);
    const horizontal = Math.cos(angle) * speed;
    return { x: ux * horizontal, y: Math.sin(angle) * speed, z: uz * horizontal };
  }

  function stepDive(inst, dt, target) {
    const b = inst.body;
    b.mawOpen = 0;
    const dx = target.x - b.head.x;
    const dz = target.z - b.head.z;
    b.heading = dampAngle(b.heading, Math.atan2(dx, dz), C.turnRate.dive, dt);
    b.pitch = damp(b.pitch, -0.92, 3.2, dt);
    travel(inst, dt, C.diveSpeed);
    b.timer -= dt;

    const surface = groundAt(b.head.x, b.head.z);
    const under = surface - b.head.y;
    if (under > C.diveDepth && submergedFully(inst)) {
      b.hidden = true;
      setPhase(inst, "burrow", huntSeconds(inst));
    } else if (b.timer <= 0) {
      // Failsafe: a dive that cannot finish - wedged against masonry,
      // or driven into a ceiling - must not strand the boss half out
      // of the ground where it can be shot with impunity.
      b.head.y = surface - C.diveDepth - 1;
      b.hidden = true;
      setPhase(inst, "burrow", huntSeconds(inst));
    } else {
      b.hidden = submergedFully(inst);
    }
  }

  /**
   * Going limp.
   *
   * The clips deliberately do not own the body - see the Blender
   * script - so this is what death looks like: the trail itself falls.
   * Each sample sinks toward the sand under it, which drops whatever
   * arc the animal happened to be in at the moment it died instead of
   * snapping it back to a straight bind pose first. A twenty-five
   * metre body reared eight metres out of the ground has to be able to
   * FALL, and nothing baked can do that.
   */
  function stepDeath(inst, dt) {
    const b = inst.body;
    if (!b.trail.length) return;
    if (b.phase !== "dead") {
      b.phase = "dead";
      b.timer = 0;
      b.hidden = false;
      b.mawOpen = 0.8;
      hideWake(inst);
      /* A DEATH IS A PHYSICAL EVENT, and the collapse below is only
         the geometry of one. What makes it read is what it leaves: the
         animal opens along its length, the venom it was holding goes
         onto the sand as real pools with the real hazard behind them,
         and the ground says so once. */
      const size = bodyScale(inst);
      ctx.player?.punch?.(1.8);
      ctx.vfx?.venomBurst?.(b.head.x, b.head.y, b.head.z, 4.2 * Math.sqrt(size));
      const sampled = b.trail.filter((s, i) => i % 6 === 0).slice(0, 4);
      for (const s of sampled) {
        ctx.vfx?.sandSpray?.(s.x, groundAt(s.x, s.z) + 0.5, s.z,
          2.0 * Math.sqrt(size), Math.sin(b.heading), Math.cos(b.heading));
        spillPool(s.x, s.z, C.poolRadius * (1.1 + Math.random() * 0.5),
          C.poolSeconds * 1.6);
      }
      bus.emit("died", { x: b.head.x, y: b.head.y, z: b.head.z, id: inst.id });
    }
    b.timer += dt;
    const settle = Math.min(1, b.timer * 0.5);
    for (const sample of b.trail) {
      const rest = groundAt(sample.x, sample.z) + 0.55;
      if (sample.y > rest) {
        sample.y = damp(sample.y, rest, 1.1 + settle * 2.2, dt);
      } else {
        // And then it sinks. The sand takes it back, slowly, which is
        // also how the corpse leaves without being deleted on screen.
        sample.y = damp(sample.y, rest - 2.4, 0.16, dt);
      }
    }
    b.head.set(b.trail[0].x, b.trail[0].y, b.trail[0].z);
    b.prev.copy(b.head);
    b.pitch = damp(b.pitch, -0.15, 0.8, dt);
    const cp = Math.cos(b.pitch);
    b.dir.set(Math.sin(b.heading) * cp, Math.sin(b.pitch), Math.cos(b.heading) * cp);
    enemies.poseBody(inst);
  }

  /* ============================================================
     PER-FRAME
     ============================================================ */

  function stepInstance(inst, dt) {
    const b = inst.body;
    if (!b) return;
    /* Before anything decides anything: the first frame this module
       sees a burrower is the frame it stops wearing the shared caste
       material. */
    adoptSkin(inst);
    /* Parked: the pose is still resolved from the trail, but nothing
       decides anything. Set only by review harnesses, which need the
       animal to hold a pose for a photograph - a boss that swims out of
       frame between two camera moves cannot be reviewed. */
    if (b.parked) {
      layTrail(inst);
      enemies.poseBody(inst);
      // Both still answered honestly, or a parked animal keeps whatever
      // it had when it stopped: spawned underground it stays flagged as
      // buried and renders as nothing at all, and its wake stays sitting
      // on the sand somewhere it no longer is.
      b.hidden = submergedFully(inst);
      updateWake(inst, dt);
      updateSkin(inst, dt);
      updateCollar(inst, dt);
      return;
    }
    if (inst.state === "death") {
      stepDeath(inst, dt);
      updateSkin(inst, dt);
      updateCollar(inst, dt);
      return;
    }
    if (inst.stunTime > 0) {
      /* A slam can stagger it, and while it is staggered it holds
         position - but it does NOT hold its breath: a stunned animal
         underground would otherwise be a boss the player can freeze
         out of the fight entirely by timing a slam on the wake. */
      inst.stunTime = Math.max(0, inst.stunTime - dt);
      if (b.phase === "crest") {
        b.timer = Math.max(b.timer, 0.6);
        enemies.poseBody(inst);
        applyFlinch(inst, dt);
        updateSkin(inst, dt);
        updateCollar(inst, dt);
        return;
      }
    }

    const target = headTarget(inst);
    if (b.phase === "rise") stepRise(inst, dt, target);
    else if (b.phase === "crest") stepCrest(inst, dt, target);
    else if (b.phase === "dive") stepDive(inst, dt, target);
    else stepBurrow(inst, dt, target);

    /* Where the walkers keep their (x, z). Combat's hit capsules, the
       HUD's mini-map and the stow-the-weapon threat check all read
       those fields on every enemy, so the burrower keeps them honest by
       mirroring its head into them rather than by every one of those
       systems learning what a body chain is. */
    inst.x = b.head.x;
    inst.z = b.head.z;
    inst.y = b.head.y;
    inst.yaw = b.heading;
    inst.alerted = true;
    inst.suspicion = 1;
    layTrail(inst);
    enemies.poseBody(inst);
    /* After the pose, because it is an offset ON the pose: poseBody
       rewrites every joint from the trail, so a flinch applied before
       it is a flinch that was thrown away. */
    applyFlinch(inst, dt);
    updateWake(inst, dt);
    updateSkin(inst, dt);
    updateCollar(inst, dt);
  }

  /** Ground height across a section, from the three samples cached
   *  when the node was laid. Interpolating three points is the whole
   *  reason a node caches them: a fourteen-metre-wide rib needs its
   *  shoulders on the sand under the shoulders, and doing that with
   *  live lookups is seven height queries per rib per frame - two
   *  hundred a frame for a shape that has not moved.
   *
   *  Scalars in rather than the node, because this runs two hundred
   *  times a frame and a destructured argument object is two hundred
   *  allocations a frame. */
  function wakeGround(gy, gl, gr, t) {
    return t < 0 ? lerp(gy, gl, -t) : lerp(gy, gr, t);
  }

  /** Lay one cross section down at the animal's current crossing. */
  function pushWakeNode(rig, x, z, heading, power) {
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading);
    const half = rig.half;
    rig.nodes.unshift({
      x, z, rx, rz, power,
      t: atmos.elapsed,
      gy: groundAt(x, z),
      gl: groundAt(x - rx * half, z - rz * half),
      gr: groundAt(x + rx * half, z + rz * half),
      seed: Math.random() * TAU,
    });
    if (rig.nodes.length > WAKE_NODES) rig.nodes.length = WAKE_NODES;
  }

  function updateWake(inst, dt) {
    const b = inst.body;
    const rig = wakeFor(inst);
    const surface = groundAt(b.head.x, b.head.z);
    const depth = surface - b.head.y;
    // Only while it is shallow enough to be pushing sand up. Deeper
    // than this and the ridge would be a lie.
    const size = bodyScale(inst);
    const showing = b.phase !== "dead" && depth > 0.4 && depth < 9.5 * size;
    /* The furrow is HALF the animal's own beam plus its shoulders, not
       four times it. Scaling this off `size` the way the old ellipsoid
       did gave a ridge twenty-eight metres across and one metre proud,
       which is not a ridge, it is a hillside. */
    rig.half = 3.6 + size * 1.25;
    if (!showing) {
      if (rig.mesh.visible) rig.mesh.visible = false;
      /* And the path is FORGOTTEN, not paused. A dive and a breach
         forty metres away are a different furrow; keeping the nodes
         would draw one ridge with a corner in it joining the two. */
      if (rig.nodes.length) rig.nodes.length = 0;
      rig.lastX = 1e9;
      rig.lastZ = 1e9;
      return;
    }
    const strength = clamp01((9.5 * size - depth) / (6.5 * size));

    /* ---- lay the path ----
       Nodes are dropped by DISTANCE TRAVELLED, not by time, so a
       Coulter that slows down leaves a denser furrow rather than a
       shorter one - and a parked one (the review harnesses park it)
       stops extending its own wake instead of piling thirty sections
       on the same spot. */
    if (rig.lastX > 1e8) {
      rig.lastX = b.head.x;
      rig.lastZ = b.head.z;
      pushWakeNode(rig, b.head.x, b.head.z, b.heading, strength);
    }
    let moved = Math.hypot(b.head.x - rig.lastX, b.head.z - rig.lastZ);
    if (moved > WAKE_STEP * 12) {
      // Teleported (a QA re-seed, a phase forced by a harness): start
      // a new furrow rather than drawing a line across the map.
      rig.nodes.length = 0;
      rig.lastX = b.head.x;
      rig.lastZ = b.head.z;
      pushWakeNode(rig, b.head.x, b.head.z, b.heading, strength);
      moved = 0;
    }
    while (moved >= WAKE_STEP) {
      const t = WAKE_STEP / moved;
      rig.lastX += (b.head.x - rig.lastX) * t;
      rig.lastZ += (b.head.z - rig.lastZ) * t;
      pushWakeNode(rig, rig.lastX, rig.lastZ, b.heading, strength);
      moved = Math.hypot(b.head.x - rig.lastX, b.head.z - rig.lastZ);
    }

    /* ---- build the ribbon ----
       Front to back: two prow ribs projected ahead of the head, then
       the laid path. Every rib is rebuilt every frame because every
       rib is a different age this frame from last, and that ageing IS
       the effect. */
    const now = atmos.elapsed;
    const pos = rig.geo.attributes.position.array;
    const col = rig.geo.attributes.color.array;
    const crestBase = (0.72 + strength * 0.62) * (0.55 + size * 0.34);
    const sx = Math.sin(b.heading);
    const sz = Math.cos(b.heading);
    const rx = Math.cos(b.heading);
    const rz = -Math.sin(b.heading);
    const half = rig.half;
    let v = 0;
    const count = rig.nodes.length;
    for (let r = 0; r < WAKE_RIB; r += 1) {
      let cx; let cz; let nrx; let nrz;
      let gy; let gl; let gr;
      let crest; let dome; let boil; let spread; let seed; let fade;
      if (r < WAKE_PROW) {
        /* THE BOW WAVE. Ahead of the mouth, low and narrowing to
           nothing: the sand there is lifting, not yet displaced. */
        const ahead = (WAKE_PROW - r) * (2.4 + size * 0.55);
        cx = b.head.x + sx * ahead;
        cz = b.head.z + sz * ahead;
        nrx = rx; nrz = rz;
        gy = groundAt(cx, cz);
        gl = gy; gr = gy;
        const taper = r === 0 ? 0.16 : 0.55;
        crest = crestBase * taper;
        dome = 1;
        boil = 1;
        spread = 0.45 + r * 0.24;
        seed = now * 2.0;
        fade = taper;
      } else {
        const i = Math.min(count - 1, r - WAKE_PROW);
        const node = rig.nodes[i] || rig.nodes[count - 1];
        if (!node) break;
        cx = node.x; cz = node.z;
        nrx = node.rx; nrz = node.rz;
        gy = node.gy; gl = node.gl; gr = node.gr;
        const age = now - node.t;
        /* THE SLUMP, and it is the whole point of the rebuild. Sand
           heaped past its angle of repose falls back, fast at first
           and then hardly at all, so what is left after a few seconds
           is a shallow scar rather than a ridge. An exponential toward
           a residual is exactly that curve, and it is also what makes
           the tail of the furrow disappear on its own without a
           lifetime test anywhere. */
        const slump = 0.24 + 0.76 * Math.exp(-age * 0.62);
        crest = crestBase * node.power * slump;
        /* Directly over the animal the groove is FILLED - the ground
           there is still being lifted from underneath - and behind it
           the middle drops out into a trench. This morph is what the
           eye reads as the sand moving, rather than as a solid shape
           being dragged. */
        dome = Math.exp(-age * 1.9);
        boil = Math.exp(-age * 1.5);
        // Slumped sand spreads as it falls: wider and lower together.
        spread = 1 + 0.26 * (1 - slump);
        seed = node.seed + now * 5.5;
        fade = slump;
        /* The last two ribs run out to nothing, or a furrow that is
           still a furrow at the ring buffer's end terminates in a
           wall wherever the buffer happens to be full. */
        const fromEnd = count - 1 - i;
        if (count >= WAKE_NODES && fromEnd < 2) {
          const t = (fromEnd + 0.35) / 2;
          crest *= t;
          fade *= t;
        }
      }
      for (let c = 0; c < WAKE_ACROSS; c += 1) {
        const sec = WAKE_SECTION[c];
        const hf = sec[1];
        const t = sec[0] * spread;
        /* THE BOIL. A crest extruded cleanly along a path is a pipe;
           real turned sand has lumps in it, and they are only near the
           head because that is the only part still being disturbed. */
        const wob = 1 + 0.22 * boil * Math.sin(seed + c * 1.9)
          + 0.11 * boil * Math.sin(seed * 1.7 - c * 3.1);
        // The centre of the profile lifts toward a dome over the animal.
        const shaped = c === 3 ? lerp(hf, 1.16, dome) : hf;
        const px = cx + nrx * t * half;
        const pz = cz + nrz * t * half;
        pos[v * 3] = px;
        pos[v * 3 + 1] = wakeGround(gy, gl, gr, t)
          + crest * shaped * (hf > 0 ? wob : 1) + 0.06;
        pos[v * 3 + 2] = pz;
        /* Shade toward plain sand as the furrow settles: a groove that
           keeps its contact shadow after the groove has gone is a
           painted stripe left lying on the dune. */
        const k = lerp(1, sec[2], fade);
        col[v * 3] = k;
        col[v * 3 + 1] = k;
        col[v * 3 + 2] = k;
        v += 1;
      }
    }
    // Any rib the path has not reached yet collapses onto the last one
    // written, so the strip is degenerate rather than folded through
    // the origin.
    for (let k = v; k < WAKE_VERTS; k += 1) {
      const src = v - WAKE_ACROSS + (k % WAKE_ACROSS);
      pos[k * 3] = pos[src * 3];
      pos[k * 3 + 1] = pos[src * 3 + 1];
      pos[k * 3 + 2] = pos[src * 3 + 2];
      col[k * 3] = 1; col[k * 3 + 1] = 1; col[k * 3 + 2] = 1;
    }
    rig.geo.attributes.position.needsUpdate = true;
    rig.geo.attributes.color.needsUpdate = true;
    rig.geo.computeVertexNormals();
    rig.mesh.visible = true;

    /* The wake's own voice, on its own clock. A shallow Coulter is
       audible before it is visible and from any direction, which is
       what makes the submerged phase playable for a player who happens
       to be facing the wrong way when it starts. */
    rig.rumble -= dt;
    if (rig.rumble <= 0) {
      rig.rumble = 0.62;
      bus.emit("wake", {
        x: b.head.x, z: b.head.z, strength: 0.35 + strength * 0.65, id: inst.id,
      });
    }

    /* THE SCAR IT LEAVES. The furrow says where the animal is and
       where it has been for the last few seconds; the decal says
       where it has been since, which is the half of the read that
       outlives the slump. It rides the shared ground-decal pool, so a
       hundred metres of furrow costs no draw call of its own. */
    if (Math.hypot(b.head.x - rig.markX, b.head.z - rig.markZ) > 3.2 * size) {
      rig.markX = b.head.x;
      rig.markZ = b.head.z;
      ctx.vfx?.skidMark?.(b.head.x, b.head.z, b.heading,
        0.55 + strength * 0.45, 4.2 * size);
    }

    rig.spray -= dt;
    if (rig.spray > 0) return;
    rig.spray = 0.085;
    /* THE SPRAY IS THE READ, and it is the half of this that survives
       distance. A metre-high ridge is a few pixels tall at sixty metres
       and the player is not looking at the ground; a moving smudge of
       dust is a shape that carries to the horizon.

       THROWN SIDEWAYS. Sand forced out of a bore leaves at the lip of
       the furrow, perpendicular to travel and only a little forward -
       it does not fountain along the heading, and thrown that way it
       reads as a jet coming out of a nozzle. One lip, then the other,
       alternating, so the two sides never fire together and freeze
       into a symmetrical arch. */
    const power = (0.85 + strength * 1.15) * Math.sqrt(size);
    rig.side = -(rig.side || 1);
    const lipX = b.head.x + rx * rig.side * half * 0.62 + sx * 2.0;
    const lipZ = b.head.z + rz * rig.side * half * 0.62 + sz * 2.0;
    const lipY = groundAt(lipX, lipZ);
    ctx.vfx?.sandSpray?.(lipX, lipY + 0.22, lipZ, power,
      rx * rig.side * 0.86 + sx * 0.5, rz * rig.side * 0.86 + sz * 0.5);
    /* And a little of it OVER the crest and backward, which is the
       part that hangs in the air behind and gives the furrow a tail
       when the ridge itself has already slumped. */
    ctx.vfx?.sandSpray?.(b.head.x - sx * 3.4, groundAt(
      b.head.x - sx * 3.4, b.head.z - sz * 3.4) + 0.45, b.head.z - sz * 3.4,
      power * 0.66, -sx * 0.4, -sz * 0.4);
  }

  function updateGlobules(dt) {
    const ps = ctx.player?.state;
    for (const g of globules) {
      if (!g.live) continue;
      g.life -= dt;
      const px = g.x;
      const py = g.y;
      const pz = g.z;
      g.vy -= 22 * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      g.mesh.position.set(g.x, g.y, g.z);
      g.mesh.rotation.x += g.spin * dt;
      g.mesh.rotation.z += g.spin * 0.7 * dt;

      let hit = null;
      const step = Math.hypot(g.x - px, g.y - py, g.z - pz);
      /* Masonry, and the nave is full of it. A globule that sails
         through a wall makes cover meaningless against the one attack
         cover is supposed to answer. */
      if (step > 1e-4 && ctx.collide?.rayBlock) {
        const blocked = ctx.collide.rayBlock(px, py, pz,
          (g.x - px) / step, (g.y - py) / step, (g.z - pz) / step, step);
        if (blocked < step) {
          hit = {
            x: px + ((g.x - px) / step) * blocked,
            y: py + ((g.y - py) / step) * blocked,
            z: pz + ((g.z - pz) / step) * blocked,
            direct: false,
          };
        }
      }
      if (!hit && ps && !ctx.combat?.player?.dead) {
        const dx = g.x - ps.x;
        const dz = g.z - ps.z;
        const dy = g.y - (ps.y + 1.0);
        if (dx * dx + dz * dz < 1.9 * 1.9 && Math.abs(dy) < 1.5) {
          hit = { x: g.x, y: g.y, z: g.z, direct: true };
        }
      }
      if (!hit && g.y <= groundAt(g.x, g.z) + 0.2) {
        hit = { x: g.x, y: groundAt(g.x, g.z), z: g.z, direct: false };
      }
      if (hit) {
        g.live = false;
        g.mesh.visible = false;
        splash(hit.x, hit.y, hit.z, hit.direct);
        continue;
      }
      if (g.life <= 0) {
        g.live = false;
        g.mesh.visible = false;
      }
    }
  }

  function updatePools(dt) {
    for (const pool of pools) {
      if (pool.life <= 0) {
        if (pool.mesh.visible) pool.mesh.visible = false;
        continue;
      }
      pool.life -= dt;
      if (pool.life <= 0) {
        pool.mesh.visible = false;
        pool.mat.uniforms.uFade.value = 0;
        continue;
      }
      const t = pool.life / pool.span;
      // Swells for the first fifth, then thins for the rest of its
      // life: a hazard that vanishes at full brightness cannot be
      // timed, and timing it is the skill.
      const fade = t > 0.8 ? clamp01((1 - t) / 0.2) : clamp01(t / 0.8) ** 0.7;
      pool.mat.uniforms.uFade.value = fade;
      pool.mat.uniforms.uTime.value = atmos.elapsed;
      pool.gas -= dt;
      if (pool.gas > 0) continue;
      pool.gas = 0.34;
      ctx.vfx?.venomGas?.(pool.x, pool.y + 0.2, pool.z, pool.radius * 0.8,
        fade * 1.1);
    }
  }

  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    const ps = ctx.player?.state;
    for (const inst of enemies.live) {
      if (!inst.body) continue;
      if (inst.encounterHidden || (inst.encounterLocked && !inst.coulterReveal)) {
        hideWake(inst);
        if (inst.root) inst.root.visible = !inst.encounterHidden;
        continue;
      }
      if (ps) {
        const far = (inst.x - ps.x) ** 2 + (inst.z - ps.z) ** 2
          > C.simRange * C.simRange;
        if (far && inst.state !== "death") continue;
      }
      stepInstance(inst, d);
    }
    // Wakes for anything that has gone.
    if (wakes.size) {
      for (const id of [...wakes.keys()]) {
        if (!enemies.live.some((inst) => inst.id === id)) disposeWake(id);
      }
    }
    updateGlobules(d);
    updatePools(d);
    updateToxin(d);
  }

  /* ============================================================
     STATE
     ============================================================ */

  function status() {
    const live = enemies.live.filter((inst) => inst.body && inst.state !== "death");
    const inst = live[0] || null;
    return {
      live: live.length,
      phase: inst ? inst.body.phase : null,
      timer: inst ? Number(inst.body.timer.toFixed(2)) : 0,
      submerged: inst ? !!inst.body.hidden : false,
      surfacings: inst ? inst.body.surfacings : 0,
      mawOpen: inst ? Number(inst.body.mawOpen.toFixed(3)) : 0,
      depth: inst
        ? Number((groundAt(inst.body.head.x, inst.body.head.z) - inst.body.head.y).toFixed(2))
        : 0,
      health: inst ? Math.max(0, Math.round(inst.health)) : 0,
      maxHealth: inst ? Math.round(inst.maxHealth) : 0,
      toxin: Number(toxin.level.toFixed(3)),
      inVenom: toxin.inPool,
      /* The skin, so a harness can assert the crust sheets off and the
         sacs fill rather than photographing it and hoping. */
      sand: Number(skin.sand.toFixed(3)),
      wet: Number(skin.wet.toFixed(3)),
      venomFill: Number(skin.fill.toFixed(3)),
      skinDamage: Number(skin.damage.toFixed(3)),
      collar: collar.visible,
      pools: pools.filter((p) => p.life > 0).length,
      globules: globules.filter((g) => g.live).length,
    };
  }

  function snapshot() {
    // Pools and globules are deliberately NOT persisted. They are
    // seconds-long consequences of an attack, and restoring a save
    // into a cloud of venom the player never saw thrown is worse than
    // losing it.
    return { toxin: Number(toxin.level.toFixed(4)) };
  }

  function restore(saved = {}) {
    toxin.level = clamp01(Number(saved.toxin) || 0);
    toxin.tick = 0;
    clearHazards();
    return true;
  }

  function clearHazards() {
    for (const pool of pools) {
      pool.life = 0;
      pool.mesh.visible = false;
      pool.mat.uniforms.uFade.value = 0;
    }
    for (const g of globules) {
      g.live = false;
      g.mesh.visible = false;
    }
  }

  return {
    bus,
    config: C,
    group,
    update,
    status,
    snapshot,
    restore,
    clearHazards,
    spillPool,
    beginReveal(inst) {
      if (!inst) return false;
      inst.coulterReveal = true;
      return beginRise(inst, headTarget(), false);
    },
    /** True while the animal cannot be touched, and the reason the
     *  fight has a rhythm. Read by combat's every damage path. */
    submerged(inst) { return !!(inst && inst.body && inst.body.hidden); },
    toxinLevel() { return toxin.level; },
    setToxin(v) { toxin.level = clamp01(Number(v) || 0); return toxin.level; },
    dispose() {
      for (const id of [...wakes.keys()]) disposeWake(id);
      if (offDamaged) offDamaged();
      scene.remove(group);
    },
  };
}
