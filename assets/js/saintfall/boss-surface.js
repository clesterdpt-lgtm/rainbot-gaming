/* ============================================================
   SAINTFALL - shared creature surface kit

   THE PROBLEM THIS FILE EXISTS FOR.

   Every boss .glb in `assets/models/saintfall/` carries POSITION,
   NORMAL, COLOR_0, JOINTS_0, WEIGHTS_0 and nothing else. No UVs, no
   textures, not one image. So a boss is a flat-shaded vertex-colour
   solid: one value per facet, no specular travel, no grain, no
   cavity, and a value range about a stop and a half wide. Photograph
   the Stylite next to a 2001 Hunter and the Hunter wins on surface
   alone - mottled plate, a wet sheen rolling across the armour as it
   turns, near-black creases and blown highlights in the same frame.
   Triangle count is not the gap. Surface is.

   This closes it entirely in the fragment shader, in OBJECT SPACE,
   with no UV unwrap and no re-export.

   FIVE DECISIONS, AND THE TRAPS BEHIND THEM.

   1. OBJECT SPACE, NOT WORLD SPACE. A world-space field swims across
      a skinned creature - the vertices move through it, so the grain
      slides over the plate as the animal walks and reads instantly as
      a projected pattern. The raw `position` attribute is the bind
      pose and does not move, so the grain is glued to the shell.
      That costs one varying and nothing else.

   1b. OBJECT DIRECTION, WORLD FREQUENCY - and this is a correction,
      not a design. The field's DIRECTION has to come from object
      space for the reason above. Its FREQUENCY must not: a material
      is a constant number of cells per WORLD METRE, so a big plate
      shows more cells than a small one and that is the whole
      difference between a material and a bitmap.

      The kit used to bake the frequency into `uSfGrain.x` from a
      per-material `scale` option, and a critic reading blind named
      the result exactly: "the tiled hatch runs at the same texel
      scale on the big plates and the small ones, so they read as
      instances of one bitmap, not as one material at different
      sizes", and "the squiggle appears at three different scales on
      three limbs of the same creature". Both, at once, from one
      cause - a per-MATERIAL number cannot describe a per-NODE fact.

      Measured in the built scene before the change, world cell size
      on one animal:

        Stylite   body plate  nodeScale 1.700 -> 0.780 m cells
        Stylite   crown bone  nodeScale 2.076 -> 0.953 m cells
                  (same authored wavelength, 22% apart on one boss)

        one shared caste material, 37 meshes, node scales 0.26..1.60
                  -> 0.253 m .. 1.553 m cells.  6.14x, inside ONE
                  material, which no per-material uniform can ever fix
                  because the instances differ and the material does
                  not.

      So the scale now comes off the object-to-world matrix in the
      VERTEX shader, where it is per-draw and free, and `uSfGrain.x`
      is simply TAU / wavelength in metres. Three `length()` calls per
      vertex; nothing added to the fragment shader, which is the half
      that is fill-bound. The bind pose is still what is sampled - a
      constant matrix times a constant attribute is still constant -
      so the grain stays glued and nothing swims.

      Two consequences worth knowing. Animated bone scale is ignored
      by construction, which is correct: a squashing limb should not
      breathe its own pores. And a caste material shared by forty
      instances at forty sizes now grains all forty correctly, which
      it could not do at all before.

      AND ONE COST, PAID KNOWINGLY. Anything that animates a NODE's
      scale now animates its grain with it. In SAINTFALL that is the
      emergence tween in `enemies.js`, which ramps a spawning enemy
      from 0.68 to 1.0 over 1.2 s, so its cells drift by a third
      across that beat. The old baked number was better for exactly
      those 1.2 seconds - a fixed object-space frequency scales up
      with the model and stays glued - and wrong for the rest of the
      fight, on every boss, forever. The tween also happens inside its
      own dust breach. Take the trade; do not "fix" it by going back.
      If some future thing scales a node slowly and in plain sight,
      the answer is to scale the GEOMETRY once at build time, not to
      re-bake the frequency.

   2. ANALYTIC, NOT HASH NOISE, and this is the one place where the
      obvious answer is the wrong one. A hash/value-noise field cannot
      antialias itself: it has no mips, its screen derivative is a
      finite difference of an already-aliased signal, and guarding it
      with `fwidth` of that same signal does not help. This project
      has already recorded that failure once - see the aeolian ripple
      note in `art.js`, which is why the dunes are sine trains with a
      KNOWN PHASE whose screen footprint is exact. Same reasoning
      here, one dimension up.

   3. ONE TRIG EVALUATION, FOUR OCTAVES. The obvious way to get four
      scales of detail is four sets of sines, which is twenty-four
      transcendentals per pixel, and a twelve-tap shader does not ship
      on a frame that is already GPU fill-bound. Instead the octaves
      are chained through the TRIPLE-ANGLE IDENTITIES

          sin 3x = s(3 - 4s^2)        cos 3x = c(4c^2 - 3)

      so one `sin(q)` and one `cos(q)` produce lambda, lambda/3,
      lambda/9 and lambda/27 in multiply-adds alone. It also hands us
      exact antialiasing for free: octave N's screen footprint is
      3^N times the base octave's, so one `fwidth` covers all four.
      Per pixel: SIX transcendentals, FOUR screen derivatives, ZERO
      texture fetches - and all of it behind one distance branch that
      is coherent across a quad because it is keyed on camera range.

   4. THE RELIEF IS ALSO THE CAVITY. There is no curvature attribute
      on these models and none can be derived: flat shading makes the
      shading normal piecewise CONSTANT, so the screen derivative of
      it is zero everywhere inside a facet and a one-pixel spike on
      the boundary. A curvature proxy built that way draws a
      WIREFRAME, not a cavity. The height field we already computed
      for the bump is the cavity source instead - troughs darken,
      crests lighten and desaturate - which also means the darkening
      and the bump agree by construction rather than by tuning.
      COLOR_0 stays what it already is: the authored material mask
      (RGB) and the bioluminescence mask (alpha, owned by `art.js`).

   WHAT IT MUST NOT DO. It must not smooth the faceting. "Everything
   in SAINTFALL above the sand is faceted, and a smooth-shaded enemy
   reads as belonging to another game" (`enemies.js`). Every octave
   here is SUB-FACET: the coarsest is roughly a metre and only tints
   albedo and roughness, and the two that touch the normal are 13cm
   and 4cm. The facet's own value step stays the dominant read.

   HOW IT COMPOSES WITH art.js. `patchMaterial` is the only door into
   a material - a material that skips it has no aerial perspective and
   reads as a sticker at range. It also OVERWRITES
   `customProgramCacheKey` and early-returns on `userData.sfPatched`,
   so bolting a second `onBeforeCompile` on afterwards silently
   detaches the atmosphere's cache key and two variants end up sharing
   one compiled program. So this kit does not chain onto the patch,
   it goes THROUGH it: `patchMaterial` grew an `extend` hook that runs
   last inside its own compile, and an `extendKey` that is folded into
   its cache key. One material, one `onBeforeCompile`, one key.

   USAGE - one line, replacing the material's `patchMaterial` call:

     applySurface(shellMat, atmos, "chitin", { rim: 0.42, bio: 1.5 });

   ============================================================ */

import { TAU, clamp01 } from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";

/* ============================================================
   MATERIAL FAMILIES

   The point of the table is that DIFFERENT PARTS OF ONE BOSS READ AS
   DIFFERENT MATERIALS. Today every part of every boss reads as the
   same matte plastic, and that is most of why they read as a
   prototype: a Hunter has plate, hide and exposed worm flesh in one
   silhouette and you can tell them apart with the colour removed.

   `roughness` and `metalness` here are ADVISORY and are not written
   onto the material unless the caller asks (`adopt: true`). Every
   boss module's roughness carries a recorded reason in its own header
   - the Garner's collar, the Abbess's sac, the Stylite's shell were
   each measured and argued for - and a kit that quietly overwrote
   them would undo that work invisibly. The kit supplies the
   MODULATION; the module keeps its authored centre value.

   Amplitudes are in METRES of relief. Slope is amplitude times
   wavenumber, so the numbers below land between four and eight
   degrees of tilt - enough for a thirteen-degree sun to rake across
   and far too little to disturb a silhouette. They were twice this
   at first and a close-up of the Distaff's legs came back looking
   like braided rope: a cell field wrapped around a thirty-centimetre
   cylinder reads as cord long before it reads as chitin, so the
   ceiling on this number is set by the THINNEST limb on the animal,
   not by the widest plate.

   Those degrees of tilt only became TRUE with decision 1b. Slope is
   amplitude times wavenumber, and the wavenumber used to be per
   material and per node scale, so the Stylite's crown was carrying
   22% less relief than its own body from nothing but a node
   transform. Every number below is now the number the surface
   actually gets, everywhere on every animal.
   ============================================================ */

/** @typedef {{
 *   wavelength: number, score: number, pore: number, cavity: number,
 *   gloss: number, sheen: number, glint: number, wear: number, mottle: number,
 *   ember: number, fadeNear: number, fadeFar: number,
 *   roughness: number, metalness: number, note: string }} SurfaceFamily */

/** @type {Record<string, SurfaceFamily>} */
export const SURFACES = {
  /* Hard insect plate. Tight pores, a strong crease, and a small
     METALNESS lift on the crests - which is the whole trick behind
     the Hunter's violet sheen. A dielectric specular is white and
     sits at F0 0.04; past a little metalness the albedo becomes the
     specular colour, so a violet plate throws a violet highlight
     instead of a white one. Kept far below 0.3: art.js already
     records twice that above ~0.6 the diffuse term vanishes and the
     surface renders as a blurred reflection of the sky. */
  chitin: {
    wavelength: 1.15, score: 0.0022, pore: 0.0008, cavity: 0.36,
    gloss: 0.22, sheen: 0.08, glint: 0.60, wear: 0.10, mottle: 0.15,
    ember: 0.45, fadeNear: 46, fadeFar: 108,
    roughness: 0.46, metalness: 0.10,
    note: "carapace plate - glossy, pored, violet-sheened",
  },

  /* Bone is CHALKY, and chalk is the absence of gloss travel, not the
     presence of roughness. So: the widest cavity in the table and the
     narrowest gloss spread. Wear is the highest, because a rubbed
     bone edge goes pale and desaturated and that is the single most
     legible "this is old" cue at forty metres. */
  bone: {
    wavelength: 0.85, score: 0.0018, pore: 0.0011, cavity: 0.42,
    gloss: 0.09, sheen: 0.02, glint: 0.10, wear: 0.16, mottle: 0.13,
    ember: 0.18, fadeNear: 42, fadeFar: 98,
    roughness: 0.86, metalness: 0.0,
    note: "porous bone and beak - chalky, no specular travel",
  },

  /* Membrane and wet muscle. Coarse and almost smooth: the relief is
     nearly all in the metre-scale mottle, because a swollen sac with
     fine grain on it stops being wet. The gloss spread is the WIDEST
     in the table for the same reason - what says wet is a highlight
     that moves, not a highlight that is bright. */
  membrane: {
    wavelength: 2.4, score: 0.0010, pore: 0.0002, cavity: 0.24,
    gloss: 0.22, sheen: 0.0, glint: 0.95, wear: 0.04, mottle: 0.15,
    ember: 0.70, fadeNear: 40, fadeFar: 92,
    roughness: 0.42, metalness: 0.0,
    note: "sac, gland and wet muscle - broad, wet, almost ungrained",
  },

  /* Corroded bronze. A patina is a mineral CRUST over metal, so the
     mottle drives metalness hard in both directions: the crust reads
     dielectric and the rubbed high points read as bare metal. That is
     the one family where `sheen` is doing structural work rather than
     polish. Coarsest relief in the table, because corrosion pits are
     centimetres, not millimetres. */
  bronze: {
    wavelength: 1.6, score: 0.0028, pore: 0.0011, cavity: 0.40,
    gloss: 0.26, sheen: 0.16, glint: 0.80, wear: 0.18, mottle: 0.19,
    ember: 0.24, fadeNear: 50, fadeFar: 118,
    roughness: 0.62, metalness: 0.20,
    note: "verdigris crust over reliquary bronze - pitted, rubbed",
  },

  /* Leather, sinew, the soft joint between two plates. Finest base
     wavelength in the table so the grain is skin-scale rather than
     plate-scale, and almost no sheen. */
  hide: {
    wavelength: 0.60, score: 0.0014, pore: 0.0008, cavity: 0.30,
    gloss: 0.13, sheen: 0.03, glint: 0.22, wear: 0.09, mottle: 0.10,
    ember: 0.32, fadeNear: 40, fadeFar: 94,
    roughness: 0.72, metalness: 0.02,
    note: "hide and sinew - fine grain, soft crease, matte",
  },
};

/** The kit's shader version. It rides in the program cache key, so
 *  bumping it guarantees a recompile rather than a silently reused
 *  program from a previous build. */
const SURFACE_VERSION = 3;

/* ============================================================
   GLSL

   NO BACKTICKS ANYWHERE BELOW, including inside comments. These are
   JavaScript template literals and one backtick in a GLSL comment
   ends the string silently - it has already cost this project a
   debugging round.
   ============================================================ */

const SURFACE_PARS = /* glsl */`
/* uSfGrain.x is radians per WORLD METRE, not per object unit. The
   object-to-world scale is folded into vSFObj in the vertex shader
   (see SURFACE_ANCHOR), so every material on every boss reads the
   same number of cells per metre whatever node scale its part sits
   at. Nothing in this file needs to know which part it is on. */
uniform vec4 uSfGrain;  // world wavenumber, score amp (m), pore amp (m), cavity
uniform vec4 uSfGloss;  // roughness spread, crest metalness, edge wear, albedo mottle
uniform vec4 uSfWear;   // fade near (m), fade far (m), damage 0..1, ember
uniform vec4 uSfSpec;   // glint strength, (reserved x3)
varying vec3 vSFObj;

/* A fixed rotation off the model's own axes, applied once to the
   object position. The field below is built from sines of the three
   coordinates, so on the raw object frame its cells sit ON THE RIG's
   axes - and a creature modelled axis-aligned in Blender grows a
   visible grid running square up its own spine, which is the one
   pattern a viewer recognises instantly as machine-made.
   Constant rather than a uniform: nine multiply-adds,
   no uniform slot, and it can never drift between materials.
   It does not need to be orthonormal for the maths below to be exact
   (the gradient is carried in q-space and only ever dotted against
   d(q)/d(screen)), but it is, so the grain stays isotropic. */
const mat3 SF_GRAIN_ROT = mat3(
   0.53250, -0.34571,  0.77264,
   0.64493,  0.75691, -0.10580,
  -0.54822,  0.55463,  0.62600);

/* AND THE ROTATION WAS NOT ENOUGH. It turned the lattice off the
   rig's axes; it did not stop there being a lattice.

   Every octave below is exactly three times the last, all four share
   this one rotation, and a gyroid is a TRIPLY PERIODIC minimal
   surface - so all four crest sets land on cells of one common
   lattice and reinforce. On a flat facet, which is every facet in
   this game, the visible result is a planar slice of that lattice: a
   regular diagonal cross-hatch that reads as knitted cloth or as a
   printed halftone screen. It was plainly visible on the Garner's
   plates at conversational distance, which is the third time this
   project has shipped a regular weave and had to take it back out.

   The cure is to make the three wavenumbers MUTUALLY IRRATIONAL.
   phi^(1/3) is irrational, so scaling the rotated axes by
   phi^(-1/3) : 1 : phi^(1/3) leaves no two axes commensurate and the
   field never exactly repeats anywhere - it is quasi-periodic, and a
   pattern with no repeat has no lattice to recognise. Locally the
   cells still read as cell structure; across a plate they drift out
   of phase with each other instead of printing the same motif again.

   The three factors multiply to 1, so the grain's overall scale -
   and therefore every amplitude tuned against it - is unchanged.
   Nothing else in the file needs to know: the gradient is carried in
   q-space and dotted against d(q)/d(screen), and both sides pick
   this up for free.

   Cost: three multiplies. No extra trig, no extra derivative. */
const vec3 SF_GRAIN_K = vec3(0.85173, 1.0, 1.17398);
`;

/* Block 0, and it is the only block in the VERTEX shader.

   The bind-pose object position, carried into the fragment stage in
   WORLD METRES rather than in object units.

   `position` rather than `transformed`, because by this point three
   has already run skinning and morphs through `transformed` and a
   grain glued to the skinned position swims across the shell every
   time the animal moves a limb.

   The scale comes off the object-to-world matrix's COLUMN LENGTHS,
   per axis rather than as one cube root, because a node scaled
   (1, 2, 1) has genuinely been stretched twice as far in y in world
   and the cells should stay cubic in world, not in object space.
   Taking it here rather than from a uniform is the whole fix in
   decision 1b: it is per DRAW, so two parts of one boss at different
   node scales - and forty instances of one caste material at forty
   spawn sizes - all land on the same cells per metre.

   In the BIND POSE the skinning chain collapses: three computes
   world = modelMatrix * bindMatrixInverse * bones * bindMatrix *
   position, the bones are identity there, and bindMatrixInverse *
   bindMatrix is the identity - so modelMatrix's columns are exactly
   the bind-pose object-to-world scale. Live bone scale is therefore
   ignored, which is what we want: a squashing limb must not breathe
   its own pores.

   The instancing branch is a correctness guard rather than a feature
   - nothing in the kit is drawn instanced today - because the failure
   it prevents is silent. An InstancedMesh carries its per-instance
   scale in `instanceMatrix`, not in `modelMatrix`, so without this
   every instance would grain at the parent's scale and the bug would
   look like "the small ones are wrong" forever. Three's BatchedMesh
   hides the same scale in `batchingMatrix`; nothing in SAINTFALL uses
   one, and if something does, it belongs here.

   Cost: three sqrt and nine multiply-adds per VERTEX. The fragment
   shader - the half that is fill-bound - gains nothing at all. */
const SURFACE_ANCHOR = /* glsl */`
#include <begin_vertex>
  mat3 sfToWorld = mat3(modelMatrix);
  #ifdef USE_INSTANCING
    sfToWorld = sfToWorld * mat3(instanceMatrix);
  #endif
  vSFObj = position * vec3(length(sfToWorld[0]),
                           length(sfToWorld[1]),
                           length(sfToWorld[2]));
`;

/* Block 1. Everything expensive happens here, once, and the later
   injection points only read the results.

   ALL FOUR SCREEN DERIVATIVES ARE HOISTED ABOVE THE BRANCH. Under
   GLSL ES 3.0 a derivative taken inside non-uniform control flow is
   undefined, and although a camera-range branch is coherent across a
   quad almost everywhere, "almost everywhere" is not a guarantee and
   the failure would be a single flickering pixel line at the fade
   boundary - the worst kind of bug to be handed in a screenshot. */
const SURFACE_GRAIN = /* glsl */`
#include <color_fragment>
vec3  sfQ    = (SF_GRAIN_ROT * (vSFObj * uSfGrain.x)) * SF_GRAIN_K;
vec3  sfDqx  = dFdx(sfQ);
vec3  sfDqy  = dFdy(sfQ);
vec3  sfSigX = dFdx(vSFWorld);
vec3  sfSigY = dFdy(vSFWorld);
float sfDet  = 1.0 - smoothstep(uSfWear.x, uSfWear.y, length(cameraPosition - vSFWorld));
float sfMot = 0.0;
float sfCav = 0.0;
float sfCrack = 0.0;
vec3  sfGradQ = vec3(0.0);
if (sfDet > 0.004) {
  /* The exact screen footprint of the base octave, in radians of
     phase per pixel. Because every finer octave is exactly three
     times the frequency, its footprint is exactly three times this -
     no second fwidth, and no guessing. Past about one radian per
     pixel an octave is sub-pixel and any amount of it is shimmer, so
     each one fades ITSELF out at its own range. */
  float w0 = dot(abs(sfDqx) + abs(sfDqy), vec3(0.33333));
  float a0 = 1.0 / (1.0 + w0 * w0 * 0.55);
  float a1 = 1.0 / (1.0 + w0 * w0 * 4.95);
  float a2 = 1.0 / (1.0 + w0 * w0 * 44.6);
  float a3 = 1.0 / (1.0 + w0 * w0 * 401.0);

  /* One sine and one cosine. Everything below is multiply-add. */
  vec3 s0 = sin(sfQ);
  vec3 c0 = cos(sfQ);
  vec3 s1 = s0 * (3.0 - 4.0 * s0 * s0);
  vec3 c1 = c0 * (4.0 * c0 * c0 - 3.0);
  vec3 s2 = s1 * (3.0 - 4.0 * s1 * s1);
  vec3 c2 = c1 * (4.0 * c1 * c1 - 3.0);
  vec3 s3 = s2 * (3.0 - 4.0 * s2 * s2);
  vec3 c3 = c2 * (4.0 * c2 * c2 - 3.0);

  /* THE OCTAVES ARE GYROIDS, not plane waves, and this is the second
     time this project has had to learn it.

     The first pass summed a single-axis sine into each octave -
     sin(y), sin(x) - and every octave shares one rotation by design,
     so all four crest sets ran along the SAME heading and reinforced
     into hard parallel corduroy. A close-up of the Cantor came back
     looking like woven cloth, which is precisely the plaid the dune
     trains in art.js had to be cured of, one dimension up.

     sin(x)cos(y) + sin(y)cos(z) + sin(z)cos(x) is the fix: it is a
     triply-periodic minimal surface, it has no preferred direction
     and no straight crest anywhere in it, it reads as cell structure
     rather than as weave, and its gradient is still exactly
     differentiable. Two octaves take the permutation in the opposite
     order, which is a genuinely different field out of the same six
     trig results.

     THE FINEST OCTAVE USED TO BE THE TRIPLE PRODUCT s.x*s.y*s.z, on
     the reasoning that at four centimetres an egg-crate is what a
     pore field looks like. It is - and an egg-crate is exactly the
     problem. A product of three single-axis sines is SEPARABLE,
     which is another way of saying it is a perfect rectangular grid,
     and it sat at the finest, highest-contrast, most resolvable
     scale on the model. Zoomed, the Garner's flesh came back looking
     screen-printed. It is now the reverse-order gyroid - the third
     distinct field available from the same six trig results, with
     its own exact gradient - so no octave anywhere in the stack is
     separable any more. The 0.62 restores the amplitude the swap
     changed: a gyroid's range is wider than a triple product's, and
     without it the pore relief would have deepened by half. */
  float mot   = s0.x * c0.y + s0.y * c0.z + s0.z * c0.x;  // ~lambda
  float plate = s1.y * c1.x + s1.z * c1.y + s1.x * c1.z;  // ~lambda/3
  float score = s2.x * c2.y + s2.y * c2.z + s2.z * c2.x;  // ~lambda/9
  float pore  = (s3.y * c3.x + s3.z * c3.y + s3.x * c3.z) * 0.62;  // ~lambda/27

  /* Gradients in q-space. The 9 and the 27 are d(3^N q)/dq: the chain
     rule for the recursion, not a magic number. Only the two octaves
     that touch the NORMAL need one - the coarse pair only tint. */
  vec3 gScore = vec3(c2.x * c2.y - s2.z * s2.x,
                     c2.y * c2.z - s2.x * s2.y,
                     c2.z * c2.x - s2.y * s2.z) * 9.0;
  /* The reverse-order gyroid's own gradient. Note it is NOT the
     forward one above with the components shuffled - the two
     permutations differ in which pair each term couples, so
     d/dx picks up c.x*c.z here where the forward field picks up
     c.x*c.y. Getting this wrong would not crash: the relief would
     simply light from a direction the height field does not have,
     which looks like "the bump map is a bit off" forever. */
  vec3 gPore  = vec3(c3.x * c3.z - s3.x * s3.y,
                     c3.x * c3.y - s3.y * s3.z,
                     c3.y * c3.z - s3.x * s3.z) * (27.0 * 0.62);
  sfGradQ = (gScore * (uSfGrain.y * a2) + gPore * (uSfGrain.z * a3)) * sfDet;

  sfMot = mot * a0;
  sfCav = (score * a2 + pore * a3 * 0.55 + plate * a1 * 0.60) * 0.55;
  /* Where a plate would split. Only the DEEPEST troughs - at
     -0.30/-0.80 the band caught most of the shell, and a fully hurt
     Cantor came back glowing orange in leopard spots, which reads as
     camouflage rather than as damage. The crease has to be rare for
     the crack to read as a crack. */
  sfCrack = smoothstep(-0.62, -1.20, sfCav);
}
`;

/* Block 2. Roughness, which is the term that actually reads as
   "textured" on a model with no albedo map at all: a specular lobe
   that TRAVELS across the shell as the camera moves carries more
   information than any amount of painted detail, and it is the one
   thing a uniform matte boss can never do. */
const SURFACE_ROUGH = /* glsl */`
#include <roughnessmap_fragment>
roughnessFactor = clamp(
  roughnessFactor + (sfMot * 0.62 + sfCav * 0.55) * uSfGloss.x * sfDet, 0.045, 1.0);

/* THE GLINT, and the measurement that forced it.

   Against the vetted Halo pool this game measured brightPct 0.00 -
   not low, ZERO. Not one blown specular pixel anywhere in a boss
   frame, against a reference band of 0.015 to 1.10. The Hunter's
   armour and the Scarab's leg joints both carry small hard white
   hot spots, and those are most of why 2001 metal reads as metal.

   The cause was that the 0.045 floor on the clamp above was DEAD
   CODE. Family roughness centres sit at 0.42 to 0.86 and the spread
   term moves them by about 0.13, so the sharpest surface anywhere in
   the game was roughly 0.33 - a broad soft lobe that can never
   concentrate enough energy to clip, however bright the sun is.

   Two things had to be true at once and only one of them was:

     - the lobe must be NARROW. That is this term.
     - a normal must actually LAND in it. On flat-shaded low-poly
       geometry a sharp lobe is usually a miss - a facet either
       catches the half-vector or it does not, and across a boss the
       odds of any facet being aligned are poor. What saves it is
       that the grain above already perturbs the normal per pixel, so
       the perturbed normals SWEEP through the peak and paint a
       scatter of small glints rather than one flat blown facet.

   Confined to the top of the coarse crest - smoothstep(0.62, 0.98)
   is roughly the brightest tenth of the mottle - so the animal is
   matte almost everywhere and glossy in a few square metres, which
   is the actual distribution on wet chitin and on rubbed bronze. A
   family that should not do this says so: bone is 0.10, because
   chalk has no polish anywhere on it. */
float sfGlint = smoothstep(0.62, 0.98, sfMot) * uSfSpec.x * sfDet;
roughnessFactor = mix(roughnessFactor, 0.055, sfGlint);
/* Wet at the wound. A fresh break is glazed, and gloss is the only
   cue at range that says wet rather than merely dark. */
roughnessFactor = mix(roughnessFactor, 0.13, uSfWear.z * sfCrack * 0.75 * sfDet);
`;

/* Block 3. Crest metalness only - max(), never the signed mottle, so
   the troughs stay dielectric and the highlight lands on the high
   points the way a rubbed surface does. */
const SURFACE_METAL = /* glsl */`
#include <metalnessmap_fragment>
metalnessFactor = clamp(
  metalnessFactor + max(sfMot, 0.0) * uSfGloss.y * sfDet, 0.0, 0.55);
`;

/* Block 4. Injected at `normal_fragment_maps`, the last chunk that
   touches `normal` before the lighting reads it - anywhere after
   `lights_fragment_begin` and the perturbation is decoration on an
   already-shaded pixel. Same anchor and same reason as the dune
   ripples in art.js.

   The normal is perturbed WITHOUT A TANGENT FRAME. There are no UVs
   to build one from and no TANGENT attribute in the file, so this is
   Mikkelsen's surface-gradient form: given the height field's screen
   derivatives and the world position's, the tangent-plane gradient
   falls out of two cross products with no parametrisation at all.
   The height derivatives are ANALYTIC - dot(gradient, d(q)/d(screen))
   - not a finite difference of the height, which is the distinction
   this whole file turns on. */
const SURFACE_NORMAL = /* glsl */`
#include <normal_fragment_maps>
if (sfDet > 0.004) {
  vec3 sfN = inverseTransformDirection(normal, viewMatrix);

  vec3 sfR1 = cross(sfSigY, sfN);
  vec3 sfR2 = cross(sfN, sfSigX);
  float sfJ = dot(sfSigX, sfR1);
  float sfHx = dot(sfGradQ, sfDqx);
  float sfHy = dot(sfGradQ, sfDqy);
  /* Clamped, because sfJ is a screen-space AREA and it collapses on
     a polygon seen exactly edge-on. Without the clamp one grazing
     row of pixels divides by near zero and fires a white spark along
     the silhouette - which reads as a rendering fault, not as grain. */
  vec3 sfSG = clamp((sfHx * sfR1 + sfHy * sfR2) * (sign(sfJ) / max(abs(sfJ), 1e-9)),
                    vec3(-3.0), vec3(3.0));
  normal = normalize((viewMatrix * vec4(normalize(sfN - sfSG), 0.0)).xyz);

  /* --- cavity, wear and damage on the albedo ---------------------
     Note this runs on the UNPERTURBED facet normal (sfN) for its
     direction test. Wear is a gravity story - dust settles and hands
     rub the upward faces - so it has to key on where the facet
     points, not on where the grain tilted it. */
  vec3 alb = diffuseColor.rgb;
  float cav = smoothstep(-1.05, 0.25, sfCav);
  alb *= 1.0 - uSfGrain.w * (1.0 - cav) * sfDet;
  alb *= 1.0 + sfMot * uSfGloss.w * sfDet;

  /* Rubbed surfaces go PALE AND DESATURATED, never merely pale. A
     wear pass that only raises value reads as a highlight painted on
     the model; pulling the hue out at the same time is what makes it
     read as material removed. */
  float lum = dot(alb, vec3(0.2126, 0.7152, 0.0722));
  float wear = clamp(max(sfCav, 0.0) * smoothstep(0.02, 0.80, sfN.y)
                     * uSfGloss.z * sfDet, 0.0, 1.0);
  alb = mix(alb, mix(alb, vec3(lum), 0.55) * 1.15, wear);

  /* DAMAGE, driven by one uniform the boss module writes as it is
     hurt. Scorch pools in the coarse mottle's troughs so soot lands
     in blotches rather than as an even wash, and the crack term
     darkens and lights the creases that the relief already put
     there. */
  if (uSfWear.z > 0.0) {
    float soot = smoothstep(0.20, -0.55, sfMot) * uSfWear.z;
    alb *= mix(1.0, 0.24, soot * 0.85);
    alb *= mix(1.0, 0.10, sfCrack * uSfWear.z);
    /* Squared, so the glow arrives LATE. Linear in damage put an
       ember in every crease from the first hit, and a boss that looks
       half dead at 10% health has no second act. */
    totalEmissiveRadiance += uSfWear.w * uSfWear.z * uSfWear.z * sfCrack
      * vec3(1.0, 0.34, 0.09);
  }
  diffuseColor.rgb = alb;
}
`;

/* ============================================================
   THE PUBLIC KIT
   ============================================================ */

let warnedShared = false;

/**
 * Give a material the shared creature surface. This REPLACES the
 * material's `patchMaterial` call - it goes through the same door,
 * so the atmosphere, the rim and the bioluminescence mask all still
 * apply, and there is exactly one `onBeforeCompile` and one program
 * cache key on the material afterwards.
 *
 * @param {object} material   a MeshStandardMaterial (not Basic - the
 *                            blocks read `normal` and `roughnessFactor`)
 * @param {object} atmos      the shared atmosphere, as for patchMaterial
 * @param {string} family     a key of `SURFACES`
 * @param {object} [opts]
 *   `rim`, `glitter`, `bio`   passed straight through to patchMaterial
 *   `scale`   RETIRED AND IGNORED, kept accepted so no caller breaks.
 *             It used to mean "world metres per object unit", and it
 *             was the bug: a per-material number cannot describe a
 *             per-node fact, so parts of one boss at different node
 *             scales drifted apart and one shared caste material
 *             spanned 6.14x. The vertex shader now reads the real
 *             object-to-world scale per draw (decision 1b). Delete
 *             the argument at your leisure; it is recorded on
 *             `userData.sfSurface.legacyScale` so a sweep can find
 *             the call sites.
 *   `shared`  true for a material shared by many instances - a caste
 *             material. Locks out per-instance damage.
 *   `adopt`   true to also write the family's advisory roughness and
 *             metalness onto the material. Default false.
 *   plus any of the family fields, to override one number.
 * @returns {object} the same material
 */
export function applySurface(material, atmos, family = "chitin", opts = {}) {
  if (!material) return material;
  const preset = SURFACES[family];
  if (!preset) {
    console.warn(`[saintfall] unknown surface family "${family}"; falling back to chitin`);
  }
  const f = { ...(preset || SURFACES.chitin), ...opts };

  /* The patch path early-returns on an already-patched material, so a
     second call would silently do nothing and the surface would be
     missing with no error anywhere. Say so loudly instead. */
  if (material.userData.sfPatched) {
    console.warn(`[saintfall] applySurface("${family}") on an already-patched material `
      + `"${material.name || "?"}"; replace its patchMaterial call, do not add to it`);
    return material;
  }

  const THREE = atmos.THREE;
  if (opts.adopt) {
    material.roughness = f.roughness;
    material.metalness = f.metalness;
  }

  /* The uniform VALUE OBJECTS are built here, once, and the same
     objects are handed to every compile. A material that recompiles -
     and one does, the first time a new light enters the scene -
     otherwise gets fresh uniforms and silently forgets how hurt the
     boss was. */
  const uniforms = {
    /* Radians per WORLD METRE. No node scale here and none wanted -
       the vertex shader takes it off the object-to-world matrix per
       draw, which is the only place it is actually known. A caller
       still passing `scale` is recorded below and ignored; folding it
       in here as well would double-count it, and the Coulter (drawn
       at 4.64) would grain at 25 cm instead of 1.15 m. */
    uSfGrain: {
      value: new THREE.Vector4(TAU / f.wavelength, f.score, f.pore, f.cavity),
    },
    uSfGloss: { value: new THREE.Vector4(f.gloss, f.sheen, f.wear, f.mottle) },
    uSfWear: {
      value: new THREE.Vector4(f.fadeNear, f.fadeFar, clamp01(opts.damage || 0), f.ember),
    },
    uSfSpec: { value: new THREE.Vector4(f.glint, 0, 0, 0) },
  };

  const extend = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSFObj;")
      .replace("#include <begin_vertex>", SURFACE_ANCHOR);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SURFACE_PARS}`)
      .replace("#include <color_fragment>", SURFACE_GRAIN)
      .replace("#include <roughnessmap_fragment>", SURFACE_ROUGH)
      .replace("#include <metalnessmap_fragment>", SURFACE_METAL)
      .replace("#include <normal_fragment_maps>", SURFACE_NORMAL);
  };

  /* Every family generates IDENTICAL source - the whole table is
     uniforms - so the family name deliberately does NOT enter the
     cache key. Two families sharing one compiled program is correct
     and is one compile saved; what must never collide is two
     materials whose generated SOURCE differs, and the only thing that
     varies the source here is whether the kit is present at all.
     `patchMaterial` folds this in alongside its own rim/bio/dune
     flags, which do vary the source. */
  patchMaterial(material, atmos, {
    rim: opts.rim,
    glitter: opts.glitter || 0,
    bio: opts.bio || 0,
    extend,
    extendKey: `surf${SURFACE_VERSION}`,
  });

  material.userData.sfSurface = {
    family: preset ? family : "chitin",
    uniforms,
    shared: !!opts.shared,
    damage: clamp01(opts.damage || 0),
    /* The world wavelength this material is asking for, in metres, so
       a harness can assert that two parts of one animal agree without
       re-deriving TAU. */
    wavelength: f.wavelength,
    /* A retired argument, recorded rather than obeyed. Non-1 here
       means a call site still passes `scale` and can be tidied. */
    legacyScale: opts.scale === undefined ? 1 : opts.scale,
  };
  return material;
}

/**
 * Drive the damage response, 0..1. Scorching pools in the coarse
 * mottle, creases crack and darken, and the breaks go wet.
 *
 * A boss is a single instance, so a per-instance material is fine for
 * one - but the bestiary castes SHARE one material per species, and
 * writing damage there would scorch all forty Threshers at once. Those
 * materials are registered `shared: true` and this refuses them.
 *
 * @returns {number} the damage actually in force on that material
 */
export function setSurfaceDamage(material, value) {
  const surf = material && material.userData && material.userData.sfSurface;
  if (!surf) return 0;
  if (surf.shared) {
    if (!warnedShared) {
      warnedShared = true;
      console.warn("[saintfall] setSurfaceDamage on a shared caste material is a no-op; "
        + "clone the material for the instance that needs it");
    }
    return surf.damage;
  }
  const v = clamp01(value);
  surf.damage = v;
  surf.uniforms.uSfWear.value.z = v;
  return v;
}

/** What damage a material is currently carrying. */
export function surfaceDamage(material) {
  const surf = material && material.userData && material.userData.sfSurface;
  return surf ? surf.damage : 0;
}

/** The per-pixel cost of the kit, so the budget conversation is a
 *  number rather than an opinion. Read by the QA harness. */
export const SURFACE_COST = Object.freeze({
  textureFetches: 0,
  transcendentals: 6,      // one sin(vec3) and one cos(vec3)
  screenDerivatives: 4,    // dFdx/dFdy of the phase and of world position
  octaves: 4,              // via the triple-angle recursion
  /* PER VERTEX, not per pixel, and listed separately because the
     frame is fill-bound and the two are not interchangeable: the
     world-scale derivation is three sqrt on a 13k-vertex boss. */
  vertexSqrts: 3,
  injections: ["begin_vertex", "color_fragment", "roughnessmap_fragment",
    "metalnessmap_fragment", "normal_fragment_maps"],
});
