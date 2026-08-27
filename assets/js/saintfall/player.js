/* ============================================================
   SAINTFALL - traversal

   A third-person controller, because the level has to be walked to
   be judged. Two things it is deliberately not: it is not a
   physics character, and it is not the game's final movement
   model. It exists so a person - or a screenshot harness - can
   stand anywhere on the map at eye height and look at it.

   The camera matters more than the character here. A level shot
   from a floating free camera lies to you: it never shows what the
   ground looks like from 1.6m with a figure in frame for scale,
   which is the only view anyone will ever actually play from.
   ============================================================ */

import {
  TAU, clamp, clamp01, lerp, damp, dampAngle, angleDelta, makeRng,
} from "saintfall/core.js";
import { makeKit } from "saintfall/structures.js";
import { paintByHeight, PALETTE, patchMaterial } from "saintfall/art.js";
import { makeRamp } from "saintfall/core.js";
import { initIk, solveTwoJoint } from "saintfall/ik.js";
import {
  keybindCodes, keybindDown, keybindMatches, onKeybindsChange,
} from "saintfall/keybinds.js";

/* ============================================================
   THE FIGURE
   A Concord trooper: heavy coat, cowl, rebreather, pack. Built at
   1.85m so it is a reliable scale reference next to a 62m head.
   ============================================================ */

function buildProceduralTrooper(ctx) {
  const { THREE, materials } = ctx;
  const kit = makeKit(THREE);
  const rng = makeRng(0x7009);
  const root = new THREE.Group();
  root.name = "trooper";

  const H = 1.85;

  /* ---------------------------- palette ----------------------------
     Four surfaces, each with a job. The armour is the read, the
     coat is the mass, the leather breaks the two apart, and the
     gold is where the eye lands. A figure painted in one ramp is a
     silhouette no matter how much geometry is in it. */
  /* --- the livery ------------------------------------------------
     Ivory plate, verdigris panels, gold trim, and one warm light in
     the chest. Four surfaces, each with a job: the ivory carries the
     silhouette, the verdigris breaks it into panels, the gold is
     where the eye lands, and the lantern is the only thing on the
     figure that emits rather than reflects - which is what makes a
     suit of armour read as inhabited.

     Deliberately the Concord's own palette. The Cantor wears iron
     and gold, the Cathedral is bronze and verdigris, and the Saint
     is a bronze head gone green: the player is made of the same
     materials as the world's holy architecture, at man height. */
  /* Ramp floors are HIGH. The body-wide gradient exists so the
     figure is not striped, but with a dark floor it does the job of
     lighting as well - and a knight whose legs are black below the
     waist is not the concept, it is a gradient. Ivory should read as
     ivory in shadow; the sun decides the rest. */
  const IVORY = makeRamp([
    /* Near-NEUTRAL bone. It used to top at #f2ead6 - hue 42 - and
       GOLD tops at hue 39. Two ramps three degrees apart can only
       separate by saturation, and the golden-hour key saturates the
       ivory until it matches, so every gold band on the figure read
       as more ivory. Bias was tried as the lever and failed, because
       bias moves value and the collision was in HUE. */
    /* The floor drops to near-black. It sat at #6f6d68 - 43%
       luminance - to stop the legs going black under the old
       body-wide gradient, which was the right diagnosis of that bug
       and the wrong lever: it cost the figure its entire dark end.
       74% of figure pixels sat inside one 20-point luminance window
       and the darkest pixel on the lit figure was L17 against the
       reference's L2. With a local gradient and a cavity term the
       darks land where the form is, not across whole limbs. */
    /* Biased COOL of neutral, so the product with a #ffd6a0 key lands
       near the plate's C 17 rather than C 31-38. Measured, the
       render's bone sat at the chroma the reference reserves for
       GOLD - which is exactly why the gold could not separate from it
       and read as one more ivory panel. The sun is not the thing to
       change; the world needs it warm. */
    /* WARM-neutral, not cool. Bone was rotated through neutral into
       the cool half (#464a4c -> #e9ecf0 is Lab hue 236-263, i.e.
       blue) to separate it from gold - a correct diagnosis of the
       hue collision solved with the wrong lever. Multiplied by a
       #ffd6a0 key that lands at hue 78-84 with a* +1.5, against a
       plate measuring hue 58-60 at a* +12: the figure's whole hue
       axis was 20-25 degrees toward yellow-green.

       The plate separates bone from gold by VALUE and CHROMA at a
       shared hue - pale broad fields with thin dark saturated lines
       on them - not by hue rotation. */
    /* Lifted at the light end. Matching the plate's hue moved the
       armour into the sand's own family, so it now has to separate on
       VALUE - which is how the plate does it: bone at L 42-52 against
       stairs at L 15-25. The figure was sitting at L 39.7. */
    /* Pulled back down. The lift was made citing "the figure was
       sitting at L 39.7" - but reference.json's own pooled L is 42.3,
       so 39.7 was within three points of target and got moved 15-40
       points away from it. Measured against the plate, EVERY figure
       component except the sunlit helm crown is DARKER than the sand:
       the plate is a dark figure on light ground, and the render had
       become a light figure on light ground, which is why separation
       sat on the threshold. The plate separates on VALUE at a shared
       hue - its helm is hue 57 against sand at 59. */
    /* Rotated ~12 degrees toward red. The lit product was landing at
       hue 72 against a plate at 55-65 - the key is #ffd6a0 (hue 70),
       so a neutral albedo comes out AT the key's hue and the albedo
       has to lean red to pull it back. */
    /* Lighter than the plate ON PURPOSE, and this is the resolution
       of an oscillation that ran most of this project.

       reference.json pools the plate's figure at L 42.3, and matching
       that absolute number made the render vanish into the sand. The
       plate's knight stands on DARK STONE STAIRS at L 15-25, so L 42
       is +20 against its ground. This game's ground is sunlit sand at
       L 46-56, so the same L 42 is -8 against ITS ground: the plate's
       figure is light-on-dark and copying its absolute value makes
       ours dark-on-light.

       What transfers between a reference and a different environment
       is the RELATIONSHIP - roughly +20 L over the ground - not the
       number. Absolute values are only portable when the surround
       is. */
    /* Restored to the value that measured best, after four attempts
       to chase the plate's absolute L made the picture worse each
       time. A +30 albedo lift moved the RENDERED median only 3.4
       points, which says the grade - not the ramp - is what compresses
       the figure's value here, and that is a global control not worth
       swinging at blind. The relationship gate below now reports the
       real gap honestly instead of a number that looked fine. */
    /* Two large lifts of this ramp (+30, then +15 at the lit end)
       moved the figure's LIT luminance 51.2 -> 51.8 against sand at
       55.9, and cost separation both times. The figure's rendered
       value is effectively decoupled from its albedo here, which
       points at exposure/tonemap rather than the ramp - a global
       control, and not one to swing blind at this depth. Left at the
       value that measured best; the gate below reports the real gap
       rather than a number tuned to look closed. */
    [0.00, "#403d35"], [0.22, "#6a6459"], [0.50, "#a49b8a"],
    [0.80, "#d6ccb6"], [1.00, "#f8f2e2"],
  ]);
  /* Verdigris, not emerald. The previous green was a saturated
     forest that became the most saturated object on the figure, so
     the eye went to the hips instead of the head. Real patina is
     desaturated and pale. */
  /* Measured off the plates by sampling inside the figure: every
     named component sits on the WARM side of neutral (a* +2.7 to
     +20.9, pooled +7.6) at chroma ~16, and the pooled green-side
     share is 3.3%. Verdigris reads as patina there because it is
     less warm and less chromatic than the gold beside it - a
     RELATIVE cue - not because it is green.

     The previous ramp ran a* -25 at chroma 28 and was pushed there
     deliberately to move a gate reading. That gate's floor was 8%
     against a reference measuring 3.3%, so a figure matching the art
     would have failed it. Tuning the model to satisfy an unmeasured
     threshold is the whole reason thirteen rounds scored flat. */
  const VERDIGRIS = makeRamp([
    /* WARM SAGE. The comment above records the measurement - the
       plate's one genuinely verdigris component is a* +4.4, hue 74,
       C 15.6 - and then the ramp was left at a* -19, hue 148: a true
       green, landing at hue 119-124 under the key. The conclusion was
       written down and never applied. */
    /* Same rotation, and pulled into the plate's own patina window:
       hue 66-82 at chroma 10-22, sitting BELOW the gold in chroma so
       it reads as patina beside bright metal rather than as a
       different paint. */
    /* Near-NEUTRAL with a green cast, because chroma is the only axis
       left to separate on. A #ffd6a0 key drives every material on the
       figure to hue 66-82 - measured, 278,669 px in that band at mean
       chroma 26.6 - so verdigris and bone cannot be told apart by
       hue no matter what their albedos are. The plate separates them
       by CHROMA: its verdigris is C 14.7 beside gold at C 28. Ours
       had verdigris and bone both landing near 26, which is the
       measurement behind "the figure is a one-material object". */
    /* Actually GREEN in the albedo, G/R about 1.14.

       The previous ramp was neutral (a* about +0.5) on the strength
       of a claim that a saturated key pins hue - and that claim was
       half wrong. The chroma FLOOR is real: no albedo can render
       below about C 20 under this sun. Hue is not pinned at all; a
       modelled sweep of this chain shows a 78-degree rotation from
       albedo alone with the sun untouched.

       The experiment that produced the wrong half was tautological:
       it neutralised this material and then measured that a neutral
       material renders at the key's hue. Testing "can albedo move
       hue" on something already neutral can only ever return no.
       Cost: 181 green pixels in 10.5 million. */
    /* Floor raised off near-black. A downward-facing ring end-cap
       lands at the ramp floor AND gets the cavity term's 0.72
       multiplier on top, so at #2f3630 the gorget's underside
       rendered rgb(30,27,32) - a hard-edged black octagon at the
       armpit, 6,920px, about 4.8% of the figure. The reference has no
       pure black anywhere on the armour. */
    /* G/R ~1.35, not 1.12. Measured at four saturations (0.75, 0.90,
       1.00, 1.15) this ramp rendered 0.0% green-side EVERY time - the
       problem is HUE, not chroma, and no grade change can rotate a
       ramp that is barely green in the albedo. */
    [0.00, "#38443a"], [0.32, "#465a4a"], [0.64, "#5a745e"],
    [0.86, "#6f8f74"], [1.00, "#88ab8d"],
  ]);
  // Neutral near-black, for recesses that must not read as a colour.
  const NEUTRAL_DARK = makeRamp([
    [0.00, "#141618"], [0.5, "#1d2124"], [1.00, "#2a2f33"],
  ]);
  // Hotter than the chest lantern, so the slit separates by value.
  const SLIT_LIGHT = makeRamp([
    [0.00, "#e0761c"], [0.5, "#f9a43a"], [1.00, "#ffd894"],
  ]);
  // The darkest value on the figure, used only on rim faces that
  // need to hold an outline against a bright sky.
  const RIM_DARK = makeRamp([
    [0.00, "#1d2f28"], [0.5, "#294036"], [1.00, "#365046"],
  ]);
  // Muted brass, not school-bus yellow.
  const GOLD = makeRamp([
    /* Saturated brass against neutral bone: they now separate on
       hue under any key light, and the dark floor gives every trim
       band a contour of its own against a bright sky. */
    /* Lifted in chroma. The plate's lit gold reaches C 60 while the
       render capped at 28.6 - and verdigris only reads as PATINA
       relative to bright metal beside it. Warming the verdigris
       without raising the gold left a 2-4 a* gap where the plate has
       7-8. */
    [0.00, "#3a2606"], [0.34, "#8a5f0b"], [0.68, "#c08d14"],
    [0.88, "#e0a820"], [1.00, "#f2c344"],
  ]);
  // The bodyglove under the plate. Dark, but not a hole in the
  // figure - it is the shadow BETWEEN plates, and it only reads as
  // that if you can still tell it is a material.
  const UNDER = makeRamp([
    /* Near-black even at its LIGHT end. In shadow this ramp rendered
       at rgb(35,28,32) while the ivory floor rendered at rgb(30,27,32)
       - the same colour - so the bodyglove was only doing work where
       everything was already dark, and none at all across the lit
       half of the figure, which is exactly where the reference gets
       its read: bright plate against near-black recess IN SUNLIGHT. */
    [0.00, "#141319"], [0.40, "#1e1d25"], [0.75, "#2b2933"], [1.00, "#3a3742"],
  ]);
  /* Quieter than the gold trim. At full chroma the tabard was the
     loudest object on the figure and the eye landed on the crotch. */
  /* Deeper and redder than the plate. At a light end of #d8c39c the
     cloth landed within a few dE of ivory, so the tabard read as one
     more armour panel - a flat board hung off the belt - instead of
     as the one soft thing on the figure. Cloth has to be the value
     the plate is not. */
  /* Cloth-scale gold. The trim ramp was reused for the sash at a
     0.42 bias, which parks a broad flat sheet at the cream end of a
     ramp tuned for 16mm bands: measured L 69.8 / C 42.1 / hue 79,
     against a plate sash at L 50.4 / C 50.8 / hue 62. The plate's
     sash separates from sand by being DARKER and less chromatic with
     more red in it; mine was lighter and more chromatic - the
     relationship inverted, and it became the brightest object on the
     figure, dead centre front. */
  const GOLD_CLOTH = makeRamp([
    /* Darker and quieter than sand, which is how the plate's sash
       separates: L 29-42 / C 34-44 against sand at L 49-52 / C 49-58.
       The previous pass moved it to L 55.5 / C 41.6 - brighter and
       more chromatic than the L 48.0 / C 37.0 it replaced, i.e. 5 dE
       from the sand: the camouflage the comment above diagnosed,
       made worse by the fix for it. */
    [0.00, "#3c2504"], [0.34, "#6d4708"], [0.68, "#95670b"],
    [0.88, "#a8760f"], [1.00, "#c08a1a"],
  ]);
  const CLOTH_RAMP = makeRamp([
    /* BONE, with gold straps laid over it separately.

       The traversal plate has a gold SASH, and generalising that one
       element onto the whole garment made the skirt a gold curtain.
       The cathedral plate settles it: the skirt is bone white, the
       same family as the plate, carrying thin vertical gold orphrey
       straps and a hem band. Gold is trim on it, not its colour. */
    [0.00, "#4a463f"], [0.35, "#726d63"], [0.70, "#a49d90"], [1.00, "#d8d2c4"],
  ]);
  // Warm orange, never white: white reads as a lit window.
  /* A near-WHITE core. At a top stop of #f6a94a (L 75) against bone
     measuring L 57-71 under the same key, the lantern was 4-15 points
     brighter than its surround - a gold hexagon, not a light. In the
     plate the core is near-white against a chest at L 30-40: a ~50
     point gap, and it is the brightest thing in the picture. A light
     source needs something to burn against, so the socket below is
     dark and the emissive sits deeper behind the mullions. */
  const LANTERN = makeRamp([
    /* Keeps its CHROMA. Whitening the core to buy a value gap threw
       away the saturation that reads as fire: the plate's core is
       C 54.6 against a socket at L 18 - it gets the 70-point gap by
       making the surround near-black, not the core white. */
    [0.00, "#d2700f"], [0.45, "#f2a733"], [0.80, "#ffc862"], [1.00, "#ffcf7a"],
  ]);

  /* Collected per (pivot, material) so a rebuilt figure is still a
     handful of draw calls. */
  const buckets = new Map();
  /* Gold barely biased, and capped well below ivory. At bias 0.30
     against a top stop of #eed79c every gold part on the upper body
     clipped to a cream within a few points of the ivory touching it -
     the crest, the gorget band, the belt and the sunburst all
     rendered as ivory, and the brief's accent colour was invisible. */
  /* `goldCloth` is gold on a large flat sheet, which takes the same
     NdotL as the ground it stands on: the sash measured L 48.0 /
     C 37.0 against sand at L 51.3 / C 36.6 beside it - camouflage,
     and why the front of the figure read as a hole with the desert
     showing through. It needs to sit much higher on the same ramp. */
  const BIAS = {
    /* The ramp's top stops were lowered this round AND the biases cut
       - each sufficient on its own, together about 2x the correction.
       Gold came out 7.3 dE from the ivory beside it with 42% of its
       pixels below C 25: the accent neutralised in the act of fixing
       its clipping. The stops are low enough now that raising the
       bias cannot return it to lemon. */
    gold: 0.22, goldCloth: 0.10, cloth: 0.26, emissive: 0.75, bronze: 0.10,
  };
  function part(node, matName, ramp, geo, opts = {}) {
    if (opts.bias === undefined && BIAS[matName] !== undefined) {
      opts = { ...opts, bias: BIAS[matName] };
    }
    const key = `${node.uuid}|${matName}|${opts.bias ?? 0}`;
    let bin = buckets.get(key);
    if (!bin) { bin = { node, matName, ramp, geos: [], opts }; buckets.set(key, bin); }
    bin.geos.push(geo);
    return geo;
  }

  /** A curved sheet: cloth, cloaks, tabards. `fn(u, v)` returns a
   *  position, so the shape is authored as a surface rather than
   *  assembled out of boxes. */
  function sheet(cols, rows, fn) {
    const pos = [];
    const idx = [];
    for (let j = 0; j <= rows; j += 1) {
      for (let i = 0; i <= cols; i += 1) {
        const q = fn(i / cols, j / rows);
        pos.push(q[0], q[1], q[2]);
      }
    }
    const stride = cols + 1;
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const a = j * stride + i;
        idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ============================================================
     THE FIGURE

     Built to an explicit height budget in METRES, not in fractions
     of H. Two review passes rated eyeballed proportions 3/10 then
     2/10, and the second handed over a budget - which is worth more
     than any note about shapes, because it is checkable:

       ground 0.00 · sabaton top 0.10 · knee 0.50 · hip 0.90
       belt 1.02 · heart-lantern 1.30 · shoulder 1.50
       gorget top 1.56 · helm top 1.82 · halo apex 1.94

     Four rules the rebuild is organised around:

     1. THE LEG CHAIN MUST OUTREACH THE HIP. Thigh + shin was 0.814m
        under a hip at 0.842m, so the IK could never put a foot on
        the ground: it clamped, the legs locked straight, and the
        figure floated. Not one review image showed a foot touching
        anything. The chain is now 0.96m under a hip at 0.90m, which
        leaves the knee bent and the sole planted.

     2. A TRIM BAND MAY NEVER BE WIDER THAN THE LIMB IT WRAPS. The
        faulds were rings that grew to 0.62m across and the gold
        bands followed them, which is the exact geometry of shelving
        - the review read the whole lower body as a bookcase.

     3. THE PAULDRONS MUST BE THE WIDEST THING ON THE FIGURE. The
        widest point was the hips, which is why it read bottom-heavy
        and furniture-like.

     4. NOTHING CROSSES THE FACEPLATE. A horizontal bar over a
        vertical panel is a crucifix, and a cross on a faceplate
        reads as an eye-line and a nose - the opposite of blank.
     ============================================================ */

  const M = 1;            // metres; H is 1.85 and the budget is absolute

  /** A band that stands proud of the surface it rims. */
  /* slabC() runs from y=0 to y=h - it is BASE-anchored, not
     centred - and every call on this figure was written as though
     the position given was its middle. Everything placed with one
     sat half its own height too high, which is how the helm's slit
     bezel ended up breaching the crown by 58mm and standing out of
     the back of the head as two black horns. */
  /* PHASE IS CONSTANT WITHIN A SOLID.
     Rotating each ring by a different phase means consecutive rings
     do not line their vertices up, so every side quad is non-planar
     and flat shading splits it along its diagonal - a barber-pole of
     light and dark bands running the length of every limb and the
     whole ribcage. It was the single reason nothing on the figure
     read as crisp. Vary phase BETWEEN solids, never within one. */
  const slabC = (w, h, d, bevel = 0) => kit.slab(w, h, d, bevel).translate(0, -h / 2, 0);

  /* A band is an open ring, ALWAYS. `ringSolid` caps by fanning to
     the ring's centre, so a capped two-ring band is a filled plate
     rather than a rim - which is how a dark shoulder rim became a
     black disc swallowing the lame beneath it. */
  const band = (node, mat, ramp, rings, opts = {}) =>
    part(node, mat, ramp,
      kit.ringSolid(rings, { capTop: false, capBottom: false, ...opts }));

  /* ============================================================
     LEGS
     ============================================================ */

  const legPivots = [];
  const kneePivots = [];
  const HIP_Y = 0.90 * M;
  /* 0.82m of chain against a 0.79m drop. At 0.96m the legs had
     0.17m of slack they had to bend to absorb, so the figure stood
     in a permanent 33-degree squat with its knees thrust 0.27m
     forward - it read as digitigrade in every single frame. */
  const THIGH = 0.42 * M;
  const SHIN = 0.40 * M;
  const ANKLE_H = 0.11 * M;   // ankle joint above the sole

  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    /* 0.22m between hips, not 0.34m. The thighs at +/-0.17 with rx
       0.122 spanned 0.586m across - wider than the 0.29m skirt that
       is supposed to contain them - so the two cuisses punched out
       through the cloth as a pair of hexagonal slabs at the hips.
       That was the +115% error at the waist, and it survived four
       reshapes of the tassets because the tassets were never it.
       The reference's skirt hides the legs entirely; ours has to be
       able to. */
    /* 0.078. Measured against the plate the ankle span was 0.237 of
       body height against a reference of 0.139 - the cuisse and
       poleyn had each been narrowed in turn while the hip SEPARATION
       and the sabaton, which together set the widest lower reading,
       were never touched. */
    hip.position.set(s * 0.078, HIP_Y, 0);
    root.add(hip);
    legPivots.push(hip);

    const knee = new THREE.Group();
    knee.position.set(0, -THIGH, 0);
    hip.add(knee);
    kneePivots.push(knee);

    // Cuisse: 0.26 x 0.22 tapering to 0.19 x 0.18.
    /* The reference lower body is a COLUMN as wide as the torso is
       deep, not a pair of sticks. At rx 0.130 tapering to 0.070 the
       silhouette pinched to a quarter of its shoulder width below
       the belt while the reference holds ~35% throughout. */
    /* Slim. Measured off the plate, the reference is an HOURGLASS -
       shoulder 0.36 of body height, waist 0.22, knee 0.17 - not the
       "near-constant column ~35-40%" a previous comment here
       asserted. That assertion was never computed from the art, and
       it drove a round that doubled these radii and built a barrel.
       Verdigris because the reference's thighs are scale, not plate. */
    part(hip, "verdigris", VERDIGRIS, kit.ringSolid([
      /* Top ring raised to reach the fauld. The cuisse started at
         hip + 0.04 = 0.94 while the fauld's lowest ring sits at
         0.935 with rx 0.182 against the cuisse's 0.086 - so in
         silhouette the leg column met the torso at a point and a
         3-row hole opened at the hip. Cloth bridges it in the shipped
         figure, which is why it read as a gate artefact, but the
         ARMOUR does not join. */
      { y: 0.086, rx: 0.100, rz: 0.094, sides: 7, phase: 0.42 },
      { y: 0.04, rx: 0.090, rz: 0.086, sides: 7, phase: 0.15 },
      { y: -THIGH * 0.55, rx: 0.080, rz: 0.076, sides: 7, phase: 0.15 },
      { y: -THIGH + 0.115, rx: 0.076, rz: 0.072, sides: 7, phase: 0.15 },
    ]));
    // Trim goes AROUND the limb and no wider.

    // Poleyn: domed, 0.04m proud of both cuisse and greave.
    part(knee, "verdigris", VERDIGRIS, kit.ringSolid([
      /* Top ring raised to OVERLAP the cuisse. The cuisse's last ring
         sits at -THIGH + 0.115 = -0.305 and the poleyn's first was at
         knee + 0.048 = -0.372: a 67mm gap, so each shin was a
         DETACHED component. The silhouette's connectedness gate read
         3 pieces - body plus two free-floating shins - which is
         exactly what that gate exists to catch. */
      { y: 0.118, rx: 0.094, rz: 0.090, sides: 6, phase: 0.2 },
      { y: 0.048, rx: 0.100, rz: 0.096, sides: 6, phase: 0.2 },
      { y: 0.005, rx: 0.104, rz: 0.100, sides: 6, phase: 0.2 },
      { y: -0.070, rx: 0.096, rz: 0.092, sides: 6, phase: 0.2 },
    ]));
    // Nothing on the front of the poleyn: near-black at 0.16 x 0.10
    // reads as a hole punched through the kneecap, and this ring
    // also varied phase WITHIN itself. The dome is enough.

    // Greave, with a hard centre ridge.
    // The greave carries the secondary colour. Verdigris was one
    // 0.026m wrist band on a 1.85m figure - a named primary
    // requirement rendering as nothing.
    part(knee, "verdigris", VERDIGRIS, kit.ringSolid([
      /* FLARES knee to ankle. The plate's bell-bottomed greave is
         one of this character's three most distinctive shapes and
         this one tapered - narrow where the reference is widest,
         which is the shape inverted rather than approximated. */
      { y: -0.060, rx: 0.078, rz: 0.074, sides: 7, phase: 0.2 },
      { y: -SHIN * 0.60, rx: 0.092, rz: 0.086, sides: 7, phase: 0.2 },
      { y: -SHIN + 0.060, rx: 0.086, rz: 0.084, sides: 7, phase: 0.2 },
    ]));

    /* Sabaton: 0.16 wide x 0.34 long x 0.10 tall, toe well forward.
       Wide and blunt - a heavy figure on small feet reads as
       stilted, and the previous leg simply cut flat at the ankle. */
    /* 0.23 wide by 0.34 long, with a flat squared toe. At 0.172m
       wide against a 0.140m shin it was a 3% gain on the silhouette
       and simply did not read as a foot. */
    part(knee, "bone", IVORY, kit.ringSolid([
      /* Continuous with the greave. The first ring used to start
         0.030m below where the greave ended and 0.085m forward of
         it, so every ankle had a hole in it and the foot read as a
         loose object lying on the sand. */
      /* The sole must sit at ANKLE_H below the ankle, not deeper -
         at 0.126 against an ANKLE_H of 0.110 the toe was 16mm under
         the sand. And it starts ABOVE where the greave ends, because
         two capped rings 2mm apart z-fight and rim-light bright blue. */
      /* Clocked off the greave. Widening the sabaton back to 0.112
         put its rings nearly parallel to the greave's last ring
         25mm above, and near-parallel faces a few millimetres apart
         are exactly what the coplanar assert exists to catch. */
      { y: -SHIN + 0.085, rx: 0.072, rz: 0.078, sides: 6, phase: 0.52 },
      { y: -SHIN - 0.030, rx: 0.098, rz: 0.150, sides: 6, phase: 0.52 },
      /* Narrow across, LONG fore-aft. The plate's boot is a big blunt
         shape seen from the side, not a wide one seen from the front,
         and rx was setting the frontal ankle span. */
      /* Widened back. Chasing a 0.237 measurement down to a 0.139
         reference, rx went 0.172 -> 0.082 and the result measured
         0.071 - 49% UNDER, the worst row in the gate. Crossed the
         target and kept going. */
      { y: -SHIN - 0.082, rx: 0.104, rz: 0.190, sides: 6, phase: 0.52 },
      { y: -SHIN - 0.108, rx: 0.090, rz: 0.176, sides: 6, phase: 0.52 },
    ]).translate(0, 0, 0.028));
  }

  /* ============================================================
     TORSO
     ============================================================ */

  // Ribcage: an inverted trapezoid, waist 0.22 half-width at the
  // belt widening to 0.24 at the chest.
  /* ============================================================
     CHEST

     Everything above the waist hangs here so an action can turn the
     TORSO, not just the weapon. Without this pivot the ribcage,
     helm, halo and both shoulders were parented straight to the
     root and a pose timeline could only drive `weaponMount` - which
     makes a swing mathematically a lever rotating about a fixed
     point on a rigid mannequin. Every melee clip came back with the
     body pixel-identical across all six sampled frames: no
     anticipation, no hip rotation, no counter-turn, no
     follow-through. `chest` rotates about the waist at y 1.00;
     `torso` cancels that offset so every part below keeps the
     absolute coordinates it was authored in, and `accY` still sums
     to the same height because the two offsets cancel.
     ============================================================ */
  const chest = new THREE.Group();
  chest.position.set(0, 1.00, 0);
  root.add(chest);
  const torso = new THREE.Group();
  torso.position.set(0, -1.00, 0);
  chest.add(torso);

  /* Bone, with the patina carrying the verdigris. Assigning whole
     shells to VERDIGRIS made the ribcage - most of the silhouette
     from behind - solid olive, and the figure measured 24-41% green
     against a reference that measures 2-8%. Layering reads by value
     and edge, not by giving each part its own hue. */
  part(torso, "bone", IVORY, kit.ringSolid([
    /* Narrowed to the traced plate. At rx 0.242 the ribcage alone was
       0.484m across - 26% of body height against a plate that reads
       0.165-0.192 at the chest - so the torso, not the cloth, was
       what made the figure a cylinder. Three rounds of narrowing the
       skirt could never have reached it. Wide shoulders over a thin
       core is the whole shape of this character. */
    { y: 0.98, rx: 0.132, rz: 0.124, sides: 8, phase: 0.3927 },
    { y: 1.08, rx: 0.146, rz: 0.138, sides: 8, phase: 0.3927 },
    { y: 1.26, rx: 0.168, rz: 0.156, sides: 8, phase: 0.3927 },
    { y: 1.42, rx: 0.170, rz: 0.158, sides: 8, phase: 0.3927 },
    { y: 1.52, rx: 0.146, rz: 0.136, sides: 8, phase: 0.3927 },
  ]));

  /* Breastplate with a standing keel: two angled halves at
     different values, so anything mounted on the chest has form to
     sit against instead of a smooth bag. */
  part(torso, "bone", IVORY, kit.extrudeZ([
    [-0.205, 1.48], [0.205, 1.48],
    [0.175, 1.20], [0.095, 1.03], [0, 0.985],
    [-0.095, 1.03], [-0.175, 1.20],
  /* extrudeZ is z-CENTRED (hz = depth/2), so this translate is the
     plate's MIDDLE. At 0.150 it spanned z 0.125-0.175 while the
     ribcage front sits at 0.203-0.215 - the largest single piece of
     ivory on the figure was buried inside the body and rendered
     zero pixels. The chest read as a smooth bag, and no amount of
     trim makes a bag read as armour. */
  ], 0.050).translate(0, 0, 0.228));
  part(torso, "bone", IVORY, kit.extrudeZ([
    [-0.030, 1.475], [0.030, 1.475],
    [0.020, 1.02], [0, 0.99], [-0.020, 1.02],
  ], 0.050).translate(0, 0, 0.262));

  /* THE HEART-LANTERN at 1.30, warm orange, with twelve spikes
     standing 0.03 proud. Flat inlay cannot read without textures -
     a spike only registers because it casts its own shadow. */
  /* CHEST LAMES — surface density.

     The reference torso is 20-30 overlapping lames, scales and rivets
     with a near-black separation line between every one. This one was
     3-4 large flat panels: the figure carried the right components at
     the right values and still read as smooth, because the density
     was an order of magnitude off. `figure L p05` was already near
     black, but at the SILHOUETTE EDGE rather than between parts, so
     the upper body fused into one white mass.

     Each lame steps 8mm proud of the one below and overlaps it by
     half its height, so the cavity term darkens the underside of each
     and draws the line. */
  /* Five lames, not seven, and stepped further apart. Seven
     overlapping by half their height stacked ~20 near-parallel face
     pairs into the coplanar assert; the density gain is in the
     SEPARATION LINES, not the count. */
  for (const sx of [-1, 1]) {
    /* Three per side. Ten lames stepping through z are near-parallel
       to EACH OTHER as well as to what is behind them - about 1.5
       coplanar pairs apiece, which is the 15-pair excess over the
       assert's 180. Three still reads as a stack; the density comes
       from the separation lines, not the count. */
    for (let i = 0; i < 3; i += 1) {
      const t = i / 2;
      const y = 1.385 - i * 0.098;
      const inner = 0.058 + t * 0.006;
      const outer = 0.152 - t * 0.028;
      /* FLANKING the plastron, not spanning the chest.

         Spanning lames sat at z 0.219-0.275 against a breastplate
         face at 0.253 - so the lower ones were buried inside it with
         their rear caps parallel to its front, which is what the
         coplanar assert was reporting (196 pairs; 19/19 without
         them). Spanning also puts 0.150 of half-width across a
         reliquary glow that is only 0.060 wide, which would bury the
         character's title feature for the third time.

         The reference has its lames flanking a central plastron. */
      part(torso, "bone", IVORY, kit.extrudeZ([
        [sx * inner, y + 0.028],
        [sx * outer, y + 0.020],
        [sx * (outer * 0.94), y - 0.036],
        [sx * inner, y - 0.030],
      ], 0.024).translate(0, 0, 0.262 + i * 0.016));
    }
  }
  /* No sternum scale bands.

     They sat at z 0.190 - BEHIND the breastplate's 0.253 front face -
     so they were buried, contributing nothing to the picture while
     stacking parallel faces into the coplanar assert. They, not the
     lames, were the 15-pair excess: cutting the lames from ten to six
     moved the count by zero, and the isolation test that implicated
     "the lames" had disabled both blocks at once.

     A band that is invisible AND costs a gate is not worth
     re-placing; the flanking lames carry the density.
     ============================================================ */


  /* GOLD PECTORAL BIB - the largest gold mass above the waist on the
     plate, a long V running collar to belly, and absent from this
     figure entirely. All the gold above the waist was sticks: rims,
     a gorget band and the reliquary mullions. */
  /* `extrudeZ` is Z-CENTRED. At z 0.235 this bib spanned 0.220-0.250
     while the breastplate in front of it (z 0.228, depth 0.050) spans
     0.203-0.253 - so its front face sat 3mm BEHIND the plate and its
     XY outline is inside the breastplate's at every height. It
     rendered ZERO front-hemisphere pixels: added, measured, and
     invisible. The file documents finding this exact bug once before,
     on the breastplate, and then the bib was authored behind it. */
  part(torso, "gold", GOLD, kit.extrudeZ([
    [-0.130, 1.460], [0.130, 1.460],
    [0.062, 1.240], [0.038, 1.100],
    [0.000, 1.055],
    [-0.038, 1.100], [-0.062, 1.240],
  /* 0.238, not 0.283. Correcting the cap winding moved every extruded
     part's visible face from its REAR plane to its front, which
     inverted two pairs in this stack: the bib's face went 0.268 ->
     0.298 and the glow's 0.273 -> 0.293, so the bib now sits 5mm in
     FRONT of the reliquary and covers it completely - the glow's
     half-width is 0.060 against the bib's 0.099 at that height. The
     character's title feature went from 630px to zero.

     At 0.238 the bib's front is 0.253, flush with the breastplate,
     and the stack reads socket 0.280 -> glow 0.293 -> mullions 0.302
     forward, as the comments intend. */
  ], 0.030).translate(0, 0, 0.238));

  /* THE HEART-RELIQUARY at 1.36: a recessed gothic window.

     It was a 0.10m gold ring with eight radiating spikes around a
     flat emissive slab - a sunburst badge, read by three reviews as
     a cartoon asterisk. The reference is a large faceted window
     roughly a third of the chest across, with the glow set BEHIND
     pointed plate petals so the light is occluded and scattered
     rather than shown flat. The petals are what make it read as
     depth: the emissive sits 0.030 further in than the frame, so
     each petal casts across it. */
  const RW = 0.104;
  const RH = 0.150;
  // The recess: a dark socket the window sits inside.
  part(torso, "iron", NEUTRAL_DARK,
    kit.extrudeZ([
      [0, RH * 0.62], [RW * 0.74, RH * 0.30], [RW * 0.74, -RH * 0.34],
      [0, -RH * 0.66], [-RW * 0.74, -RH * 0.34], [-RW * 0.74, RH * 0.30],
    ], 0.036).translate(0, 1.360, 0.262));
  // The glow, set deep so the petals occlude it.
  part(torso, "emissive", LANTERN,
    kit.extrudeZ([
      [0, RH * 0.50], [RW * 0.58, RH * 0.22], [RW * 0.58, -RH * 0.26],
      [0, -RH * 0.54], [-RW * 0.58, -RH * 0.26], [-RW * 0.58, RH * 0.22],
    /* In FRONT of the socket's front face (0.262 + 0.018 = 0.280) and
       behind the mullions at 0.292. Pushed to 0.250 to buy occlusion
       depth it landed inside the socket and the lantern went out -
       the depth has to come from the frame standing proud of it, not
       from burying the source. */
    ], 0.020).translate(0, 1.360, 0.283));
  /* Six petals standing proud of the glow, tips inward. Radial
     SPIKES pointing outward were the asterisk; petals point IN and
     overlap the light, which is what makes a window read as a
     window. */
  /* Two vertical MULLIONS and a pointed arch head - the parts a
     gothic window is actually made of. Six radial petals with their
     tips meeting in the middle read as a daisy, which is the same
     failure as the sunburst asterisk they replaced: radial symmetry
     around a glowing centre is a badge, not a window. */
  for (const mx of [-0.030, 0.030]) {
    part(torso, "gold", GOLD,
      slabC(0.013, RH * 0.98, 0.020, 0.002)
        .translate(mx, 1.360 + RH * 0.46, 0.292));
  }
  // The arch: two raking bars meeting at a point above the glow.
  for (const ax of [-1, 1]) {
    part(torso, "gold", GOLD,
      slabC(0.013, RW * 0.86, 0.020, 0.002)
        .rotateZ(ax * 1.02)
        .translate(ax * RW * 0.30, 1.360 + RH * 0.40, 0.292));
  }
  // A sill under it, so the window sits on something.
  part(torso, "gold", GOLD,
    slabC(RW * 1.42, 0.020, 0.026, 0.003)
      .translate(0, 1.360 - RH * 0.52, 0.288));
  // A brass rim around the socket, so the window has an edge.
  band(torso, "gold", GOLD, [
    { y: 1.360 + RH * 0.60, rx: RW * 0.86, rz: 0.030, sides: 6, phase: 0.2 },
    { y: 1.360 - RH * 0.64, rx: RW * 0.86, rz: 0.030, sides: 6, phase: 0.2 },
  ], { capTop: false, capBottom: false });

  /* No flank panels. At x 0.212 + rx 0.055 they stood 0.025m proud
     of a 0.242m ribcage and read as green cards taped to the sides
     from every angle but dead front. */

  /* Belt and two faulds. Two, not four, and they stop at the hip -
     the previous stack grew to 0.62m across and read as shelving. */
  /* Clear of the fauld beneath. Two capped rings a few millimetres
     apart z-fight, and this engine's rim term lights the resulting
     sliver bright blue - the same defect already on record against
     the cathedral spires. */
  band(root, "gold", GOLD, [
    { y: 1.042, rx: 0.206, rz: 0.162, sides: 8, phase: 0.3927 },
    { y: 1.008, rx: 0.208, rz: 0.164, sides: 8, phase: 0.3927 },
  ]);
  for (let i = 0; i < 1; i += 1) {
    const y = 0.955 - i * 0.055;
    part(root, "bone", IVORY, kit.ringSolid([
      { y: y + 0.040, rx: 0.190 + i * 0.006, rz: 0.148, sides: 9, phase: 0.1 + i * 0.3 },
      { y, rx: 0.196 + i * 0.006, rz: 0.152, sides: 9, phase: 0.1 + i * 0.3 },
      { y: y - 0.020, rx: 0.182 + i * 0.006, rz: 0.142, sides: 9, phase: 0.1 + i * 0.3 },
    ], { capTop: false, capBottom: false }));
  }

  /* NO SIDE TASSETS.

     They have been rebuilt four times - as three shrinking lames, as
     five flaring ones, as a thinned stack tucked inboard - and every
     review has called them the same thing: black paddles, pannier
     baskets, saddlebags. The flat-white silhouette settles it: they
     are two hexagonal slabs jutting from the hips, and they are the
     +115% error at the waist against a plate that reads a clean cone
     there with nothing protruding through it.

     A part that four rounds of reshaping could not make read is a
     part the design does not want. */


  // Gorget: a collar the helm seats into, 1.46 -> 1.56.
  /* The collar is verdigris lamellar on the reference, not plate. */
  part(torso, "verdigris", VERDIGRIS, kit.ringSolid([
    /* capBottom off: this ring's underside faces the camera at any
       low bearing and there is nothing beneath it to occlude it. */
    { y: 1.460, rx: 0.150, rz: 0.132, sides: 8, phase: 0.1 },
    { y: 1.525, rx: 0.128, rz: 0.116, sides: 8, phase: 0.1 },
    { y: 1.560, rx: 0.110, rz: 0.102, sides: 8, phase: 0.1 },
  ], { capTop: false }));
  band(root, "gold", GOLD, [
    { y: 1.500, rx: 0.140, rz: 0.126, sides: 8, phase: 0.1 },
    { y: 1.476, rx: 0.144, rz: 0.130, sides: 8, phase: 0.1 },
  ], { capTop: false, capBottom: false });

  /* No reliquary pack. A 0.23 x 0.26 verdigris slab standing proud
     of the spine read as a licence plate bolted to the back, and it
     is not on the design's own feature list. */

  /* ============================================================
     ARMS
     ============================================================ */

  const armPivots = [];
  const pauldronPivots = [];
  const elbowPivots = [];
  const handPivots = [];
  /* 0.70m of reach. At 0.63m both hands sat within 1% of their
     grips - and an IK target just out of range does not fail
     loudly, it clamps and straightens the limb, so the margin has to
     be real rather than nominal. */
  /* 0.728m of reach. At 0.700 the carry and reload poses sat at 0.96
     and 0.99 of full extension - a locked elbow - and the two
     previous answers were to shrink the clip (which flattened the
     reload to 0.05m of travel) and to slide the mount (which fixed
     one pose by breaking the other). The arm was the short part.
     Longer arms also match the reference, whose knight is notably
     long-limbed. */
  const UPPER = 0.380 * M;
  const FORE = 0.348 * M;

  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    /* 0.242 of ribcage + 0.62 of the arm's own 0.125 radius, so the
       limb's inboard face just touches the chest instead of starting
       inside it. At 0.245 the upper arm spanned x 0.120 to 0.370
       against a ribcage of 0.242: half its width was buried, the
       pauldron covered the rest, and the figure had no arms in its
       silhouette from any of fifteen review images. The grip-reach
       assert passed throughout - both grips sat at a healthy 87
       degree elbow - because reach measures where the hand ENDS, and
       nothing measured whether the limb between could be seen. */
    /* 0.245, not 0.320. Measured on the cathedral plate the
       shoulder span is 0.374 of body height; at 0.320 plus a lame
       reaching 0.21 the render spanned 1.04m on a 1.87m figure -
       0.556, sixty percent over. The 0.320 target came from the same
       fictional "column" that the leg re-cut already had to undo;
       the legs were fixed to the measured reference and the shoulder
       was left on the fiction, so the taper "matched" at 2.07 purely
       because both ends were wrong in opposite directions. */
    shoulder.position.set(s * 0.188, 1.485, 0.020);
    torso.add(shoulder);
    armPivots.push(shoulder);

    const elbow = new THREE.Group();
    elbow.position.set(0, -UPPER, 0);
    shoulder.add(elbow);
    elbowPivots.push(elbow);

    const hand = new THREE.Group();
    hand.position.set(0, -FORE, 0);
    elbow.add(hand);
    handPivots.push(hand);

    /* The pauldron hangs off the TORSO.
       Parented to `shoulder` it rode the arm's IK pivot, and because
       the two hands solve to different grips the two pauldrons sat
       at different rotations in every frame - one fanned forward 45
       degrees while the other rolled back. That asymmetric tumble was
       most of why the shoulders read as an explosion rather than as
       armour. It lags the arm slightly instead of following it. */
    const pauldron = new THREE.Group();
    pauldron.position.set(s * 0.188, 1.545, 0.020);
    torso.add(pauldron);
    pauldronPivots.push({ node: pauldron, arm: shoulder });

    /* Verdigris on the limbs. Round 12 reverted these to bone
       because an "olive share" gate said the figure was 24-41% green
       against a reference band of 2-8% - but that band was measured
       with green-CHANNEL dominance under a saturated orange key,
       which cannot see verdigris at all, and the plate itself scored
       0.0-0.8% while visibly covered in it. Read off the art, the
       reference is 30-48% verdigris. The gate was the thing that was
       wrong, and it cost a round. */
    part(shoulder, "verdigris", VERDIGRIS, kit.ringSolid([
      /* Narrowed so the pauldron can be BROAD. The plate presents a
         wide frontal face over a slim arm; ours had a slim face over
         a thick arm, and the arm was setting the shoulder span. */
      { y: -0.020, rx: 0.098, rz: 0.096, sides: 7, phase: 0.2 },
      { y: -UPPER * 0.55, rx: 0.110, rz: 0.107, sides: 7, phase: 0.2 },
      { y: -UPPER + 0.02, rx: 0.094, rz: 0.092, sides: 7, phase: 0.2 },
    ]));
    part(elbow, "verdigris", VERDIGRIS, kit.ringSolid([
      { y: 0.055, rx: 0.080, rz: 0.078, sides: 6, phase: 0.2 },
      { y: 0.000, rx: 0.100, rz: 0.096, sides: 6, phase: 0.2 },
      { y: -0.055, rx: 0.078, rz: 0.076, sides: 6, phase: 0.2 },
    ]));
    part(elbow, "verdigris", VERDIGRIS, kit.ringSolid([
      { y: -0.048, rx: 0.084, rz: 0.082, sides: 7, phase: 0.2 },
      { y: -FORE * 0.62, rx: 0.074, rz: 0.073, sides: 7, phase: 0.2 },
      { y: -FORE + 0.02, rx: 0.062, rz: 0.061, sides: 7, phase: 0.2 },
    ]));

    /* PAULDRON: three CLOSED shells, 0.035 thick, the top one seated
       0.12m above the joint and hanging 0.28m into open air. Target
       shoulder span 1.04m - they must be the widest thing on the
       model by a clear margin, and every lame is a volume because a
       plane read as a feather from edge-on. */
    for (let l = 0; l < 3; l += 1) {
      /* 0.20m tall and overlapping by more than they drop. At 0.11m
         over a 0.38m span each lame was a pancake, and a 0.075m gap
         between pancakes left sky visible through the shoulder - the
         review read them as a fanned deck of cards. */
      /* Grown downward and moved out. Centred 0.075-0.115m outboard
         of a shoulder at x 0.245 against a ribcage half-width of
         0.242, more than half of every shell was inside the chest -
         and shrinking each lame meant the stack tapered to nothing
         exactly where it should be widest. */
      /* 0.140 tall with a 0.090 drop: 0.050 of overlap, so the three
         steps read. At 0.200 tall with a 0.062 drop they shared 69%
         of their own height and merged into one lump with random cut
         lines where they intersected. */
      const k = 1 + l * 0.13;
      const drop = -l * 0.086;
      const ox = s * (0.008 + l * 0.012);
      /* FLAT ANGULAR PLATES, not lathed domes.

         Four rounds re-tuned the radii of three `ringSolid` heptagons
         and every review still read them as rocks, football pads or
         a pile of shale - because the defect was never the radii. A
         lathe makes a dome; the reference pauldron is a flat plate
         with a straight top edge, a hard leading edge and a pointed
         outer corner, laid over a lamellar strip. No choice of rx/rz
         produces a straight edge or a point, so no amount of tuning
         could have got there.

         Profile is authored in XY and extruded through Z (the plate's
         thickness), then raked outboard so the stack fans over the
         shoulder. */
      const w = (1 + l * 0.08);
      /* Sized to a COLUMN, not a wedge. The reference silhouette is
         near-constant at ~35-40% of body height from shoulder to
         hem; the render measured 74% at the shoulder and 21-27%
         below the belt - a 3:1 taper against the reference's 1:1.
         A first cut of these plates made the shoulder wider still
         (1.393m, 75%), which is the opposite of the defect. */
      /* BROAD across, THIN through. This profile was 0.083 wide by
         0.198 tall and extruded 0.176-0.216 through Z - so the plate's
         mass lay along the extrusion axis and, rotated outboard, the
         front of the figure saw a 0.083m EDGE where the reference
         shows a broad frontal face. That is why the shoulders have
         read as splinters from every bearing for four rounds: not the
         lame count, not the rake, but which axis the plate was
         authored along. */
      const plate = kit.extrudeZ([
        [-0.030, 0.085],                     // inboard top, at the neck
        [0.060 * w, 0.070],                  // straight top edge
        [0.098 * w, -0.014],                 // outer corner, high
        [0.086 * w, -0.098],                 // the point
        [0.046 * w, -0.126],
        [-0.030, -0.092],
      ], 0.055 + l * 0.008);
      /* Raked down and rolled forward so the plate WRAPS the
          shoulder. Rotated only in the coronal plane the plates stuck
          straight out sideways and read as flaps: a pauldron gets its
          mass from covering the joint, not from spanning width. */
      plate.rotateZ(s * (0.46 - l * 0.06));
      // Capped: past ~0.15 the broad face turns away from the viewer
      // again and the axis swap above buys nothing.
      plate.rotateY(s * (0.10 + l * 0.03));
      if (s < 0) plate.scale(-1, 1, 1);
      part(pauldron, "bone", IVORY,
        plate.translate(ox + s * 0.024, 0.028 + drop, -0.014));
      /* A gold rim along the plate's top edge. The reference reads
         its shoulders as bright metal-edged plates; ours had no gold
         above the waist at all, and the plate carries 24.8% of its
         pixels above chroma 45 against our 0.21%. */
      /* Offset in the plate's OWN frame, before the rotations.

         The rim was rotated about the origin by the same angles as
         the plate and then translated by a different WORLD-Y offset -
         but after a 0.3-0.44 rad yaw, world-Y is not the plate's up,
         so the two bodies separated. Measured on the silhouette mask
         the shoulder row spanned 237px carrying only 144px of ink:
         gold bars standing clear of the plate with sky between them,
         which is the "shrapnel" this file records having deleted once
         already. Translate first, rotate after. */
      /* Mirrored like the plate. `plate.scale(-1,1,1)` runs on the
         left side and the rim never got it, so the left bar sat a
         median 28.6mm off its plate against the right's 10.1mm - and
         the connected-components gate passes both, because a bar
         overhanging at one end is still attached. */
      const rim = slabC(0.088 * w, 0.016, 0.055 + l * 0.008, 0.002)
        .translate(0.015 * w, 0.074, 0);
      if (s < 0) rim.scale(-1, 1, 1);
      part(pauldron, "gold", GOLD,
        rim
          .rotateZ(s * (0.46 - l * 0.06))
          /* MATCHING the plate's yaw. This carried 0.30 + 0.07l
             against the plate's 0.10 + 0.03l - a twist of 11.5 to 16
             degrees, which swings each end of the bar ~14mm in Z
             relative to the edge it is meant to sit on, in opposite
             directions. The translate-then-rotate reorder was one of
             two causes; this was the other, and it is why the
             connected-components gate reads 1 while the shoulder is
             still shrapnel: a bar overhanging its plate at one end is
             still topologically attached. */
          .rotateY(s * (0.10 + l * 0.03))
          .translate(ox + s * 0.024, 0.028 + drop, -0.014));

      /* Lamellar under the outermost plate only: small overlapping
         scales, which is what the reference has under its plate and
         what makes the shoulder read as built rather than moulded. */
      if (l === 2) {
        for (let i = 0; i < 3; i += 1) {
          // Same ordering fix: offset in local frame, then rotate.
          part(pauldron, "bone", IVORY,
            slabC(0.046, 0.034, 0.082, 0.004)
              .translate(s * (0.030 + i * 0.020), -0.050 - i * 0.032, 0)
              .rotateZ(s * (0.34 + i * 0.09))
              .translate(0, 0, -0.012));
        }
      }
      /* NO trim hoops on the pauldron.
         An uncapped band at rx 0.200 rimming a lame that ended at
         0.180 interpenetrated it and then hung 0.020m below it in
         open air - three per shoulder, in the darkest ramp on the
         figure. That was the shrapnel. The outline comes from the
         shell's own bottom cap instead. */
    }

    /* GAUNTLET — a mass, not a taper.

       The arm ran shoulder-to-elbow-to-forearm at steadily shrinking
       radii and then ended, so the hand had no volume of its own and
       the whole limb read as a stub that stopped at chest depth. The
       reference's is a big blocky mitt, wider than the forearm it
       hangs off, with a cuff stepping out at the wrist and a visible
       knuckle block - it is the widest thing on the arm and it is
       what makes the limb read as articulated rather than tapered. */
    /* Sized so the widest row stays at the SHOULDER. Enlarging the
       gauntlet gave the arm real mass - correct - but in the carry
       pose it hangs at chest height, and at 0.112 it made mid-chest
       the widest point on the figure: measured, the widest row sat at
       depth 0.38 against a plate that is widest at 0.25 and tapers
       monotonically from there. Still proud of the 0.078 forearm, so
       it still reads as a mitt rather than a taper. */
    // Cuff, stepping OUT from the forearm.
    part(hand, "bone", IVORY,
      slabC(0.090, 0.044, 0.100, 0.008)
        .translate(0, -0.014, 0));
    // The mitt proper.
    part(hand, "bone", IVORY,
      slabC(0.084, 0.112, 0.092, 0.010)
        .translate(0, -0.078, 0.006));
    // Knuckle block, proud of the mitt's front face.
    part(hand, "verdigris", VERDIGRIS,
      slabC(0.078, 0.040, 0.030, 0.006)
        .translate(0, -0.118, 0.052));
    // Thumb, along the inner edge - the one finger big enough to read.
    part(hand, "bone", IVORY,
      slabC(0.030, 0.072, 0.044, 0.006)
        .rotateZ(0.28)
        .translate(-0.058, -0.070, 0.026));
  }

  /* THE BODYGLOVE — the dark layer the plates sit ON.

     `UNDER` has been declared in this file for many rounds with a
     comment explaining what it is for, and referenced nowhere. Its
     absence is why the figure reads as one material: a saturated key
     imposes its own hue and a chroma floor on every surface, so
     components cannot separate by hue or chroma here - and the one
     axis left, VALUE, had nothing dark on the figure to work with.
     The reference gets its separation exactly this way: bright plate
     over near-black recess, at the neck, the armpit and every joint.

     This also gives the figure a NECK, which it has never had - the
     helm sat straight down into the gorget.
     ============================================================ */
  // Neck column, exposed between gorget and helm.
  part(torso, "iron", UNDER, kit.ringSolid([
    { y: 1.470, rx: 0.062, rz: 0.060, sides: 7, phase: 0.2 },
    { y: 1.560, rx: 0.058, rz: 0.056, sides: 7, phase: 0.2 },
  ], { capTop: false, capBottom: false }));
  // Under-shoulder, so the pauldron reads as sitting on something.
  for (const s2 of [-1, 1]) {
    part(torso, "iron", UNDER, kit.ringSolid([
      { y: 1.500, rx: 0.086, rz: 0.082, sides: 6, phase: 0.2 },
      { y: 1.380, rx: 0.078, rz: 0.074, sides: 6, phase: 0.2 },
    ], { capTop: false, capBottom: false }).translate(s2 * 0.185, 0, 0));
  }
  // Waist, between plackart and fauld.
  part(torso, "iron", UNDER, kit.ringSolid([
    { y: 1.010, rx: 0.140, rz: 0.128, sides: 8, phase: 0.3927 },
    { y: 0.940, rx: 0.134, rz: 0.122, sides: 8, phase: 0.3927 },
  ], { capTop: false, capBottom: false }));

  /* ============================================================
     HEAD
     ============================================================ */

  /* Helm 0.19w x 0.26h x 0.24d, 1.56 -> 1.82, flat-topped and
     tapering. NOTHING crosses the faceplate. */
  part(torso, "bone", IVORY, kit.ringSolid([
    /* Seats 40mm INTO the gorget. The collar tops out at y 1.560 with
       rx 0.110 and the helm used to start at the same height with rx
       0.100 - a hard step with no overlap, which reads as a gap where
       the neck should be. */
    /* A MONOLITH. Measured on the plates the helm runs 1.8-2.2 tall
       for its width and about 16% of body height; this one was 0.26
       by 0.212 - an aspect of 1.23, effectively a cube - which is
       why it read as a square box rather than as the tall slab the
       reference has. Narrower and taller, same slit. */
    { y: 1.510, rx: 0.080, rz: 0.078, sides: 6, phase: 0 },
    { y: 1.585, rx: 0.082, rz: 0.080, sides: 6, phase: 0 },
    { y: 1.830, rx: 0.072, rz: 0.070, sides: 6, phase: 0 },
    { y: 1.872, rx: 0.050, rz: 0.048, sides: 6, phase: 0 },
  ]));
  /* Authored CENTRED, then rotated, then moved into place.
     `rotateX` turns geometry about the world origin, so a profile
     authored at y 1.575-1.800 and rotated swung on a 1.7m lever and
     landed at z -0.10 to -0.14 - a loose card hovering ten
     centimetres BEHIND the skull. Nothing was on the face at all;
     what read as a faceplate was the helm prism's own front vertex,
     which put a bright/dark ridge down the centre of the face. That
     ridge is a nose, on a helm the whole design says is blank. */
  part(torso, "bone", IVORY, kit.extrudeZ([
    [-0.085, -0.1125], [0.085, -0.1125], [0.074, 0.1125], [-0.074, 0.1125],
  ], 0.040).rotateX(-0.14).translate(0, 1.6875, 0.104));

  /* The slit. Bezel and light both centred, and the light stands
     9mm PROUD of the bezel - built flush it sat 2.9mm behind the
     bezel's front plane and was sealed inside it, so the one lit
     feature on the figure could never render. */
  part(torso, "iron", NEUTRAL_DARK,
    slabC(0.034, 0.120, 0.022, 0.002)
      .rotateX(-0.14).translate(0, 1.660, 0.116));
  part(torso, "emissive", SLIT_LIGHT,
    slabC(0.012, 0.100, 0.010, 0)
      .rotateX(-0.14).translate(0, 1.665, 0.132));

  // Cheeks, angled off the faceplate.
  for (const s of [-1, 1]) {
    part(torso, "bone", IVORY, kit.extrudeZ([
      [s * 0.078, 1.585], [s * 0.112, 1.612],
      [s * 0.104, 1.772], [s * 0.070, 1.796],
    ], 0.070).translate(0, 0, 0.040));
  }
  // Crest: a thin fin along the crown, raked back. Not a post.
  /* A fin along the crown, 0.20m fore-aft and raked back. After the
     yaw it was 0.085m tall and hung proud of the brow - a paperclip
     rather than a crest. */
  /* rotateY(pi/2) maps local +x onto -z, so a profile whose apex is
     at +x puts the peak at the BACK and slopes it down toward the
     face. Mirrored, and thickened from 0.020 - at three pixels
     across at five metres it was a paperclip, not a crest. */
  part(torso, "gold", GOLD, kit.extrudeZ([
    /* rotateY(pi/2) maps profile +x onto world -z, and the face is
       at +z - so the apex has to be at POSITIVE x to rake backward.
       The last pass mirrored this past correct and it raked forward
       again, silhouetting as a candle. */
    [-0.100, 1.796], [0.150, 1.796], [0.150, 1.840], [0.200, 1.872],
  ], 0.048).rotateY(Math.PI / 2).translate(0, 0, -0.010));

  /* ============================================================
     THE HALO - removed.

     Vesper wore a crescent halo: a large arc rising off the upper
     back and sweeping up and over the crown. It came out of the
     design, and it lived in TWO places, which is the only
     interesting thing about deleting it.

     The arc proper was welded into the Meshy body mesh and weighted
     to Spine, so nothing here could hide it - it is stripped as
     geometry in `scripts/blender/saintfall-vesper-polish.py`, along
     with the rear rail, struts and cross-pins that carried it.

     This block was the second copy: a procedural ivory ribbon on
     `crestPivot`, sitting just outboard of the welded arc and almost
     entirely occluded by it. Hiding the group in a review render
     changed a few hundred pixels, which is why it read as
     insignificant - it was not insignificant, it was BEHIND
     something. With the welded arc gone it would have been the only
     curved thing left on the back, standing on its own.

     `crestPivot` itself is kept, empty. It is a documented review
     target (`hideParts("crest")`), the animation code sways it every
     frame, and the helm crest fin above still wants a mount point.
     Deleting the group would turn all three into null dereferences
     for no gain.
     ============================================================ */

  const crestPivot = new THREE.Group();
  crestPivot.position.set(0.190, 1.430, -0.090);
  crestPivot.rotation.set(0, 0, 0);
  torso.add(crestPivot);

  /* ============================================================
     TABARD

     Front and back panels only, waist to just above the knee, held
     clear of the plate so a shadow line separates cloth from armour.
     Side panels and a below-knee hem are what closed the lower body
     into one solid column with no legs in it.
     ============================================================ */

  const clothPivots = [];
  /* SEPARATE HANGING PANELS, not a closed cone.

     The cone came from a trace taken off the cathedral plate - the one
     v2 plate of three where the robe reaches the ground and hides the
     legs. Because that trace became the reference the model is
     measured against, "no legs" stopped being a defect and became the
     target: the shin measured +55% and the foot +70% against a plate
     that shows bare greave and boot there.

     The traversal plate - the walking, near-level pose the game
     actually renders - has a long gold sash and a bone panel hanging
     separately, with the armoured leg fully visible in the gaps
     between them. Panels, with the side hems lifted so the greave
     shows.
     ============================================================ */
  {
    const pv = new THREE.Group();
    pv.position.set(0, 1.010, 0);
    root.add(pv);
    clothPivots.push(pv);
    /* Front panel full length; two rear-quarter panels lifted to
       mid-thigh so the greave and boot read below them. */
    /* The figure faces +Z, and z = cos(a): u 0.40-0.60 puts a near
       pi, i.e. cos(a) = -1, the BACK. The comment above claimed the
       full-length panel was at the front and the code hung it behind,
       leaving a 72-degree bare gap dead centre front - which is the
       dark board visible between the legs in the leg detail shot.

       The plate hangs both long panels at the FRONT (a gold sash
       front-left to the ankle, a bone panel front-right to the shin)
       and leaves the back open. */
    /* Panels that MEET at the flanks and part at the front.

       Splitting the cone into three separated panels opened the sides
       and the legs read outside the cloth entirely - the silhouette
       went from matching the plate to +77/+95/+73% below the belt.
       The plate's robe closes around the hip and only opens where it
       falls: a long gold sash and a bone panel at the front, the rest
       wrapping continuously, with the greave showing in the front gap
       rather than off the sides. */
    /* Three narrow hanging strips. The previous four "panels that
       MEET at the flanks and part at the front" unioned to the ENTIRE
       circle - 0.84-1.16 plus 0.98-1.16 plus 0.14-0.56 plus 0.54-0.88
       leaves no gap anywhere - and `r0 + r1*v` grew the radius 70%
       from waist to hem, so the robe flared where the plate tapers.
       Measured: ink-fill exactly 1.00 on every row from depth 0.44 to
       0.96, and widths +55/+90/+116% below the belt.

       These leave ~58% of the circumference bare, and r1 drops from
       0.104 to 0.012 so they hang instead of belling. */
    /* Two BROAD front panels, not three narrow strips. The plate's
       lower body is a wide gold sash and a wide bone panel covering
       about 55% of the front with the leg between them - three 0.17m
       strips is less cloth than the plate has, and one of them was on
       the back where the plate leaves it open.

       `drop` also stops above the sabatons: at 1.02 the hem reached
       world y -0.010, below the soles, which corrupted the only
       shape metric in the suite. */
    const PANELS = [
      /* A ~40 degree bare wedge dead centre front. These ran 252->367
         and 0->72 degrees: they OVERLAP by 7.2 and union to a
         continuous 180-degree arc - a closed cone built from two
         sheets instead of a lathe, which is the read the comment
         above was written to prevent. r0 drops so the greave breaks
         the panel edge in three-quarter views. */
      { u0: 0.70, u1: 0.945, drop: 0.88, r0: 0.150, r1: 0.010, gold: true },
      { u0: 0.055, u1: 0.20, drop: 0.80, r0: 0.150, r1: 0.010 },
    ];
    for (const pan of PANELS) {
      part(pv, pan.gold ? "goldCloth" : "cloth", pan.gold ? GOLD_CLOTH : CLOTH_RAMP, sheet(10, 10, (u, v) => {
        const a = lerp(pan.u0, pan.u1, u) * TAU;
        const hem = 1 - 0.04 * Math.abs(Math.sin(u * Math.PI * 3));
        const r = pan.r0 + pan.r1 * v;
        const fold = 1 + (0.010 + 0.022 * v) * Math.cos(u * Math.PI * 5);
        return [
          Math.sin(a) * r * fold,
          -v * pan.drop * hem,
          Math.cos(a) * r * fold * 0.92,
        ];
      }));
    }
  }

  /* ============================================================
     FLUSH
     ============================================================ */

  const weaponMount = new THREE.Object3D();
  weaponMount.name = "weapon-mount";
  weaponMount.position.set(0.062, 1.238, 0.190);
  /* The weapon is authored along +X and the figure faces +Z, so the
     mount needs a quarter turn or the barrel lies straight across
     the chest and out both sides of the ribs. Every authored pose is
     a DELTA from this base. `present` only ever looked plausible
     because a 54-degree roll faked the diagonal from one bearing -
     which is why six front-on review passes never caught it. */
  weaponMount.rotation.y = -Math.PI / 2;
  torso.add(weaponMount);

  /* Every bucket is painted against the FIGURE's full height, not
     its own bounding box. A limb painted 0..1 across its own extent
     gets the same gradient as the torso, and the figure comes out
     striped: each part light at its top and dark at its bottom,
     with no relationship between them. Offsetting by the pivot's
     accumulated height makes one gradient run the whole body. */
  const accY = (node) => {
    let y = 0;
    let n = node;
    while (n && n !== root) { y += n.position.y; n = n.parent; }
    return y;
  };

  let triangles = 0;
  for (const bin of buckets.values()) {
    const geo = kit.merge(bin.geos);
    const base = accY(bin.node);
    /* `bias` lifts a part off the body-wide gradient.
       One gradient across the whole figure is what stops it coming
       out striped - but it also means anything low on the body lands
       in the dark end of its own ramp, so gold at hip height renders
       as brown and a tabard renders as mud. Gold, cloth and the
       lantern say where they sit on their ramp; the plate does not,
       because for the plate the gradient IS the shading. */
    paintByHeight(THREE, geo, bin.ramp, {
      bias: bin.opts.bias ?? 0,
      normalWeight: bin.opts.normalWeight ?? 0.45,
      /* The part's OWN extent carries most of the gradient; the
         body-wide one keeps the figure reading as a single object.
         At localWeight 0 every upper-body part painted out at the
         same value and the armour was invisible regardless of how
         it was modelled - which is why re-sculpting the pauldron in
         four separate rounds never moved the score. */
      /* 0.45. At 0.65 every part ran its own bbox down to the ramp
         floor, so each component carried a full dark-to-light sweep
         and the figure pooled dark. The body-wide gradient carries
         more of it now. */
      localWeight: bin.opts.localWeight ?? 0.45,
      /* The cavity term alone carries the junction darks now. At
         normalWeight 0.62 with a near-black floor the darks landed on
         whole outward-facing faces instead: the pauldron measured 37%
         of its pixels below L30 against the reference's 9.6%, so the
         outer lames dropped out as solid black wedges. Widening the
         trigger and deepening the multiplier puts the black in the
         undercuts and nowhere else. */
      /* 0.72, not 0.45. Halving the ramp position on every face
         tilted past -0.05 catches most chamfers on a low-poly figure,
         not just undercuts - so a large share of the surface sat at
         the ramp floor and the figure's median value was pinned there
         regardless of the light end. A +30 lift in the ramp moved the
         rendered median 3.4 points; this is what was eating it. */
      cavity: bin.opts.cavity ?? 0.72,
      /* No patina blotch. Vertex colours interpolate across large
         flat faces, so a single green vertex dragged a whole 200mm
         plate halfway to green - and the reference has no mottling
         anywhere: every green region on it is a bounded, hard-edged
         panel. Verdigris belongs on named components. */
      patina: null,
      jitter: 0.06,
      // Noise on plate is dirt, not shading, and it fought the one
      // thing the design is asking for: crispness.
      noise: 0.06,
      min: -base,
      max: H * 1.02 - base,
    });
    const mesh = new THREE.Mesh(geo, materials[bin.matName] || materials.iron);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bin.node.add(mesh);
    triangles += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  }

  void rng;
  void PALETTE;
  return {
    root, chest, legPivots, kneePivots, armPivots, elbowPivots, handPivots,
    pauldronPivots,
    weaponMount, crestPivot, clothPivots, triangles: Math.round(triangles),
    armBindQuaternions: armPivots.map((joint) => joint.quaternion.clone()),
    elbowBindQuaternions: elbowPivots.map((joint) => joint.quaternion.clone()),
    handBindQuaternions: handPivots.map((joint) => joint.quaternion.clone()),
    limb: { upper: UPPER, fore: FORE, thigh: THIGH, shin: SHIN, ankle: ANKLE_H },
  };
}

/* ============================================================
   VESPER RELIQUARY PLAYER ASSET

   The procedural knight above remains a deliberate failure-safe: a
   network or cache error must not make the level unplayable.  The
   authored path below preserves the exact figure contract used by
   terrain IK, weapons and QA, but supplies those controls with a real
   skinned mesh and named humanoid bones.
   ============================================================ */

/* Public only as a FIGURE factory. Encounter modules may borrow the same
   authored Reliquary silhouette without constructing a second player
   controller (and therefore without installing another input/camera stack). */
export async function buildVesperTrooper(ctx) {
  const { THREE, atmos } = ctx;
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const loader = new GLTFLoader();
  const url = new URL(
    "../../../assets/models/saintfall/vesper/vesper-reliquary-player.glb",
    import.meta.url
  );
  /* Version the MODEL too, not just the modules.
     `new URL(relative, base)` does not inherit the base's query, so
     resolving against `import.meta.url` - which boot.js versions -
     produced a bare .glb path. Every module could be reloaded while
     the browser kept serving a cached mesh, which is precisely the
     failure that makes a model edit look like it did nothing. */
  if (ctx.build) url.searchParams.set("v", ctx.build);
  const gltf = await loader.loadAsync(url.href);
  const root = gltf.scene;
  root.name = "trooper";
  // A restrained lift puts boots-to-helm at 1.90m. This used to be
  // described in terms of the reliquary arc's apex; the arc is gone
  // and the helm is now the top of the figure.
  root.scale.setScalar(1.055);

  let triangles = 0;
  const partMeshes = [];
  const readabilityMaterials = [];
  const seenMaterials = new Set();
  root.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return;
    partMeshes.push(child);
    const geometry = child.geometry;
    triangles += (geometry.index
      ? geometry.index.count
      : geometry.attributes.position.count) / 3;
    const source = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of source) {
      if (!material) continue;
      material.roughness = material.roughness ?? 0.48;
      material.metalness = material.metalness ?? 0.24;
      material.envMapIntensity = 1.12;
      // The generated mesh still contains a few intentional apertures;
      // retain double-sided shading until those openings are split into
      // semantic submeshes rather than hiding them with a blanket fill.
      material.side = THREE.DoubleSide;
      if (material.name !== "vesper-reliquary-amber" && !seenMaterials.has(material.uuid)) {
        seenMaterials.add(material.uuid);
        /* Player-only readability floor.  Dusk and night preserve a
           dramatic world grade, but a near-black torso is unusable in
           a third-person game.  A very low emission restores plate
           separation without flattening the scene with global fill or
           making the knight look self-lit in daylight.

           WARM, not cool. This was 0x101a32 - a blue - chosen back
           when the armour was ivory and verdigris and a cold fill
           read as moonlight on the plate. On a white-and-gold figure
           it does the one thing the palette cannot afford: it lands
           in the darks, where the base colour is weakest, and turns
           every shadowed panel toward grey.

           Matched in LUMINANCE to the blue it replaces, not merely
           re-hued. The first warm value was 0x2b1f0e, which is 26%
           brighter than 0x101a32 - and because this fill is added
           everywhere, including where the albedo is near zero, that
           26% landed straight on the figure's darkest 5%. It took
           the plate's p05 from 11 to 15 and the junctions stopped
           reading. Hue is the change being made here; value is not. */
        if (material.emissive) material.emissive.set(0x1e1509);
        if (material.name === "vesper-atlas") material.emissiveMap = null;
        material.emissiveIntensity = 0.02;
        material.userData.vesperReadability = material.name === "vesper-dark-iron"
          ? 0.24 : (material.name === "vesper-atlas" ? 0.20 : 0.14);
        readabilityMaterials.push(material);
      }
      patchMaterial(material, atmos, {
        rim: material.name === "vesper-reliquary-amber" ? 1.6 : 1.34,
        glitter: 0,
      });
    }
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = true;
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius *= 1.35;
  });

  const need = (name) => {
    const node = root.getObjectByName(name);
    if (!node) throw new Error(`Vesper rig is missing required bone "${name}"`);
    return node;
  };
  const chest = need("Spine");
  const head = need("Head");

  // The controller indexes limbs by spatial side (-X first), not by
  // anatomical label.  Meshy's Right bones sit at -X in the bind pose.
  const legPivots = [need("RightUpLeg"), need("LeftUpLeg")];
  const kneePivots = [need("RightLeg"), need("LeftLeg")];
  const footPivots = [need("RightFoot"), need("LeftFoot")];
  const toePivots = [need("RightToeBase"), need("LeftToeBase")];
  /* Role order, not mesh-file order: support hand first, trigger
     hand second.  Meshy's anatomical Right bones sit at -X, so the
     former [Right, Left] array made the trigger arm reach past the
     front hand and hid both forearms in the chest/weapon cluster. */
  const armPivots = [need("LeftArm"), need("RightArm")];
  const elbowPivots = [need("LeftForeArm"), need("RightForeArm")];
  const handPivots = [need("LeftHand"), need("RightHand")];
  const palmLocators = handPivots.map((hand, index) => {
    const palm = new THREE.Object3D();
    palm.name = index === 0 ? "LeftPalmContact" : "RightPalmContact";
    /* The imported armature carries a 0.01 unit scale (the skinned
       vertices are authored in centimetres). Runtime posed-vertex
       measurement puts the gauntlet surface centroid 11.7cm from the
       wrist, so 11 bone units resolves to its actual palm socket after
       the authored root's 1.055 gameplay scale. */
    palm.position.set(0, 11.0, 0);
    hand.add(palm);
    return palm;
  });

  root.updateMatrixWorld(true);
  const worldA = new THREE.Vector3();
  const worldB = new THREE.Vector3();
  const jointDistance = (a, b) => {
    a.getWorldPosition(worldA);
    b.getWorldPosition(worldB);
    return worldA.distanceTo(worldB);
  };

  // Author the mount in model space, then reparent it to the live chest
  // bone while preserving its world transform.  This keeps every weapon
  // and grip anchor already used by the combat system.
  const weaponMount = new THREE.Object3D();
  weaponMount.name = "weapon-mount";
  weaponMount.position.set(0.068, 1.34, 0.218);
  weaponMount.rotation.y = -Math.PI / 2;
  root.add(weaponMount);
  root.updateMatrixWorld(true);
  chest.attach(weaponMount);
  root.updateMatrixWorld(true);

  /* ============================================================
     EYE SOCKETS

     The mask's face is two flat facets meeting at a centre crease,
     and its eyes are PAINTED into `vesper-atlas` - a pair of dark
     blobs about 10x14mm. There is no recess to light and no separate
     submesh to make emissive, so the glow has to arrive as geometry
     sitting just proud of each facet.

     Authored in HEAD-LOCAL units, which is what makes this survive
     the head aim: attaching to the bone means the mount rides every
     rotation `applyFigurePose` puts on the neck. The rig carries a
     0.01055 world scale (its skin is authored in centimetres), so a
     metre is ~94.8 of these units - hence the scale on the mesh,
     which converts the metre-authored lozenge back down.

     The positions were found by rendering the head, clustering the
     darkest pixels on it, and unprojecting each cluster back onto
     the skin - all inside one frame, which is the only part of this
     that is easy to get wrong. Aiming a ray along a FIGURE-space
     direction measured in some other frame does not work: the head
     yaws under `applyFigurePose`, so the ray misses the face and
     returns a perfectly plausible hit on the side of the helm, 25mm
     outboard and edge-on to the camera.

     Height and depth are the pair's mean and x stays per-side; the
     two hits differ by ~2mm, which is blob-centroid noise on a 10mm
     target, not a crooked mask. The lozenges are squared to a
     Y-free normal for the same reason - each cluster's average
     normal picks up the brow bevel above the socket and tips ~18
     degrees skyward, while the facet the socket is painted on is
     vertical. */
  const eyeUnit = 1 / head.getWorldScale(new THREE.Vector3()).x;
  /* Points top and bottom, flats to the sides - the chest reliquary
     is a diamond and the reading the user asked for is that these
     belong to it. 11mm across by 15mm tall covers the painted blob
     with just enough spill to read as light escaping a socket. */
  const lozenge = new THREE.CircleGeometry(0.0062, 6, Math.PI / 2);
  lozenge.scale(1, 1.16, 1);
  /* A hot core, falling off to the rim. `CircleGeometry` is a
     triangle fan around a single centre vertex, so one attribute
     buys a radial gradient for free - no extra texture and no extra
     geometry. Without it the socket is a slab of one value, and a
     value bright enough to bloom is bright enough to tone-map to
     white across its whole area, which loses the yellow entirely.
     The rim deliberately lands just under the bloom threshold so
     the halo comes off the centre only. */
  {
    const count = lozenge.attributes.position.count;
    const shade = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const level = i === 0 ? 1 : 0.38;
      shade[i * 3] = level;
      shade[i * 3 + 1] = level;
      shade[i * 3 + 2] = level;
    }
    lozenge.setAttribute("color", new THREE.BufferAttribute(shade, 3));
  }
  const eyeMaterial = new THREE.MeshStandardMaterial({
    name: "vesper-eye-glow",
    /* Dark base, bright emissive. Lit by albedo alone this would be
       a pale plate stuck on the face; the socket has to stay a hole
       that light comes out of, so the diffuse term is nearly black
       and everything visible is emission. */
    color: 0x3b2a0d,
    emissive: 0xffc23c,
    emissiveIntensity: 4.2,
    roughness: 0.34,
    metalness: 0,
    side: THREE.FrontSide,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  /* Vertex colour reaches `diffuseColor` on its own; emission is
     what actually needs the gradient here, so carry it across by
     hand. Set BEFORE `patchMaterial`, which chains rather than
     replaces whatever hook it finds. */
  eyeMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.r;");
  };
  // Same atmospheric fade as the rest of the figure, or the eyes
  // would stay hot at range while the body they sit on washes out.
  patchMaterial(eyeMaterial, atmos, { rim: 0, glitter: 0 });
  /* 3mm of standoff, in head units. 1.5mm was not enough: squaring
     the lozenge to a Y-free normal leaves it up to ~12 degrees off
     the facet it sits on, which buries the top corner of a 14mm
     shape by about 1.5mm and cropped both eyes into pentagons. */
  const eyeStandoff = 0.003 * eyeUnit;
  const eyeNormal = new THREE.Vector3(0.700, 0, 0.714);
  /* Four lamps down each side of the mask. Every position was
     measured by depth-mapping the facet - firing along its normal
     over a grid and reading where the surface came back - so these
     are surface points, and the standoff above is added along the
     normal at build time. Side is taken from the sign of x.

     The row at 9.4 is the one that sits INSIDE something. The mask
     carries a real recess there, 30x32mm and about 9.5mm deep, and
     these two are placed on its floor rather than on the shelf
     around it: the depth map finds them as cells sitting 0.9 units
     behind their own row's outboard shelf. They are 1.22x the
     others because a lamp at the bottom of a well shows less of
     itself, and because the socket around them is bigger.

     The mask is NOT symmetric - the brow pair sits at x -3.80 and
     +3.08, a 5.5mm offset - so both sides are measured rather than
     one side mirrored. */
  const faceLights = [
    { p: [-3.80, 14.93, 0.40], size: 1.00, name: "vesper-eye-left" },
    { p: [3.08, 14.93, 0.40], size: 1.00, name: "vesper-eye-right" },
    { p: [-3.16, 9.37, 2.00], size: 1.22, name: "vesper-socket-left" },
    { p: [2.68, 9.53, 2.09], size: 1.22, name: "vesper-socket-right" },
    { p: [-5.43, 6.40, 2.06], size: 1.00, name: "vesper-cheek-left-upper" },
    { p: [5.08, 6.40, 2.44], size: 1.00, name: "vesper-cheek-right-upper" },
    { p: [-5.95, 3.60, 2.59], size: 1.00, name: "vesper-cheek-left-lower" },
    { p: [5.80, 3.60, 3.17], size: 1.00, name: "vesper-cheek-right-lower" },
  ];
  /* Baked into ONE geometry rather than eight meshes on the bone.
     They never move relative to each other or to the head, they
     share a material, and they are on screen every frame of a
     third-person game - eight draw calls for eight lozenges of six
     triangles each is the kind of cost that is invisible until it
     is added to everything else on the figure. Positions are
     authored in head-local units, so baking is just composing each
     transform into the geometry before merging. */
  const eyeGeometry = (() => {
    const forward = new THREE.Vector3(0, 0, 1);
    const parts = faceLights.map(({ p, size }) => {
      const normal = eyeNormal.clone().setX(eyeNormal.x * Math.sign(p[0]));
      const part = lozenge.clone();
      part.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(p[0], p[1], p[2]).addScaledVector(normal, eyeStandoff),
        new THREE.Quaternion().setFromUnitVectors(forward, normal),
        new THREE.Vector3().setScalar(eyeUnit * size)));
      return part;
    });
    const stride = lozenge.attributes.position.count;
    const merged = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "uv", "color"]) {
      const size = lozenge.attributes[name].itemSize;
      const data = new Float32Array(stride * parts.length * size);
      parts.forEach((part, i) => data.set(part.attributes[name].array, i * stride * size));
      merged.setAttribute(name, new THREE.BufferAttribute(data, size));
    }
    const index = [];
    parts.forEach((part, i) => {
      for (const v of part.index.array) index.push(v + i * stride);
    });
    merged.setIndex(index);
    merged.computeBoundingSphere();
    for (const part of parts) part.dispose();
    lozenge.dispose();
    return merged;
  })();
  const eyeMesh = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eyeMesh.name = "vesper-face-lights";
  eyeMesh.castShadow = false;
  eyeMesh.receiveShadow = false;
  head.add(eyeMesh);
  const eyeMeshes = [eyeMesh];

  // The breast reliquary is an actual light source in the concept.
  // A small shadowless point light keeps the ivory/patina planes
  // legible during Vespers and the Long Dark without flattening the
  // level with global fill or adding another shadow render.
  const heartLight = new THREE.PointLight(0xffaa52, 0.16, 1.55, 2);
  heartLight.name = "vesper-heart-light";
  /* The crest was replaced by a near-flush amber inlay.  Keep the
     shadowless glow just ahead of that surface instead of leaving the
     light floating where the old 9cm chest prow used to end. */
  heartLight.position.set(0, 1.34, 0.235);
  heartLight.castShadow = false;
  root.add(heartLight);
  root.updateMatrixWorld(true);
  const torsoUpLocal = new THREE.Vector3(0, 1, 0)
    .transformDirection(chest.matrixWorld.clone().invert());

  return {
    root,
    chest,
    head,
    legPivots,
    kneePivots,
    footPivots,
    toePivots,
    armPivots,
    elbowPivots,
    handPivots,
    palmLocators,
    pauldronPivots: [],
    weaponMount,
    crestPivot: null,
    clothPivots: [],
    triangles: Math.round(triangles),
    limb: {
      upper: jointDistance(armPivots[0], elbowPivots[0]),
      fore: jointDistance(elbowPivots[0], handPivots[0]),
      thigh: jointDistance(legPivots[0], kneePivots[0]),
      shin: jointDistance(kneePivots[0], footPivots[0]),
      ankle: 0.118,
    },
    legLengths: [0, 1].map((i) => ({
      thigh: jointDistance(legPivots[i], kneePivots[i]),
      shin: jointDistance(kneePivots[i], footPivots[i]),
    })),
    armLengths: [0, 1].map((i) => ({
      upper: jointDistance(armPivots[i], elbowPivots[i]),
      fore: jointDistance(elbowPivots[i], handPivots[i]),
    })),
    /* Posed skin audit, not a bind-bone estimate: the rendered
       gauntlet surface sits 11.7cm from the wrist. Put the wrist that
       far short of the shaft so the visible palm wraps the contact. */
    handGripInset: 0.116,
    /* The trigger wrist approaches the under-haft control grip from
       outboard and BELOW.  The vector runs from grip to wrist in
       figure space.

       It used to point outboard and above, (1, 0.8, 0), which put the
       wrist 7cm higher than the thing it was holding. On a grip that
       already sat behind the shoulder that produced the one silhouette
       an armed figure must never have - wrist above elbow, forearm
       swung out from the body like a wing. Coming from underneath is
       also simply how a hand takes an under-haft grip: fingers curl up
       around it, and the forearm arrives from a lower elbow. */
    triggerWristOffsetLocal: new THREE.Vector3(0.85, -0.62, 0.18).normalize(),
    legBindQuaternions: legPivots.map((joint) => joint.quaternion.clone()),
    kneeBindQuaternions: kneePivots.map((joint) => joint.quaternion.clone()),
    /* The ARMS need these for the same reason the legs do, and not
       having them was a real defect - see `resetArmsToBind`. */
    armBindQuaternions: armPivots.map((joint) => joint.quaternion.clone()),
    elbowBindQuaternions: elbowPivots.map((joint) => joint.quaternion.clone()),
    handBindQuaternions: handPivots.map((joint) => joint.quaternion.clone()),
    imported: true,
    assetSource: "vesper-reliquary-player.glb",
    partMeshes,
    heartLight,
    eyeGlow: { meshes: eyeMeshes, material: eyeMaterial },
    readabilityMaterials,
    torsoUpLocal,
    baseScale: root.scale.clone(),
    chestBindQuaternion: chest.quaternion.clone(),
    headBindQuaternion: head.quaternion.clone(),
    weaponBindPosition: weaponMount.position.clone(),
    weaponBindQuaternion: weaponMount.quaternion.clone(),
    armAxis: new THREE.Vector3(0, 1, 0),
    legAxis: new THREE.Vector3(0, 1, 0),
    /* The imported gauntlet's visible palm plane leads its hand bone
       slightly toward figure-forward. Counter-roll the two relaxed
       wrists symmetrically so the palms settle toward the thighs. */
    freeHandPalmTurn: THREE.MathUtils.degToRad(35),
  };
}

async function buildTrooper(ctx) {
  try {
    return await buildVesperTrooper(ctx);
  } catch (error) {
    console.warn("[saintfall] Vesper player asset failed; using procedural fallback", error);
    const fallback = buildProceduralTrooper(ctx);
    fallback.imported = false;
    fallback.assetSource = "procedural-fallback";
    fallback.baseScale = fallback.root.scale.clone();
    return fallback;
  }
}

/* A parallel world may supply a different playable BODY without
   changing the Reliquary factory used by Vesper encounters. The
   controller contract stays identical, and a failed planet-specific
   asset still degrades to the proven procedural figure rather than
   booting the level with no player at all. */
async function buildPlayerTrooper(ctx) {
  if (typeof ctx.playerFigureFactory !== "function") return buildTrooper(ctx);
  try {
    return await ctx.playerFigureFactory(ctx);
  } catch (error) {
    const label = ctx.playerFigureName || "custom";
    console.warn(`[saintfall] ${label} player asset failed; using procedural fallback`, error);
    const fallback = buildProceduralTrooper(ctx);
    fallback.imported = false;
    fallback.assetSource = "procedural-fallback";
    fallback.baseScale = fallback.root.scale.clone();
    return fallback;
  }
}

/* Encounter-safe public figure factory. Unlike `createPlayer`, this installs
   no input, camera, movement or targeting systems; unlike the raw GLB helper,
   it preserves the procedural fallback that keeps the game playable when the
   authored asset cannot be fetched. */
export async function buildReliquaryFigure(ctx) {
  return buildTrooper(ctx);
}

/* ============================================================
   INPUT
   ============================================================ */

function makeInput(canvas, captureMeleeAim = null) {
  const keys = new Set();
  const state = {
    clock: 0,
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    /* `sprint` survives only as the TOUCH stick's full-tilt flag. On
       the keyboard there is no sprint any more: the trooper travels
       at what used to be sprint speed all the time, and Shift became
       the boost. A separate speed for holding a key was a tax on
       crossing two kilometres of open basin. */
    sprint: false,
    boostHeld: false,
    meleeHeld: false,
    furnaceHeld: false,
    jump: false,
    jumpPressed: false,
    jetpack: false,
    block: false,
    crouch: false,
    locked: false,
    injected: null,
    firing: false,
    ads: false,
    reload: false,
    /* Edge-triggered events, drained once per frame by whoever
       consumes them. Level-triggered flags lose a keypress that
       starts and ends inside one frame, which at 300fps is most of
       the short ones - and a dropped stratagem direction is the
       difference between an orbital lance and "CODE REJECTED". */
    events: [],
  };
  const mouse = { firing: false, ads: false, furnace: false };
  const touch = {
    moveActive: false,
    move: { x: 0, y: 0 },
    sprint: false,
    boostHeld: false,
    melee: false,
    crouch: false,
    jetpack: false,
    block: false,
    firing: false,
    furnace: false,
    ads: false,
  };

  function setTouchMove(x, y, active = true) {
    touch.moveActive = !!active;
    touch.move.x = clamp(Number(x) || 0, -1, 1);
    touch.move.y = clamp(Number(y) || 0, -1, 1);
    touch.sprint = touch.moveActive && Math.hypot(touch.move.x, touch.move.y) >= 0.82;
    return { x: touch.move.x, y: touch.move.y, sprint: touch.sprint };
  }

  function addTouchLook(x, y) {
    state.look.x += Number(x) || 0;
    state.look.y += Number(y) || 0;
  }

  function setTouchHold(name, held) {
    if (!Object.prototype.hasOwnProperty.call(touch, name) || name === "move") return false;
    touch[name] = !!held;
    if (name === "firing") state.firing = touch.firing || mouse.firing;
    if (name === "ads") state.ads = touch.ads || mouse.ads;
    return touch[name];
  }

  function pressTouch(type, detail = {}) {
    if (type === "jump") {
      state.jumpPressed = true;
      return true;
    }
    if (type === "melee" && !Number.isFinite(detail.aimYaw)) {
      const aimYaw = captureMeleeAim?.();
      state.events.push({ type, ...detail, aimYaw });
    } else {
      state.events.push({ type, ...detail });
    }
    return true;
  }

  function clearTouch() {
    touch.moveActive = false;
    touch.move.x = 0;
    touch.move.y = 0;
    touch.sprint = false;
    touch.melee = false;
    touch.jetpack = false;
    touch.block = false;
    touch.firing = false;
    touch.furnace = false;
    touch.ads = false;
    state.firing = mouse.firing;
    state.furnaceHeld = mouse.furnace;
    state.ads = mouse.ads;
  }

  /* A modal sequence can hold the simulation while DOM listeners keep
     collecting input. Flush every level- and edge-triggered channel at
     handoff so the first playable frame never inherits a held fire,
     jump or movement command from the cinematic. */
  function clearAll() {
    keys.clear();
    mouse.firing = false;
    mouse.ads = false;
    mouse.furnace = false;
    state.injected = null;
    state.move.x = 0;
    state.move.y = 0;
    state.look.x = 0;
    state.look.y = 0;
    state.sprint = false;
    state.boostHeld = false;
    state.meleeHeld = false;
    state.furnaceHeld = false;
    state.jump = false;
    state.jumpPressed = false;
    state.jetpack = false;
    state.block = false;
    state.crouch = false;
    state.firing = false;
    state.ads = false;
    state.reload = false;
    state.events.length = 0;
    clearTouch();
  }

  const ownsKeyboard = () => state.locked || document.activeElement === canvas
    || document.documentElement.classList.contains("sf-maximised");
  const isInteractiveKeyTarget = (target) => target instanceof Element
    && !!target.closest("button, a, input, select, textarea, [contenteditable='true'],"
      + " [role='button'], [role='menuitem'], [role='tab']");
  const onKey = (e, down) => {
    const k = e.code;
    const held = keys.has(k);
    /* The game lives inside a larger, keyboard-navigable page. Only claim
       gameplay keys after the canvas owns interaction or in max-screen mode.
       Keyup still clears a key captured earlier, even if ownership was lost. */
    if (down && (!ownsKeyboard() || e.defaultPrevented || isInteractiveKeyTarget(e.target))) return;
    if (down) keys.add(k); else keys.delete(k);
    /* A keyup that belongs to a focused control must retain the browser's
       native Space/Enter click. We still deleted a previously held gameplay
       key above, but only claimed keyup when that key was actually ours. */
    if (!down && (!held || e.defaultPrevented || isInteractiveKeyTarget(e.target))) return;
    if (!down && !ownsKeyboard()) return;
    /* Swallow the page's own use of anything the player has BOUND,
       not a frozen literal list: a scheme that moves Vault onto "/"
       must not also scroll the article behind the canvas. Arrow keys
       stay here unconditionally - they scroll whether or not they are
       currently a movement key. */
    if (boundCodes.has(k) || k.startsWith("Arrow")) e.preventDefault();
    if (!down || held) return;                 // key REPEATS are not presses
    /* MELEE IS AN ACTION, NOT A MODE.
       One key, one swing: main.js takes the rite over for the length
       of the animation and hands it back. */
    if (keybindMatches("melee", k) || k === "KeyQ" || k === "KeyF") {
      /* Bind the swing to the reticle that existed at keydown. The
         event is drained after player.update(), so sampling there
         would let mouse-look during the same frame silently redirect
         an attack the player already committed. */
      state.events.push({ type: "melee", aimYaw: captureMeleeAim?.() });
    }
    else if (keybindMatches("stratagems", k)) state.events.push({ type: "stratOpen" });
    else if (keybindMatches("vent", k)) state.events.push({ type: "vent" });
    /* BOOST IS ONE KEY. Tapped it is a burst, held it is a glide, and
       held with Vault it is the jetpack - which is the whole reason it
       can also be the burst. The command wheel is owned by ui.js, so
       this file only swallows that key. */
    else if (keybindMatches("boost", k)) {
      state.events.push({ type: "boost" });
    }
    else if (keybindMatches("jump", k)) state.jumpPressed = true;
  };
  /* Cached because onKey runs on every keystroke the page sees, most
     of which are not ours. Rebuilt whenever the Controls page writes. */
  let boundCodes = keybindCodes();
  onKeybindsChange(() => { boundCodes = keybindCodes(); });
  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));
  window.addEventListener("blur", () => {
    keys.clear();
    state.jumpPressed = false;
    state.jetpack = false;
    state.boostHeld = false;
    state.meleeHeld = false;
    state.furnaceHeld = false;
    clearTouch();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTouch();
  });

  canvas.addEventListener("click", () => {
    if (!state.locked && canvas.requestPointerLock) {
      try {
        const lock = canvas.requestPointerLock();
        lock?.catch?.(() => false);
      } catch (_) { /* pointer-lock policy is browser-owned */ }
    }
  });
  document.addEventListener("pointerlockchange", () => {
    state.locked = document.pointerLockElement === canvas;
  });
  window.addEventListener("mousemove", (e) => {
    if (!state.locked) return;
    state.look.x += e.movementX;
    state.look.y += e.movementY;
  });
  window.addEventListener("mousedown", (e) => {
    if (!state.locked || e.defaultPrevented) return;
    if (e.button === 0) { mouse.firing = true; state.firing = true; }
    if (e.button === 1) { mouse.furnace = true; state.furnaceHeld = true; }
    if (e.button === 2) { mouse.ads = true; state.ads = true; }
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) { mouse.firing = false; state.firing = touch.firing; }
    if (e.button === 1) { mouse.furnace = false; state.furnaceHeld = touch.furnace; }
    if (e.button === 2) { mouse.ads = false; state.ads = touch.ads; }
  });
  window.addEventListener("contextmenu", (e) => {
    if (state.locked) e.preventDefault();
  });
  window.addEventListener("blur", () => {
    mouse.firing = false;
    mouse.ads = false;
    mouse.furnace = false;
    state.firing = false;
    state.furnaceHeld = false;
    state.ads = false;
  });

  return {
    state,
    keys,
    poll() {
      if (state.injected) {
        state.move.x = state.injected.x;
        state.move.y = state.injected.y;
      } else if (touch.moveActive) {
        state.move.x = touch.move.x;
        state.move.y = touch.move.y;
      } else {
        state.move.x = (keybindDown(keys, "moveRight") ? 1 : 0)
          - (keybindDown(keys, "moveLeft") ? 1 : 0);
        state.move.y = (keybindDown(keys, "moveBack") ? 1 : 0)
          - (keybindDown(keys, "moveForward") ? 1 : 0);
      }
      const boostHeld = keybindDown(keys, "boost");
      const meleeHeld = keybindDown(keys, "melee") || keys.has("KeyQ") || keys.has("KeyF");
      const furnaceHeld = keybindDown(keys, "furnace") || mouse.furnace;
      state.sprint = touch.sprint;
      state.boostHeld = boostHeld || touch.boostHeld;
      state.meleeHeld = meleeHeld || touch.melee;
      state.furnaceHeld = furnaceHeld || touch.furnace;
      state.crouch = false;
      state.jump = keybindDown(keys, "jump");
      state.jetpack = (state.jump && boostHeld) || touch.jetpack;
      state.block = keybindDown(keys, "block") || touch.block;
      const lx = state.look.x;
      const ly = state.look.y;
      const jumpPressed = state.jumpPressed;
      state.jumpPressed = false;
      state.look.x = 0;
      state.look.y = 0;
      return { lx, ly, jumpPressed };
    },
    /** Drain the edge-triggered queue. */
    drain() {
      const out = state.events.slice();
      state.events.length = 0;
      return out;
    },
    inject(x, y) { state.injected = (x === null ? null : { x, y }); },
    touch,
    setTouchMove,
    addTouchLook,
    setTouchHold,
    pressTouch,
    clearTouch,
    clearAll,
  };
}

/* ============================================================
   CONTROLLER
   ============================================================ */

export async function createPlayer(ctx, canvas) {
  const { THREE, scene, terrain } = ctx;
  const figure = await buildPlayerTrooper(ctx);
  scene.add(figure.root);

  /* THE HEART LAMP RIDES THE SCENE, NOT THE RIG. The drop cinematic
     hides the whole figure until the egress beat, and three collects
     lights with traverseVisible - so a lamp inside the hidden rig is
     missing from every program the boot warm-up compiles, and the
     frame that reveals the trooper changes the scene's visible light
     count and re-keys EVERY lit material in the level. On
     Windows/ANGLE that recompile is a multi-second freeze - and it
     silently invalidates the warm-up for everything still hidden, so
     each boss paid it again on its own reveal frame. Same pattern as
     the Aegis lamps, the Apostate's authored lights and the
     undercroft lamps: the light itself is scene-parented and
     permanently counted, a socket keeps the authored position on the
     rig, and the pose driver pins the lamp to the socket every frame
     (and drives it dark whenever the figure itself is hidden - free
     camera, first person - where the old rig-parented lamp simply
     vanished with the body). */
  let heartSocket = null;
  if (figure.heartLight && figure.heartLight.parent) {
    const source = figure.heartLight;
    heartSocket = new THREE.Object3D();
    heartSocket.name = "vesper-heart-socket";
    heartSocket.position.copy(source.position);
    heartSocket.quaternion.copy(source.quaternion);
    source.parent.add(heartSocket);
    source.parent.remove(source);
    scene.add(source);
  }

  /* Doctrine owns one additive presentation channel on the figure.
     It deliberately borrows the reliquary light and the emissive
     materials that are already updated below: no extra point lights,
     no transient meshes and, most importantly, no transforms that can
     fight locomotion, IK, recoil or authored action poses.

     Colours follow the five Orders' menu accents, but are pulled back
     from full neon so a proc reads as the same lamp changing character,
     rather than as a different effect pasted over the trooper. */
  const doctrineColours = {
    censer: new THREE.Color(0xf0b84c),
    procession: new THREE.Color(0xdf8542),
    wing: new THREE.Color(0x58b8c9),
    halo: new THREE.Color(0x7898d5),
    edict: new THREE.Color(0x76ad78),
  };
  const doctrineGlow = {
    colour: new THREE.Color(0xf0b84c),
    level: 0,
    peak: 0,
    attackRemaining: 0,
    decayRate: 12,
    reducedMotion: false,
  };
  const doctrineHeartBase = figure.heartLight?.color?.clone() || null;
  const doctrineEyeBase = figure.eyeGlow?.material?.emissive?.clone() || null;
  const doctrineReadabilityBase = figure.readabilityMaterials
    ? figure.readabilityMaterials.map((material) => material.emissive?.clone() || null)
    : [];
  const systemReducedMotion = typeof window !== "undefined"
    && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  /**
   * Briefly key the trooper's existing emissive rig to a Doctrine Order.
   * `duration` controls the visible decay rather than gameplay timing.
   * Returns false for an unknown Order or a zero-strength request.
   */
  function pulseDoctrine(order, strength = 0.7, duration = 0.42) {
    if (!Object.hasOwn(doctrineColours, order)) return false;
    const colour = doctrineColours[order];
    const numericStrength = Number.isFinite(strength) ? strength : 0;
    const numericDuration = Number.isFinite(duration) ? duration : 0.42;
    if (!Number.isFinite(numericStrength) || numericStrength <= 0) return false;

    const reducedMotion = systemReducedMotion
      || (typeof document !== "undefined"
        && !!document.body?.classList?.contains("sf-reduced-motion"));
    const safeDuration = clamp(
      numericDuration,
      0.12,
      1.2
    );
    const requestedPeak = clamp(numericStrength, 0, 1);
    const accessiblePeak = reducedMotion ? requestedPeak * 0.32 : requestedPeak;

    doctrineGlow.colour.copy(colour);
    doctrineGlow.peak = Math.max(doctrineGlow.level, accessiblePeak);
    doctrineGlow.attackRemaining = reducedMotion
      ? Math.min(0.14, safeDuration * 0.32)
      : Math.min(0.07, safeDuration * 0.18);
    doctrineGlow.decayRate = (reducedMotion ? 3.2 : 5.5) / safeDuration;
    doctrineGlow.reducedMotion = reducedMotion;
    return true;
  }

  const state = {
    clock: 0,
    x: -12,
    z: 900,
    y: 0,
    vy: 0,
    yaw: Math.PI,            // facing north, down the road
    /* How fast the body is turning, rad/s, low-passed. The legs are
       solved in world space against a body frame that rotates, so
       every foot placement through a turn is a prediction, and this
       is the term the prediction is missing without it. */
    yawRate: 0,
    pitch: -0.06,
    camYaw: Math.PI,
    // Recoil shake amplitude, 0..1, and its oscillator phase.
    punch: 0,
    punchPhase: 0,
    /* A SECOND shake channel, deliberately not the recoil one.
       Recoil is a 47 rad/s buzz because that is what a shoulder-fired
       weapon does to a helmet. A rite landing is the opposite event: a
       single heavy shove that the body rides out over a quarter of a
       second. Feeding doctrine through `punch` made a capstone feel
       like an extra round going off, so it gets its own amplitude,
       its own slow oscillator and its own decay. */
    heave: 0,
    heavePhase: 0,
    heaveFreq: 16,
    heaveDecay: 6.5,
    // A hazard's ground-speed multiplier and how long it has left to
    // run - see `applySlow` below.
    slowFactor: 1,
    slowFor: 0,
    /* Held fast - see `applyRoot`. While this runs the feet do not
       move at all: no ground travel, no jump, no boost or ignition.
       Aim, fire, swing and Aegis are untouched, and something else
       (a line, a haul - see `drag`) may still move the body. */
    rootFor: 0,
    /* PUT ON THE FLOOR - see `applyStun`, and it is a strictly bigger
       thing than the root above. A root takes the feet; a stun takes
       the whole trooper: no travel, no jump, no boost, no pack, and no
       attack of any kind (main.js drops the input and refuses the
       trigger while it runs). Reserved for the heaviest impacts in the
       game, because taking a player's hands away is the most
       expensive thing an attack can do to them. */
    stunFor: 0,
    // QA/diagnostic count for collision-safe flight-slam handoffs.
    slamLandingCorrections: 0,
    camPitch: -0.10,
    camDist: 5.2,
    firstPerson: 0,
    /* Dying, and how far through the fall. `deathPose` is read by the
       camera here and by the harness; nothing else in the file needs
       to know, because the pose itself is carried by the `death`
       action on the ordinary timeline. */
    dying: false,
    deathPose: 0,
    grounded: true,
    speed: 0,
    /* Actual horizontal travel, which may differ from body facing
       while melee commits the shoulders to the reticle. Footfall
       prediction reads these so a sideways/backward swing cannot
       plant both feet along the attack bearing. */
    travelYaw: Math.PI,
    travelSpeed: 0,
    /* Signed grade of the ground actually travelled downhill this
       frame, plus the presentation state it drives. A steep descent
       remains GROUNDED physics; this is not a fall, boost or jetpack
       mode, and borrowing any of those would also borrow their fuel,
       collision and action rules. */
    downhillGrade: 0,
    /* Signed grade along the way the body is FACING, + uphill.
       `downhillGrade` cannot stand in for it: that one is gated on
       actually travelling down a continuous face, and is zero for
       every climb. */
    slopeGrade: 0,
    downhillSliding: false,
    downhillPose: 0,
    bob: 0,
    stride: 0,
    gait: 0,
    free: false,
    figureOverride: null,   // null = follow free-camera mode
    freePos: new THREE.Vector3(),
    freeTarget: new THREE.Vector3(),
    freeFov: 60,
    carryChestYaw: 0,
    /* SIGHTED, 0..1, eased. `weapons.carry.ads` is set instantly to 0
       or 1 by main.js, which is right for a spread value and wrong
       for anything a viewer sees move: a field of view that snaps
       between two numbers reads as a glitch rather than as raising a
       weapon. Damped here rather than in weapons.js so the shot
       spread keeps its instant response and only the presentation
       eases. */
    sighted: 0,
    aimViewYaw: Math.PI,
    aimViewPitch: Math.atan2(0.35, 5.2),
    /* AIM COMMITMENT, 0..1.
       Mouse-look is a camera control, not a body control: the trooper
       ignores it entirely until the player commits to a direction by
       firing or aiming down sights. This is how much of that
       commitment is currently expressed - it ramps in fast enough to
       feel like the same action as the click, and bleeds out slowly
       so a burst of single shots does not strobe the shoulders. */
    aimCommit: 0,
    aimHold: 0,
  };

  const input = makeInput(canvas, () => Number.isFinite(state.aimViewYaw)
    ? state.aimViewYaw
    : state.camYaw);

  const EYE = 1.62;
  const CAMERA_AIM_BIAS = Math.atan2(0.35, state.camDist);
  /* Carried at chest height, forward of the breastplate. Follows
     the rebuilt shoulder line at 1.50m rather than the old 1.30m. */
  const MOUNT = { x: 0.062, y: 1.238, z: 0.190 };
  const MOUNT_YAW = -Math.PI / 2;
  /* These are applied to crestPivot EVERY FRAME, so they silently
     overwrote whatever the builder set. -0.46 rad is a 26-degree
     roll: one end of the crescent hung at chin height and the other
     rode above the crown. Sway is added on top of these. */
  const HALO_Z = 0;
  const HALO_X = 0.04;
  /* How much of the arm's rotation the pauldron takes, and the most
     it is ever allowed to take. 0.34rad is about 19 degrees - enough
     that the plate reads as riding the shoulder, not so much that a
     full swing can roll it into the ribcage. */
  const PAULDRON_FOLLOW = 0.22;
  const PAULDRON_MAX_ANGLE = 0.34;
  let sway = 0;
  let swayVel = 0;
  let lastYaw = 0;
  /* Figure-authored locomotion. Vesper and White Vigil keep the
     established values through these defaults; physically broader
     rigs can carry a slower, wider, more deliberate gait without
     forking the controller or changing collision semantics. */
  const locomotionProfile = figure.locomotionProfile || {};
  const locomotionValue = (key, fallback) => Number.isFinite(locomotionProfile[key])
    ? locomotionProfile[key]
    : fallback;
  const WALK = locomotionValue("walkSpeed", 4.4);
  const SPRINT = locomotionValue("sprintSpeed", 8.6);
  const GROUND_ACCEL_RESPONSE = locomotionValue("groundAcceleration", 3.4);
  const GROUND_DECEL_RESPONSE = locomotionValue("groundDeceleration", 5.4);
  const TURN_RESPONSE_SCALE = locomotionValue("turnResponseScale", 1);
  const FLIGHT_SPEED_SCALE = locomotionValue("flightSpeedScale", 1);
  const STRIDE_SCALE = locomotionValue("strideScale", 1);
  const STANCE_BIAS = locomotionValue("stanceBias", 0);
  const STEP_LIFT_SCALE = locomotionValue("stepLiftScale", 1);
  const BODY_DROP_SCALE = locomotionValue("bodyDropScale", 1);
  const IMPACT_SCALE = locomotionValue("impactScale", 1);
  const PASSING_RISE_SCALE = locomotionValue("passingRiseScale", 1);
  const WEIGHT_SWAY_M = locomotionValue("weightSwayM", 0);
  const WEIGHT_ROLL = locomotionValue("weightRoll", 0);
  /* HOW FAR THE BODY TIPS INTO ITS OWN TRAVEL, split the same way the
     lean is applied further down: the first pair tilts the figure
     root about the soles, the second is what the spine keeps. See the
     long note at the lean itself for why it is split at all.

     These were literals, and a literal is a claim that every figure
     in this game carries its mass the same way. A heavier body leans
     further at the same pace - that is most of what "heavy" looks
     like from the side - and there is no way to say so with a
     multiplier, because scaling one number that already spans 5.7 to
     16 degrees either does nothing to the walk or throws the sprint
     into a dive. Four independent radians, defaulting to exactly the
     values that were hard-coded here. */
  const LEAN_WALK = locomotionValue("leanWalk", 0.045);
  const LEAN_SPRINT = locomotionValue("leanSprint", 0.155);
  const SPINE_LEAN_WALK = locomotionValue("spineLeanWalk", 0.055);
  const SPINE_LEAN_SPRINT = locomotionValue("spineLeanSprint", 0.025);
  /* Below this the body is no longer travelling far enough per frame
     to carry the gait, so the swing borrows a clock. Deliberately
     well under WALK: a genuine slow amble already advances the cycle
     faster than the floor does, so this only ever applies to a body
     that is stopping. */
  const GAIT_SETTLE_SPEED = locomotionValue("gaitSettleSpeed", Math.min(1.7, WALK * 0.55));
  const GAIT_SETTLE_CADENCE = locomotionValue("gaitSettleCadence", 1.5);
  const MELEE_THRUST_SPEED = 12.8;
  /* Fraction of the ordinary speed kept while sighted, and the field
     of view the camera pulls to. 0.46 of a walk is a deliberate
     shuffle; 40 degrees against a 62-degree hip view is a 1.55x zoom,
     which is enough to read a Gleaner on a ridge at the 52m it starts
     shooting from without turning the frame into a scope. */
  const ADS_SPEED = 0.46;
  const ADS_FOV = 40;
  /* How far forward the hips travel because of the body lean, in
     metres, recomputed each frame. The foot plants have to follow it
     or the legs are simply asked to reach further than they can: at
     11 degrees the hip sockets move 19cm ahead of where they used to
     be, and the ankle target miss went from 8mm to 147mm the moment
     the lean went in. Shifting BOTH feet by the same amount restores
     the leg geometry exactly, and is also what a leaning runner
     does - the feet land under the mass, not behind it. */
  let leanFootShift = 0;
  /* How far the breastplate may lead the hips. 54 degrees is about
     what a person in a cuirass can hold with a weapon up; past it the
     legs have to come round, which is the whole point. It is also the
     clamp that stops the shoulders spinning a half-turn on stationary
     hips when the camera orbits. */
  const MAX_CHEST_TWIST = 0.95;
  /* A melee press is a commitment to the reticle bearing captured on
     that press. Locomotion normally owns body yaw, but letting it win
     during the wind-up can turn a thrust 90-180 degrees away before
     its hit window opens. This response leaves the turn visible and
     keeps yawRate/foot prediction informed, while settling even a
     full about-face before melee1 connects. */
  /* Measured with `saintfall-melee-arc-probe.mjs`, reticle 180 degrees
     behind: at 20 the body covered 114 of those degrees in the first
     THREE FRAMES, which is not a turn - it is a teleport with an
     animation playing over it.

     The floor is set by a contract, not by taste. The blow must land
     on what the reticle was pointing at when the key went down, and
     `saintfall-melee-reticle-probe.mjs` holds the body to within
     AIM_TOLERANCE_DEG (3 degrees) of that captured bearing by the time
     the hit window opens at 0.317s. From a 120-degree offset the
     residual is 120*exp(-R*0.317): R=12 leaves 3.3 degrees and fails
     it, R=15 leaves 1.0 and passes with margin while still spreading
     the pivot over twice as many frames as R=20 did. */
  const MELEE_TURN_RESPONSE = 15;
  /* From a quarter turn out, even that response reads as input lag: the
     thrust wind-up plays while the legs are still coming round, and the
     press feels like it went somewhere else. At and past 90 degrees the
     press therefore becomes `meleeTurn` - a low horizontal cut in which
     THE SPIN IS THE SWING. The root sweeps the whole signed offset on
     the clip's own authored window (spec.turn, a smoothstep - an
     exponential damp front-loads the turn into a teleport, which is
     exactly what the R=20 measurement above showed), and the strike arc
     widens to the angle actually swept, so the target ahead AND
     anything the blade carved through on the way are honest hits. */
  const TURN_SLASH_MIN = Math.PI / 2 - 1e-4;
  /* Coverage past the swept angle itself - roughly the crescent the
     extended blade subtends on each side of its path. */
  const TURN_SLASH_ARC_PAD = 1.5;
  /* Peak root speed of the authored lunge drive. Faster than the old
     hold-W thrust jog (12.8) because it is a BURST with its own clip,
     not a locomotion target: the profile in ACTIONS.meleeLunge.drive
     ramps it in, holds it through the closing dash and fades it during
     recovery, so it never becomes a sustained sprint. */
  const MELEE_LUNGE_SPEED = 16.5;
  /* Peak speed of the jetpack-powered piercing thrust. Explodes at
     over double the standard lunge speed to pierce through entire lines. */
  const MELEE_PIERCE_SPEED = 34.0;
  /* Walking and flight-to-ground handoff must agree about what terrain
     the trooper can occupy. Keeping these gates in one classifier avoids
     a middle band where a slope is freely walkable but a descending
     jetpack capsule mistakes its uphill rim for a roof. */
  const WALK_SLOPE_LOOK = 1.6;
  const WALK_SLOPE_NEAR = 0.45;
  const WALK_SLOPE_LIMIT = 1.7;
  const WALK_MAX_STEP_UP = 1.05;
  const GROUNDED_SETTLE_DOWN_SPEED = 1.5;
  /* The authored dune slip faces sit near the sand's angle of repose.
     Walk normally below that band; once the directed descent reaches
     about 36 degrees, brace and skid. Separate entry/exit grades keep
     triangle-to-triangle noise from flickering the animation. */
  const DOWNHILL_SLIDE_ENTER_GRADE = 0.72;
  const DOWNHILL_SLIDE_EXIT_GRADE = 0.52;
  /* Sand can support a visually continuous slide well beyond the
     uphill walking limit. Past about 69 degrees it reads as a wall or
     ledge, so gravity takes over. Fixed sub-samples below make this
     classification stable on throttled frames. */
  const DOWNHILL_MAX_CONTINUOUS_GRADE = 2.6;
  /* Small contour changes stay glued to the sand. A real ledge does
     not: once the whole capsule footprint is this far below the soles,
     gravity owns the body immediately. Without this handoff a fast
     ground boost could carry the grounded gait several metres over a
     drop while `y` eased down at walking-slope speed. */
  const GROUNDED_SUPPORT_SKIN = 0.20;

  const tmp = new THREE.Vector3();
  const camOffset = new THREE.Vector3();
  const camShakeAxis = new THREE.Vector3();
  // Where the chase spring has the camera, before any shake.
  const camAnchor = new THREE.Vector3();
  /* A newly spawned trooper is hundreds of metres from the vector's
     constructor origin. The first presentation-only update often has
     dt=0 (load prewarm and cinematic handoff), so an ordinary damp
     would leave the anchor at [0,0,0] and the first live frame would
     fly across the map. Snap once after every spawn, then resume the
     normal chase spring. */
  let camAnchorReady = false;
  const viewForward = new THREE.Vector3();

  initIk(THREE);
  const ARM_AXIS = figure.armAxis || new THREE.Vector3(0, -1, 0);
  const LEG_AXIS = figure.legAxis || new THREE.Vector3(0, -1, 0);
  /* Imported figures do not necessarily share Vesper's shoulder
     height or arm proportions. Keep the proven Vesper values as the
     defaults, while allowing a figure adapter to author the free-arm
     envelope that its own skeleton can actually reach. */
  const freeArmPose = figure.freeArmPose || {};
  const freeArmValue = (key, fallback) => Number.isFinite(freeArmPose[key])
    ? freeArmPose[key]
    : fallback;
  /* The value below is the orientation of the FOOT BONE, not a
     universal boot angle. Imported meshes may author their sole plane
     at a different rotation around that bone, so let the figure
     adapter supply the measured flat-contact pitch. */
  const footPose = figure.footPose || {};
  const REST_FOOT_PITCH = Number.isFinite(footPose.restPitch)
    ? footPose.restPitch
    : 0.55;
  /* WHERE THE ANKLE SITS WHEN NOTHING IS HOLDING THE FOOT UP.
     A deviation from the ankle's own neutral, positive toes-up, NOT
     a world pitch - which is the whole repair below. Legs trailing
     under a jetpack hang from relaxed ankles with the toes following
     the shin; the old absolute pitch pointed both sabatons at the
     horizon while the shins ran backwards, which is a 90-degree
     ankle break and reads exactly as the reported "feet pointing
     up". Being a deviation, one number now suits both playable rigs,
     whose foot bones disagree by 26 degrees about where "flat" is. */
  const FLIGHT_ANKLE_DEV = Number.isFinite(footPose.flightDev)
    ? footPose.flightDev
    : -0.34;
  /* WHAT AN ANKLE CAN DO. Roughly 55 degrees pointed and 26 pulled
     up, which is the human range plus a little for armour. This is
     the last thing applied to every foot in every mode, so no
     solver below - gait, climb, skid, boost or flight - can hand the
     rig a joint angle a leg does not have. */
  const ANKLE_DEV_MIN = -0.96;
  const ANKLE_DEV_MAX = 0.46;
  /* The sole may roll this far across a hill before the boot simply
     rides the slope's edge, matching a real subtalar joint. */
  const ANKLE_ROLL_LIMIT = 0.38;
  const chestOffset = new THREE.Quaternion();
  const headOffset = new THREE.Quaternion();
  const chestWorldQuaternion = new THREE.Quaternion();
  const chestParentQuaternion = new THREE.Quaternion();
  const headWorldQuaternion = new THREE.Quaternion();
  const headParentQuaternion = new THREE.Quaternion();
  const travelLeanQuaternion = new THREE.Quaternion();
  const aimYawQuaternion = new THREE.Quaternion();
  const aimPitchQuaternion = new THREE.Quaternion();
  const headCarryYawQuaternion = new THREE.Quaternion();
  const travelRight = new THREE.Vector3();
  const aimRight = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const weaponOffset = new THREE.Quaternion();
  const poseEuler = new THREE.Euler();
  const gripTarget = new THREE.Vector3();
  const elbowPole = new THREE.Vector3();
  const kneePole = new THREE.Vector3();
  const footTmp = new THREE.Vector3();
  const footX = new THREE.Vector3();
  const footY = new THREE.Vector3();
  const footZ = new THREE.Vector3();
  const footBasis = new THREE.Matrix4();
  const footWorldQuaternion = new THREE.Quaternion();
  const footParentQuaternion = new THREE.Quaternion();
  const footRollQuaternion = new THREE.Quaternion();
  const footFwd = new THREE.Vector3();
  const shinDir = new THREE.Vector3();
  const jointWorld = new THREE.Vector3();
  const hipWorld = new THREE.Vector3();
  const reachTmp = new THREE.Vector3();
  const groundTilt = { pitch: 0, roll: 0 };
  /** Clamped smoothstep. The gait channels below are all "ease this
   *  fraction of a phase", and an un-clamped one runs away past its
   *  own window. */
  const smoothstep01 = (v) => {
    const x = clamp01(v);
    return x * x * (3 - 2 * x);
  };

  /* ============================================================
     THE ANKLE

     Foot bones do not participate in two-joint IK. Left alone they
     inherit every shin rotation and point up, inward or backward, so
     they get an authored world basis instead - X across the body, Y
     along the bone to the toe, Z completing the frame.

     THE FRAME IS THE POINT, AND IT WAS THE BUG. A boot planted on
     the ground is held by the GROUND: its sole owns a world angle
     and the shin swings over it. A boot in the air is held by the
     ANKLE: it hangs off the shin and has no opinion about the
     horizon at all. The old code only ever built the first kind, so
     every pose where the shin left vertical - a folded swing knee, a
     leg trailing under the jetpack, a stride up a hill - took the
     entire difference out of the ankle joint. Measured on a flat
     walk that was 114 degrees of dorsiflexion at mid-swing; hovering
     it was 98 on Vesper and 111 on White Vigil, held for as long as
     the player kept flying.

     So `orientFoot` takes the pose as an ANKLE DEVIATION - toes-up
     from neutral, zero being a sole flat under a vertical shin - and
     a `follow` weight saying which of the two frames owns it. It
     ends by clamping the deviation the rig actually receives into
     the range an ankle has, whatever the caller asked for.
     ============================================================ */
  function ankleAnglesFrom(i, facing) {
    /* The shin's angle in the vertical plane through `facing`,
       measured from forward toward up: -PI/2 is straight down,
       past -PI is folded back and up under the thigh.
       ...
       AND THAT IS WHY IT IS UNWRAPPED AGAINST LAST FRAME. `atan2`
       returns (-PI, PI], so a knee folding past horizontal steps
       from -179 to +174 degrees in one frame - a 353-degree jump in
       the quantity the whole ankle pose is measured against. It
       snapped the sabaton through a right angle for a single frame,
       twice per stride, at exactly the moment the leg was moving
       fastest: individually invisible, collectively the reported
       "glitchy" leg.

       A fixed branch cut does not fix it, it only moves it. A shin
       at +95 degrees is a knee lifted with the foot forward and a
       shin at +174 is a heel folded back over the calf, and no
       threshold tells those apart - the first attempt here read the
       forward one as folded 265 degrees backward and put 23 degrees
       of that straight into the ankle. Continuity does tell them
       apart, because the leg cannot get from one to the other
       without passing through everything between. */
    footFwd.set(Math.sin(facing), 0, Math.cos(facing));
    figure.kneePivots[i].getWorldPosition(jointWorld);
    figure.footPivots[i].getWorldPosition(reachTmp);
    shinDir.copy(reachTmp).sub(jointWorld);
    const leg = legs[i];
    if (shinDir.lengthSq() < 1e-10) return leg.shinPhi;
    shinDir.normalize();
    let phi = Math.atan2(shinDir.y, shinDir.x * footFwd.x + shinDir.z * footFwd.z);
    const prev = leg.shinPhi;
    while (phi - prev > Math.PI) phi -= Math.PI * 2;
    while (prev - phi > Math.PI) phi += Math.PI * 2;
    /* Bounded so a teleport, a respawn or a cutscene cannot leave a
       leg carrying an accumulated multiple of a turn. A real gait
       oscillates about straight down and never approaches this. */
    if (phi < -Math.PI * 2.5 || phi > Math.PI * 1.5) {
      phi = Math.atan2(shinDir.y, shinDir.x * footFwd.x + shinDir.z * footFwd.z);
    }
    leg.shinPhi = phi;
    return phi;
  }

  function orientFoot(i, facing, dev, follow = 0, roll = 0) {
    const foot = figure.footPivots && figure.footPivots[i];
    if (!foot || !foot.parent) return;
    const shinPhi = ankleAnglesFrom(i, facing);
    /* Where the toe points, as an angle in the same plane. The
       world frame answers "flat, tilted by `dev`"; the shin frame
       answers "wherever the shin went, plus the same `dev`". They
       agree exactly when the shin is vertical, which is what keeps
       the blend continuous through touchdown. */
    const worldPhi = dev - REST_FOOT_PITCH;
    /* Wide on purpose: any value this clamps is a value the achieved
       ankle angle is WRONG by, so the real bound is the deviation
       clamp below and this is only a NaN/runaway guard. */
    const shinPhi0 = clamp(shinPhi, -5.5, 1.7);
    const toePhi = worldPhi + clamp01(follow) * (shinPhi0 + Math.PI / 2);
    // The one guarantee: a joint angle a leg can hold.
    const held = clamp(
      toePhi - shinPhi0 - Math.PI / 2 + REST_FOOT_PITCH,
      ANKLE_DEV_MIN, ANKLE_DEV_MAX
    );
    const pitch = -(shinPhi0 + Math.PI / 2 + held - REST_FOOT_PITCH);

    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    footX.set(Math.cos(facing), 0, -Math.sin(facing));
    footY.set(Math.sin(facing) * cp, -sp, Math.cos(facing) * cp);
    footZ.crossVectors(footX, footY).normalize();
    footBasis.makeBasis(footX, footY, footZ);
    footWorldQuaternion.setFromRotationMatrix(footBasis);
    /* AND NOW THE SAME BOUND AGAIN, IN THREE DIMENSIONS.
     *
     * Everything above works in the vertical plane through `facing`,
     * which is where a leg belongs and where all of the authored
     * pose lives. A leg that has wandered OUT of that plane - the
     * body sliding along masonry leaves a stance foot two thirds of
     * a metre off the midline - has a shin with a large lateral
     * component, and the in-plane angle then understates the real
     * joint angle by everything the projection dropped: measured 40
     * degrees of dorsiflexion where the planar clamp believed it had
     * allowed 26. Correcting it here rather than in the plane leaves
     * the pose exactly as authored whenever the leg is where it
     * should be, and bounds it exactly when it is not. */
    const ankle3d = Math.acos(clamp(shinDir.dot(footY), -1, 1));
    const neutral3d = Math.PI / 2 - REST_FOOT_PITCH;
    const want3d = clamp(ankle3d, neutral3d + ANKLE_DEV_MIN, neutral3d + ANKLE_DEV_MAX);
    if (Math.abs(want3d - ankle3d) > 1e-4) {
      footZ.crossVectors(shinDir, footY);
      if (footZ.lengthSq() > 1e-8) {
        footZ.normalize();
        footRollQuaternion.setFromAxisAngle(footZ, want3d - ankle3d);
        footWorldQuaternion.premultiply(footRollQuaternion);
        footY.applyQuaternion(footRollQuaternion);
      }
    }
    if (roll) {
      /* ROLLED ABOUT THE BOOT'S OWN LONG AXIS - which is the toe
         direction, and NOT the body's forward. Those are the same
         line only when the sole is level, and everywhere else
         rolling about forward drags the toe out of the plane the
         flexion was just solved in: on a cross-slope climb it added
         a further 22 degrees to an ankle already at its limit, which
         is the whole thing this function exists to prevent. About
         the toe, the joint angle is untouched and only the sole
         turns, which is what an ankle's inversion actually is. */
      footRollQuaternion.setFromAxisAngle(
        footY, clamp(roll, -ANKLE_ROLL_LIMIT, ANKLE_ROLL_LIMIT)
      );
      footWorldQuaternion.premultiply(footRollQuaternion);
    }
    foot.parent.getWorldQuaternion(footParentQuaternion).invert();
    foot.quaternion.copy(footParentQuaternion).multiply(footWorldQuaternion);
    foot.updateWorldMatrix(false, true);
  }

  /**
   * The ground's pitch and roll under a point, in the frame of a body
   * facing `facing`. Written into `groundTilt`.
   *
   * A sole held flat while the hill is not is the difference between
   * a boot standing on Kenosis and a boot standing THROUGH it, and
   * no amount of correct leg IK hides it: the contact patch is the
   * one part of a walk a player looks straight at.
   */
  /* The same question, per leg, memoised on where it was asked.
   *
   * Four height samples a foot a frame is not free - it measured
   * about 0.2ms of sim on its own - and most of them are repeats: a
   * standing trooper asks about the same square metre forever, and a
   * swing's landing point barely moves until the last few frames
   * before touchdown. 4cm is well inside the 22cm the tilt is
   * measured over, so a hit is the same answer. */
  const legTilt = [0, 1].map(() => ({
    x: NaN, z: NaN, yaw: 0, at: -1, pitch: 0, roll: 0,
  }));
  const FLAT_TILT = { pitch: 0, roll: 0 };
  function legGroundTilt(i, x, z, facing) {
    const cache = legTilt[i];
    /* Expires on TIME as well as on distance, because the ground is
       not a constant: the Ossuary's pit is carved into the height
       field and animated, and a boot standing still over moving
       terrain would otherwise hold its opening tilt for as long as
       the player did not step. */
    if (state.clock - cache.at < 0.2
      && Math.abs(cache.x - x) < 0.04 && Math.abs(cache.z - z) < 0.04
      && Math.abs(cache.yaw - facing) < 0.05) return cache;
    const tilt = readGroundTilt(x, z, facing);
    cache.x = x;
    cache.z = z;
    cache.yaw = facing;
    cache.at = state.clock;
    cache.pitch = tilt.pitch;
    cache.roll = tilt.roll;
    return cache;
  }

  function readGroundTilt(x, z, facing) {
    const s = 0.22;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const rise = groundY(x + fx * s, z + fz * s) - groundY(x - fx * s, z - fz * s);
    const lift = groundY(x + fz * s, z - fx * s) - groundY(x - fz * s, z + fx * s);
    groundTilt.pitch = Number.isFinite(rise) ? Math.atan2(rise, s * 2) : 0;
    groundTilt.roll = Number.isFinite(lift) ? Math.atan2(lift, s * 2) : 0;
    return groundTilt;
  }

  /**
   * Pull a foot target inside the leg's own reach.
   *
   * The two-joint solver CLAMPS rather than stretching, which is the
   * right call - but it clamps silently, and what the player sees is
   * a locked-straight leg with the sabaton hanging somewhere the gait
   * still believes it planted. Climbing a 1.4 grade the trailing
   * ankle finished 1.39m from its target; that is not a stiff pose,
   * it is a boot that has come off the leg.
   *
   * Moving the TARGET instead keeps the ankle attached to the shin
   * and the whole limb inside a pose it can hold. The foot ends up
   * higher off the hill than the gait asked for, which is exactly
   * what a person climbing does with the trailing leg.
   */
  function clampReach(i, target) {
    figure.legPivots[i].updateWorldMatrix(true, false);
    hipWorld.setFromMatrixPosition(figure.legPivots[i].matrixWorld);
    const lengths = figure.legLengths ? figure.legLengths[i] : figure.limb;
    const chain = lengths.thigh + lengths.shin;
    const max = chain * 0.985;
    /* And the NEAR limit, which the solver does not have. Its own
       floor is |thigh - shin|, a couple of millimetres on a human
       leg, so a target close to the hip folds the knee through 178
       degrees - the shin doubled back onto the thigh. 0.28 of the
       chain is a 147-degree fold: heel to buttock, and the end of
       what a knee does. Climbing a 1.4 grade reached 178 every
       stride. */
    const min = chain * 0.28;
    /* AND A CEILING, WHICH IS WHAT ACTUALLY ENFORCES THE FOLD.
     *
     * An ankle does not go above its own hip while walking, and
     * saying so as a plain clamp on height does the near limit's job
     * for it: with the ankle at least `min` BELOW the hip, the
     * hip-to-ankle distance is at least `min` whatever the foot is
     * doing horizontally, so the knee cannot fold past its limit and
     * the near branch below becomes a guard rather than a mechanism.
     *
     * That matters because the near branch cannot be made smooth.
     * Every version of it replaces the target wholesale, so a target
     * DRIFTING across the limit sphere jumps when it crosses -
     * sprinting up a 41-degree slope, the boot sat pinned just under
     * the hip for several frames and then snapped 0.8m in one. A
     * ceiling has no far side to cross. */
    reachTmp.copy(target).sub(hipWorld);
    const ceiling = hipWorld.y - min;
    if (target.y > ceiling) {
      target.y = ceiling;
      reachTmp.y = -min;
    }
    const d = reachTmp.length();
    if (d < 1e-6) return 0;
    if (d > max) {
      target.copy(hipWorld).addScaledVector(reachTmp, max / d);
      return d - max;
    }
    if (d < min) {
      const horiz = Math.hypot(reachTmp.x, reachTmp.z);
      target.y = hipWorld.y - Math.sqrt(Math.max(0, min * min - horiz * horiz));
      return d - min;
    }
    return 0;
  }
  const handWrist = new THREE.Vector3();
  const handX = new THREE.Vector3();
  const handY = new THREE.Vector3();
  const handZ = new THREE.Vector3();
  const shaftDirection = new THREE.Vector3();
  const shaftButt = new THREE.Vector3();
  const shaftTip = new THREE.Vector3();
  const handBasis = new THREE.Matrix4();
  const handWorldQuaternion = new THREE.Quaternion();
  const handParentQuaternion = new THREE.Quaternion();
  const handRestQuaternion = new THREE.Quaternion();
  const handRestTarget = new THREE.Quaternion();
  const figureRight = new THREE.Vector3();
  const handFreeTarget = new THREE.Quaternion();
  const restElbow = new THREE.Vector3();
  const restWrist = new THREE.Vector3();
  const handOrientationTransition = [false, false];
  const reachCorrection = new THREE.Vector3();
  const reachDirection = new THREE.Vector3();
  const weaponWorld = new THREE.Vector3();

  /* ============================================================
     FOOT PLANTING

     The gait is driven by DISTANCE TRAVELLED, not by time, and a
     planted foot does not move at all while it is planted - the
     body moves over it. That is the whole difference between a
     walk and a slide, and on this level it matters more than
     usual: dune slip faces and crater walls mean the ground under
     a foot is rarely where the ground under the other one is.
     ============================================================ */
  /* Gait is integrated as CYCLES, with stride length changing from
     an armoured march to a full run.  The old fixed 1.55m cycle at
     9.4m/s demanded twelve steps a second; no leg animation can read
     as heavy at that cadence. */
  const gaitSpec = {
    strideLen: 1, stance: 0.5, landing: 0.24, lift: 0.12, bodyDrop: 0,
  };

  /** How completely locomotion is retreating from the aimed body.
   *  Only committed aim can create a true backpedal; ordinary S turns
   *  the trooper around and remains the full running gait. */
  function backpedalWeight() {
    if (state.aimCommit <= 0.002 || state.travelSpeed <= 0.35) return 0;
    const travelDot = Math.cos(angleDelta(state.yaw, state.travelYaw));
    return clamp01((-travelDot - 0.20) / 0.80) * state.aimCommit;
  }

  function readGaitSpec() {
    const walkN = clamp01(state.speed / WALK);
    const sprintN = clamp01((state.speed - WALK) / Math.max(0.1, SPRINT - WALK));
    /* A long stride is a long time spent committed to a heading. At
       2.05m and a 34% stance the trooper is airborne on one leg for
       most of a second, and a hard turn rotates the body most of a
       right angle inside that window - so the foot lands facing
       somewhere the body has already left, however good the
       prediction is.

       Shortening the stride through a turn is not a workaround for
       that; it is what a person does. You cannot take a full running
       stride round a tight corner, you take three chopped ones. It
       caps the prediction horizon and fixes the look at the same
       time. */
    const turnN = clamp01(Math.abs(state.yawRate) / 2.2);
    const chop = 1 - 0.42 * turnN;
    /* AND YOU CANNOT TAKE A FULL STRIDE UP A HILL EITHER. The
       landing foot has to reach the ground a stride ahead, which on
       a 1.4 grade is most of a metre higher than the one behind it:
       the front leg folds to the end of a knee and the back one is
       asked for ground a leg-length and a half below the hip. Both
       are then rescued by clamps, and a clamp is a pose nobody
       authored. Chopping the stride is what a person climbing does
       and it keeps the whole cycle inside the leg. */
    const climbN = clamp01(Math.max(0, state.slopeGrade) / 1.25);
    gaitSpec.strideLen = (lerp(0.78, 2.05, walkN) + 1.55 * sprintN)
      * chop * lerp(1, 0.55, climbN) * STRIDE_SCALE;
    const backpedal = backpedalWeight();
    const forwardStance = lerp(0.52, 0.34, walkN) - 0.14 * sprintN + 0.10 * turnN;
    /* A forward run deliberately has a flight phase. A firing
       backpedal is a braced retreat: one sabaton must always own the
       ground while the other reaches backward, with a short double-
       support handoff rather than both legs cycling in the air. */
    gaitSpec.stance = clamp(lerp(forwardStance, 0.56, backpedal) + STANCE_BIAS, 0.16, 0.68);
    const stanceTravel = gaitSpec.strideLen * gaitSpec.stance;
    gaitSpec.landing = clamp(stanceTravel * 0.46, 0.18, 0.33);
    gaitSpec.lift = lerp(
      lerp(0.09, 0.17, walkN) + 0.07 * sprintN,
      0.13,
      backpedal
    ) * STEP_LIFT_SCALE;
    gaitSpec.bodyDrop = lerp(
      lerp(0, 0.095, walkN) + 0.060 * sprintN,
      0.055,
      backpedal
    ) * BODY_DROP_SCALE;
    /* The track narrows as the body picks up its own walk. The
       planted-foot guard does NOT follow it - see `TRACK_GUARD`. */
    trackHalf = lerp(HIP_HALF, HIP_HALF_MOVING,
      clamp01(state.speed / Math.max(0.5, WALK)));
    return gaitSpec;
  }

  const legs = [0, 1].map((i) => ({
    phase: i * 0.5,
    plant: new THREE.Vector3(),
    from: new THREE.Vector3(),
    target: new THREE.Vector3(),
    foot: new THREE.Vector3(),
    swinging: false,
    side: i === 0 ? -1 : 1,
    planted: false,
    /* ANKLE DEVIATION, toes-up positive, zero being a sole flat
       under a vertical shin. Deliberately not a world pitch: see
       `orientFoot`. */
    footDev: 0,
    /* How much the sabaton rides the shin rather than the ground.
       A planted boot is held by the hill; a free one hangs off the
       ankle, and the handoff has to be continuous or the foot snaps
       through 90 degrees at every touchdown. */
    footFollow: 0,
    footRoll: 0,
    /* Last frame's shin angle, kept ONLY so the next one can be
       unwrapped against it - see `ankleAnglesFrom`. */
    shinPhi: -Math.PI / 2,
    settling: false,
  }));

  /* ============================================================
     ACTIONS

     A pose timeline applied to the POLEARM ROOT after carry/recoil,
     not to the arms. The arms are solved onto its grips every frame,
     so moving the weapon drives hands and elbows from one source of
     truth. The chest/hips receive their own mass channels below;
     keyframing six limb joints would drift the moment a grip moved.

     Every attack is wind-up, strike, recover, and the timing is
     deliberately lopsided. A swing whose three phases take equal
     time reads as a slide: the blow has to be preceded by a slow
     load and followed by a heavy settle, so that the fast part is
     fast RELATIVE to something. That ratio is measurable - the
     character harness reports peak tip speed over mean - and it is
     the difference between a hit that lands and one that passes
     through.
     ============================================================ */

  const EASE = {
    // Slow out of the wind-up, violent into the strike.
    load: (t) => t * t,
    strike: (t) => 1 - Math.pow(1 - t, 3.2),
    settle: (t) => 1 - Math.pow(1 - t, 2),
    linear: (t) => t,
  };

  /* Keys are [time, x, y, z, pitch, yaw, roll], in weapon-mount
     space. Offsets are metres and radians off the carry pose. */
  /* Keyframe TRANSLATIONS are small; the arc comes from rotation.
     A standing assert found the melee and swap poses pushing a grip
     0.82m from a shoulder with 0.70m of arm - so the solver clamped,
     the elbow folded back on the humerus and the arm disappeared
     inside its own pauldron. Six visual reviews reported "the figure
     has no arms" without isolating why. Rotation swings the blade
     through metres without moving the hands at all, which is the
     whole point of holding a lever. */
  /* How long the fall takes to reach the ground, as distinct from how
     long the clip is held for. The camera eases out over this and the
     clip then sits on its last pose until a respawn clears it. */
  const DEATH_FALL_SECONDS = 1.55;
  /* Time after a completed strike in which the next press keeps the chain.
     Melee players need enough room to guard, sidestep, or reacquire a target
     between committed animations without losing the entire procession. */
  const MELEE_COMBO_GRACE_SECONDS = 1.35;

  const ACTIONS = {
    /* CLEAVING LUNGE - the opener has to read on the first press.
       The old thrust travelled forward but occupied very little of
       the screen, so increasing its collision cone made the attack
       stronger without making the weapon look stronger. This clip
       now coils across the rear shoulder and cuts through the reticle
       while the front foot lands. The lunge keeps the polearm's depth
       advantage; the authored yaw/roll gives it an unmistakable arc. */
    /* THE SWEEP IS THE READ, AND IT IS MEASURED.
       `scripts/saintfall-melee-arc-probe.mjs` samples the real
       `weapon-tip` anchor through each clip and reports the envelope
       it traces in the body frame. These keys are authored against
       that readout, not against taste: the blade has to cover ground
       the eye can follow, and the slash ribbon in vfx.js is keyed to
       the SAME measured numbers (`MELEE_SWEEPS`), so widening a swing
       here means re-running the probe and moving those with it. */
    melee1: {
      /* The hit window opens as the blade crosses centre rather than
         on the wind-up. Full extension is near 0.36 of the clip. */
      dur: 0.76, hit: [0.31, 0.49], damage: 1.25, arc: 1.42, lunge: 1.34,
      keys: [
        [0.00, 0.0, 0.0, 0.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "load"],
        // Rear-shoulder load: blade wide left, hips resisting the chest.
        [0.25, -0.075, 0.070, -0.085, 0.15, -0.92, -0.34, -0.70, 0.24, 0.32, 0.030, -0.17, 0.10, 0.060, "strike"],
        // Full cut: blade crosses the reticle as the front foot drives in.
        [0.42, 0.105, -0.035, 0.190, -0.12, 1.02, 0.38, 0.86, -0.32, -0.40, -0.065, 0.34, 0.18, 0.260, "settle"],
        [0.76, 0.0, 0.0, 0.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "settle"],
      ],
    },
    melee2: {          // rising diagonal, low left to high right
      dur: 0.78, hit: [0.28, 0.48], damage: 1.15, arc: 2.72,
      keys: [
        [0.00, 0.0, 0.0, 0.0, 0, 0, 0, "load"],
        [0.26, 0.055, -0.140, -0.095, 1.02, -1.74, 0.66, -0.74, 0.36, -0.32, -0.085, 0.12, 0.10, 0.055, "strike"],
        [0.50, -0.065, 0.245, 0.225, -1.36, 1.68, -0.78, 0.92, -0.42, 0.40, 0.042, 0.33, 0.17, 0.255, "settle"],
        [0.78, 0.0, 0.0, 0.0, 0, 0, 0, "settle"],
      ],
    },
    melee3: {          // overhead slam, the combo finisher
      dur: 0.96, hit: [0.34, 0.52], damage: 1.9, arc: 2.05, slam: true,
      keys: [
        [0.00, 0.0, 0.0, 0.0, 0, 0, 0, "load"],
        /* The loaded Vesper silhouette is much broader through the
           shoulders than the old procedural rig.  Pitch alone left
           that mass almost stationary in an overhead strike, so the
           wind-up now coils across the hips and the impact unwinds in
           the opposite direction.  It reads as a knight driving a
           heavy reliquary into the ground, not a mannequin moving a
           staff with its wrists. */
        [0.32, -0.042, 0.2810, -0.1720, -1.74, 0.24, 0.12, 0.50, -0.52, 0.22, 0.055, -0.07, 0.03, 0.050, "strike"],
        [0.54, 0.075, -0.205, 0.300, 1.70, -0.24, -0.12, -0.80, 0.72, -0.34, -0.110, 0.32, 0.17, 0.240, "settle"],
        [0.96, 0.0, 0.0, 0.0, 0, 0, 0, "settle"],
      ],
    },
    /* THE TURN SLASH - what a press becomes when the reticle is a
       quarter turn or more off the body (see TURN_SLASH_MIN).

       The root itself does the travelling: the facing solve reads
       `turn` below and sweeps `state.yaw` through the captured offset
       on that window, so the clip's only job is the silhouette that
       makes the pivot read as an attack - blade levelled and carried
       wide on a lowered, widened base, then gathered back in. `arc`
       here is only the fallback; the live swing computes its own
       strike arc from the angle actually swept (`action.strikeArc`).

       The hit fires MID-SPIN (0.20s - half the wait of melee1's
       0.31s), which is the responsiveness the whole feature buys:
       from a full about-face the blade connects sooner than the old
       pirouette-then-thrust even began to.

       Direction: authored for a positive (leftward) sweep; the
       mirrored copy for the other way is generated below, so the
       blade leads the spin whichever way it runs. */
    meleeTurn: {
      dur: 0.68, hit: [0.20, 0.36], damage: 1.1, arc: 3.9, sweep: 4,
      turn: [0.08, 0.34],
      keys: [
        [0.00, 0.0, 0.0, 0.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "load"],
        // Gather: shaft levelled, blade drawn across, weight sinking.
        [0.10, -0.040, 0.060, -0.050, -0.22, -0.35, -0.15, -0.30, 0.06, -0.10, -0.070, -0.04, 0.10, 0.060, "load"],
        // Full carry: blade at extension riding the root's own spin.
        [0.30, 0.100, -0.030, 0.180, -0.16, 0.95, 0.30, 0.40, -0.18, 0.12, -0.100, 0.10, 0.14, 0.280, "strike"],
        // Carve-through: momentum spent, base still wide.
        [0.44, 0.040, 0.0, 0.060, -0.06, 0.40, 0.12, 0.15, -0.08, 0.05, -0.050, 0.05, 0.10, 0.100, "settle"],
        [0.68, 0.0, 0.0, 0.0, 0, 0, 0, "settle"],
      ],
    },
    /* THE LUNGE - what the opener becomes when forward is held at the
       press (see meleeSwing). The old behaviour was a locomotion
       speed bump under the ordinary swing: the trooper jogged at 12.8
       with the run gait playing, which read as "running while
       swinging" because that is literally what it was. This is a
       committed dash instead: `drive` below is a speed profile the
       update owns directly (ramp in, hold through the closing burst,
       fade through recovery), travel locked to the captured bearing,
       while the clip coils the blade high off the rear shoulder and
       rams it out level as the body drops into a deep front split.
       Depth over width: almost no arc, the longest reach in the kit,
       and the hit lands at full extension as the dash crests. */
    meleeLunge: {
      dur: 0.82, hit: [0.30, 0.46], damage: 1.45, arc: 1.05, lunge: 1.5,
      sweep: 5,
      drive: { start: 0.05, ramp: 0.11, end: 0.30, fade: 0.20 },
      keys: [
        [0.00, 0.0, 0.0, 0.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "load"],
        // Coil: blade cocked high by the rear shoulder, weight back.
        [0.18, -0.055, 0.065, -0.095, 0.20, -0.60, -0.24, -0.52, 0.16, -0.16, -0.045, -0.08, 0.07, -0.060, -0.05, "load"],
        // The ram: level thrust at full slide, body low in a deep split.
        [0.36, 0.085, -0.045, 0.215, -0.15, 0.30, 0.12, 0.55, -0.30, 0.10, -0.130, 0.30, 0.13, 0.320, 0.24, "strike"],
        // Riding the follow-through out: blade still forward, rising.
        [0.58, 0.045, -0.020, 0.120, -0.08, 0.18, 0.06, 0.28, -0.14, 0.05, -0.060, 0.16, 0.09, 0.160, 0.10, "settle"],
        [0.82, 0.0, 0.0, 0.0, 0, 0, 0, "settle"],
      ],
    },
    /* THE PIERCE - the Executioner's Thrust jetpack-powered piercing charge.
       Coils low and drives forward in an explosive vector burst that cuts
       cleanly through multiple ranks of enemies. */
    meleePierce: {
      dur: 0.68, hit: [0.06, 0.40], damage: 2.4, arc: 0.85, lunge: 2.8,
      sweep: 6,
      drive: { start: 0.02, ramp: 0.06, end: 0.32, fade: 0.20 },
      keys: [
        [0.00, 0.0, 0.0, 0.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "load"],
        // Coil forward into a streamlined spear thrust, lance dead ahead
        [0.12, 0.10, -0.04, 0.26, -0.04, 0.02, 0.0, 0.60, -0.32, 0.08, -0.14, 0.38, 0.14, 0.35, 0.30, "strike"],
        // Piercing penetration at full rocket speed
        [0.34, 0.14, -0.03, 0.30, -0.02, 0.01, 0.0, 0.66, -0.36, 0.06, -0.16, 0.42, 0.15, 0.40, 0.36, "strike"],
        // Settle & recover
        [0.54, 0.05, -0.01, 0.12, -0.03, 0.0, 0.0, 0.28, -0.14, 0.04, -0.07, 0.20, 0.09, 0.18, 0.14, "settle"],
        [0.68, 0.0, 0.0, 0.0, 0, 0, 0, "settle"],
      ],
    },
    /* ------------------------------------------------------------
       THE FALL.

       Player death was a full stop: the trooper stood upright and
       perfectly rigid for the whole 3.4-second respawn timer, holding
       the lance at the ready, while the HUD said they were dead. It
       is the one animation in the game every player is guaranteed to
       see, and it did not exist.

       Authored on the same timeline as the swings because it needs
       exactly what they need - the weapon has to come out of line,
       the stance has to give, the body has to go down - plus the one
       channel none of them did: `lean` tips the figure root, and the
       root is at the soles, so the trooper topples about their own
       feet like a felled tree rather than sinking through the floor.

       Held rather than ended. `dur` outlasts the respawn timer and
       `spawn()` clears the pose, so the body stays down until the
       moment the player is actually back on their feet - an action
       that expired on its own would stand the corpse up mid-timer.

       Channels:  x  y  z  |  pitch yaw roll |  chestYaw chestPitch
                  pelvisYaw  drop  stanceZ  stanceSpread  slide  lean
       ------------------------------------------------------------ */
    death: {
      dur: 9,   // held; see DEATH_FALL_SECONDS and spawn()
      keys: [
        [0.00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "strike"],
        /* The hit. A short recoil BACKWARD before anything gives -
           without it the collapse starts from a neutral pose and
           reads as the trooper deciding to lie down. */
        [0.16, -0.02, 0.03, -0.05, 0.16, -0.10, 0.12, 0.10, -0.12, 0.06,
          0.02, 0, 0.05, 0, -0.10, "settle"],
        /* The knees go. The body drops before it tips, because that
           is the order legs fail in - but only just: the ROOT PIVOTS
           AT THE SOLES, so the topple itself takes the head from
           1.65m to about a third of a metre, and a `drop` sized as if
           it had to do that work put the whole trooper half a metre
           under the road with only the lance still showing. */
        [0.52, -0.05, -0.10, -0.08, 0.55, -0.22, 0.30, 0.16, 0.22, 0.12,
          -0.20, -0.10, 0.15, 0.02, 0.42, "linear"],
        /* Over. The lance leads the body down - a two-handed weapon
           carried across the chest is the first thing to reach the
           ground - and the pelvis turns so the trooper lands on a
           shoulder rather than flat on their face, which is both more
           readable in silhouette and far kinder to the leg solver
           than a dead-square topple. */
        [1.05, -0.14, -0.30, -0.14, 1.05, -0.34, 0.58, 0.22, 0.30, 0.26,
          -0.19, -0.24, 0.24, 0.05, 1.02, "settle"],
        // The last of it, with a little slump past the resting angle.
        [1.55, -0.18, -0.38, -0.16, 1.24, -0.38, 0.66, 0.24, 0.34, 0.30,
          -0.24, -0.28, 0.26, 0.06, 1.28, "settle"],
        [2.10, -0.18, -0.38, -0.16, 1.22, -0.38, 0.64, 0.23, 0.33, 0.30,
          -0.21, -0.28, 0.26, 0.06, 1.22, "settle"],
        [9.00, -0.18, -0.38, -0.16, 1.22, -0.38, 0.64, 0.23, 0.33, 0.30,
          -0.21, -0.28, 0.26, 0.06, 1.22, "linear"],
      ],
    },
    reload: {
      dur: 2.35,
      keys: [
        [0.00, 0.0, 0.0, 0.0, 0, 0, 0, "settle"],
        /* Sized to sit just inside the arm's reach, not far inside
           it. The rear grip landed 0.667m out against a 0.665m limit
           - a 2mm miss - and the first answer was to scale the whole
           pose down by a third, which cleared the assert and left the
           reload travelling 0.05m: a magazine change where nothing
           moves. Two mm was the problem; two mm is the fix. */
        [0.35, -0.040, -0.0558, 0.020, 0.285, -0.325, 0.520, -0.50, 0.38, 0.17, -0.038, 0.09, 0.05, "settle"],
        [1.30, -0.048, -0.040, 0.016, 0.228, -0.285, 0.585, -0.43, 0.32, 0.14, -0.030, 0.08, 0.04, "linear"],
        [1.85, -0.0168, 0.0168, 0.0, -0.10, 0.10, -0.14, 0.12, -0.11, -0.04, 0.014, -0.04, 0.02, "strike"],
        [2.35, 0.0, 0.0, 0.0, 0, 0, 0, "settle"],
      ],
    },
    /* Held diagonally across the body, butt low and blade high -
       the reference's carry. Long duration so it can be frozen for
       a still and simply held during play. */
    present: {
      dur: 900,
      keys: [
        [0.00, 0.0, 0.0, 0.0, 0, 0, 0, "settle"],
        /* Roll 0.25 / yaw 0.55, not 0.62 / 1.16.

           Measured, the barrel direction in the figure's local frame
           was (0.432, 0.471, 0.769): 77% of the weapon's length still
           pointing at the camera, against the 85% of the version this
           replaced - an 8-point move. In the shipped hero framing the
           haft covered 75.9% of the chest band and the heart-lantern,
           the most identifying feature in two of three plates,
           survived at 630px - 0.4% of the figure.

           The plate this shot is named for holds the glaive VERTICALLY
           at the figure's left with the chest fully clear.

           Broadside to the camera. The rotation order is XYZ, so
           pitch 0.10 / yaw 0.18 / roll 0.62 solved to a barrel
           direction of (0.145, 0.497, 0.851) - 85% of the weapon's
           length pointing straight at the viewer, projecting as a
           vertical bar through the head. The old 54-degree roll was
           faking a diagonal because a diagonal is CORRECT; the fix
           deleted the read along with the cheat. */
        [0.45, 0.238, 0.0672, 0.052, 0.0, 0.30, 0.10, -0.60, 0.15, 0.26, -0.030, 0.12, 0.07, "settle"],
        [900, 0.238, 0.0672, 0.052, 0.0, 0.30, 0.10, -0.56, 0.18, 0.24, -0.024, 0.14, 0.08, "linear"],
      ],
    },
    swap: {
      dur: 0.62,
      keys: [
        [0.00, 0.0, 0.0, 0.0, 0, 0, 0, "settle"],
        // A swap that moves the muzzle 0.09m is a shrug. The weapon
        // drops off the shoulder and comes back up.
        [0.22, 0.0084, -0.0400, -0.014, 0.62, -0.26, 0.36, -0.38, 0.20, -0.15, -0.030, 0.11, 0.06, "strike"],
        [0.40, 0.0084, -0.0380, -0.0130, 0.58, -0.22, 0.33, -0.33, 0.17, -0.13, -0.026, 0.09, 0.05, "linear"],
        [0.62, 0.0, 0.0, 0.0, 0, 0, 0, "settle"],
      ],
    },
  };

  /* The spin can run either way, and a blade that TRAILS its own turn
     reads as being dragged rather than swung. `meleeTurn` is authored
     for a positive sweep; this builds the clockwise copy once by
     negating only the side-picking channels - lateral offset (x),
     mount yaw/roll, chest and pelvis lead. Heights, pitches, drops,
     stance depth/width and the grip slide are symmetric and keep their
     sign. Rows are variable-length (short rows end early and read as
     zero), so the map only touches indices that exist. */
  ACTIONS.meleeTurnCw = (() => {
    const src = ACTIONS.meleeTurn;
    const MIRROR = new Set([1, 5, 6, 7, 9]);
    return {
      ...src,
      keys: src.keys.map((row) => row.map(
        (v, i) => (MIRROR.has(i) && typeof v === "number" ? -v : v)
      )),
    };
  })();

  const action = {
    name: null,
    t: 0,
    spec: null,
    hitDone: false,
    queued: null,
    /* Horizontal reticle bearing captured for the live swing. A
       buffered combo gets its own press-time bearing rather than
       inheriting the first blow or sampling the camera later. */
    aimYaw: null,
    queuedAimYaw: null,
    combo: 0,
    comboAt: -9,
    /* The turn slash's live spin: the body yaw it started from, the
       signed offset it sweeps, which way (for the mirrored VFX), and
       the strike arc computed from that sweep. Null/0 for every other
       action - beginAction resets them so a stale spin can never
       drive a later swing's facing. */
    turnFrom: null,
    turnSweep: null,
    turnDir: 0,
    strikeArc: null,
  };
  const actionPose = {
    x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0,
    // Body channels. A clip that leaves these at zero animates the
    // weapon alone, which is what every clip used to do.
    chestYaw: 0, chestPitch: 0, pelvisYaw: 0, drop: 0,
    stanceZ: 0, stanceSpread: 0,
    /* Metres the hands travel BACK along the haft, toward the butt.
       The one channel that buys forward reach without asking the
       arms for it: at full extension the front arm is already at the
       92% ceiling the reach constraint enforces, so a thrust driven
       by translation alone stops dead there. Running the shaft
       through the grip is also simply how a spear is thrust. */
    slide: 0,
    /* THE ONE CHANNEL THAT TIPS THE WHOLE TROOPER.
       Everything else an action can do bends something: the weapon
       moves, the chest turns, the stance widens. `lean` is added to
       `bodyLean`, which rotates the figure root - and the root sits at
       the soles - so a clip can pivot the entire body about its feet.
       Nothing needed that until something had to fall over. */
    lean: 0,
  };
  /* Body channels are optional so a clip that does not use them keeps
     its original 8-element keys. The ease token is read from the END
     of the tuple for the same reason - it used to be pinned at index
     7, which made adding any channel a rewrite of every key in the
     file. */
  /* Type-checked, not length-checked.

     This read `kf.length > 8 ? (kf[i] || 0) : 0`, and the ease token
     is always the LAST element - so on a 12-element key index 11 is
     the string "settle", and `lerp("settle", "settle", u)` produced
     NaN. Four of six clips had their body channels silently dead.

     It never threw because `footRest` guards the result with
     `Number.isFinite`. That guard was added to stop a NaN poisoning
     the IK, and it did - but it also converted a data bug into a
     permanently dead animation channel that no assert could see. A
     guard that silences rather than reports is worse than a crash. */
  const chan = (kf, i) => (typeof kf[i] === "number" ? kf[i] : 0);

  /** Sample the timeline at an absolute time without advancing it. */
  function sampleActionAt(time) {
    if (!action.spec) return;
    action.t = time;
    const k = action.spec.keys;
    let i = 0;
    while (i < k.length - 2 && time >= k[i + 1][0]) i += 1;
    const a = k[i];
    const b = k[Math.min(k.length - 1, i + 1)];
    const span = Math.max(1e-4, b[0] - a[0]);
    const u = (EASE[b[b.length - 1]] || EASE.linear)(clamp01((time - a[0]) / span));
    actionPose.x = lerp(a[1], b[1], u);
    actionPose.y = lerp(a[2], b[2], u);
    actionPose.z = lerp(a[3], b[3], u);
    actionPose.pitch = lerp(a[4], b[4], u);
    actionPose.yaw = lerp(a[5], b[5], u);
    actionPose.roll = lerp(a[6], b[6], u);
    actionPose.chestYaw = lerp(chan(a, 7), chan(b, 7), u);
    actionPose.chestPitch = lerp(chan(a, 8), chan(b, 8), u);
    actionPose.pelvisYaw = lerp(chan(a, 9), chan(b, 9), u);
    actionPose.drop = lerp(chan(a, 10), chan(b, 10), u);
    actionPose.stanceZ = lerp(chan(a, 11), chan(b, 11), u);
    actionPose.stanceSpread = lerp(chan(a, 12), chan(b, 12), u);
    actionPose.slide = lerp(chan(a, 13), chan(b, 13), u);
    actionPose.lean = lerp(chan(a, 14), chan(b, 14), u);
  }

  function beginAction(name, aimYaw = null) {
    const spec = ACTIONS[name];
    if (!spec) return false;
    action.name = name;
    action.spec = spec;
    action.t = 0;
    action.hitDone = false;
    action.turnFrom = null;
    action.turnSweep = null;
    action.turnDir = 0;
    action.strikeArc = null;
    action.aimYaw = name.startsWith("melee") && Number.isFinite(aimYaw)
      ? Math.atan2(Math.sin(aimYaw), Math.cos(aimYaw))
      : null;
    return true;
  }

  /**
   * Killed.
   *
   * Idempotent, because the same frame can deliver a bite, a venom
   * tick and a fall: whichever arrives first owns the fall, and the
   * others must not restart it from the top.
   */
  function die() {
    if (state.dying) return false;
    /* A death during a reveal hold must give the camera back. Leaving
       `free` set is what made several intros look frozen: the body
       was already dead and the lens was still staring at the boss. */
    if (state.free) state.free = false;
    state.dying = true;
    action.queued = false;
    action.queuedAimYaw = null;
    action.combo = 0;
    return beginAction("death");
  }

  /** Next attack in the three-hit chain, or the first if it lapsed. */
  function meleeSwing(capturedAimYaw = null) {
    const w = ctx.weapons && ctx.weapons.current;
    if (!w || !w.spec.melee) return false;
    const aimYaw = Number.isFinite(capturedAimYaw)
      ? capturedAimYaw
      : Number.isFinite(state.aimViewYaw) ? state.aimViewYaw : state.camYaw;
    if (action.name && action.name.startsWith("melee")) {
      /* Buffered: pressing during the swing chains, which is what
         makes a combo feel responsive rather than dropped.

         The gate was 0.42 of the clip - a third of a second in which
         a press did NOTHING, not even queue, which is the window a
         player actually presses in when they are reacting to
         something. It only has to be late enough that the press
         cannot be the same one that started this swing; the
         wind-up is 0.25s and 0.18 of the shortest clip is 0.14s, so
         one input cannot register twice.

         The queued yaw is re-captured on every press inside the
         window, so the chained blow faces wherever the reticle
         ENDED UP rather than where it was on the first press. */
      if (action.t > action.spec.dur * 0.18) {
        action.queued = true;
        action.queuedAimYaw = aimYaw;
      }
      return false;
    }
    if (state.clock - action.comboAt > MELEE_COMBO_GRACE_SECONDS) action.combo = 0;
    action.queuedAimYaw = null;
    /* THE QUARTER-TURN GATE. `offset` is the shortest signed turn from
       where the body IS to where the press pointed. At 90 degrees or
       more the ordinary opener would spend its whole wind-up
       pirouetting, so the press becomes the turn slash instead: the
       spin sweeps that offset itself and the strike covers the angle
       swept (plus the blade's own crescent each side). It counts as
       the first blow of the procession - spinning onto a new target
       restarts the chain - so a follow-up press still climbs to
       melee2/melee3. This outranks the lunge below: you cannot drive
       forward through a bearing the body has not reached yet. */
    const offset = angleDelta(state.yaw, aimYaw);
    if (Math.abs(offset) >= TURN_SLASH_MIN) {
      action.combo = 1;
      action.comboAt = state.clock;
      if (!beginAction(offset >= 0 ? "meleeTurn" : "meleeTurnCw", aimYaw)) {
        return false;
      }
      action.turnFrom = state.yaw;
      action.turnSweep = offset;
      action.turnDir = offset >= 0 ? 1 : -1;
      action.strikeArc = Math.min(TAU, Math.abs(offset) + TURN_SLASH_ARC_PAD);
      return true;
    }
    action.combo = (action.combo % 3) + 1;
    action.comboAt = state.clock;
    /* HOLDING FORWARD turns the opener into the committed lunge. Only
       the opener: the follow-up blows are close-range procession steps
       and re-dashing inside them would carry the combo straight
       through its own target. `move.y` is -1 for a held W (and for a
       forward-tilted touch stick), read at the moment the swing
       actually begins so a buffered chain re-evaluates it. */
    if (action.combo === 1 && input.state.move.y < -0.25) {
      return beginAction("meleeLunge", aimYaw);
    }
    return beginAction(`melee${action.combo}`, aimYaw);
  }

  /** Jetpack-powered piercing thrust: straight-line rocket dash that penetrates all enemies. */
  function meleePierce(capturedAimYaw = null) {
    const w = ctx.weapons && ctx.weapons.current;
    if (!w || !w.spec.melee) return false;
    const aimYaw = Number.isFinite(capturedAimYaw)
      ? capturedAimYaw
      : Number.isFinite(state.aimViewYaw) ? state.aimViewYaw : state.camYaw;
    action.combo = 1;
    action.comboAt = state.clock;
    action.queuedAimYaw = null;
    const rank = ctx.progression?.rank?.("procession_executioners_measure") || 1;
    const spec = ACTIONS.meleePierce;
    spec.damage = rank >= 2 ? 3.4 : 2.4;
    spec.lunge = rank >= 2 ? 3.6 : 2.8;
    return beginAction("meleePierce", aimYaw);
  }

  /* Save/load and other hard handoffs must never resume a half-applied hit
     window at a new world position. Input clearing stops the next action;
     this clears the action that is already on the authored timeline. */
  function cancelTransientActions() {
    action.name = null;
    action.t = 0;
    action.spec = null;
    action.hitDone = false;
    action.queued = null;
    action.aimYaw = null;
    action.queuedAimYaw = null;
    action.combo = 0;
    action.comboAt = -9;
    action.turnFrom = null;
    action.turnSweep = null;
    action.turnDir = 0;
    action.strikeArc = null;
    sampleAction(0);
    return true;
  }

  function sampleAction(dt) {
    if (!action.spec) {
      actionPose.x = 0; actionPose.y = 0; actionPose.z = 0;
      actionPose.pitch = 0; actionPose.yaw = 0; actionPose.roll = 0;
      actionPose.chestYaw = 0; actionPose.chestPitch = 0;
      actionPose.pelvisYaw = 0; actionPose.drop = 0;
      actionPose.stanceZ = 0; actionPose.stanceSpread = 0;
      actionPose.slide = 0; actionPose.lean = 0;
      return;
    }
    action.t += dt;
    const k = action.spec.keys;
    let i = 0;
    while (i < k.length - 2 && action.t >= k[i + 1][0]) i += 1;
    const a = k[i];
    const b = k[Math.min(k.length - 1, i + 1)];
    const span = Math.max(1e-4, b[0] - a[0]);
    const u = (EASE[b[b.length - 1]] || EASE.linear)(clamp01((action.t - a[0]) / span));
    actionPose.x = lerp(a[1], b[1], u);
    actionPose.y = lerp(a[2], b[2], u);
    actionPose.z = lerp(a[3], b[3], u);
    actionPose.pitch = lerp(a[4], b[4], u);
    actionPose.yaw = lerp(a[5], b[5], u);
    actionPose.roll = lerp(a[6], b[6], u);
    actionPose.chestYaw = lerp(chan(a, 7), chan(b, 7), u);
    actionPose.chestPitch = lerp(chan(a, 8), chan(b, 8), u);
    actionPose.pelvisYaw = lerp(chan(a, 9), chan(b, 9), u);
    actionPose.drop = lerp(chan(a, 10), chan(b, 10), u);
    actionPose.stanceZ = lerp(chan(a, 11), chan(b, 11), u);
    actionPose.stanceSpread = lerp(chan(a, 12), chan(b, 12), u);
    actionPose.slide = lerp(chan(a, 13), chan(b, 13), u);
    actionPose.lean = lerp(chan(a, 14), chan(b, 14), u);

    // The hit window: one connect per swing, in the middle of it.
    const hitWin = action.spec.hit;
    if (hitWin && !action.hitDone && action.t >= hitWin[0] && action.t <= hitWin[1]) {
      action.hitDone = true;
      if (ctx.combat && ctx.combat.meleeStrike) {
        /* `strikeArc` is the turn slash's per-swing widening; every
           other action uses its authored arc. The sweep id is the VFX
           shape (4 spin, 5 lunge, 0 = draw by combo step), signed by
           the spin direction so a clockwise spin draws a clockwise
           crescent. `combo` stays 1-3 for progression - the spin and
           the lunge ARE the procession's first blow. */
        ctx.combat.meleeStrike(action.spec.damage,
          action.strikeArc || action.spec.arc,
          !!action.spec.slam, action.spec.lunge || 1, action.combo,
          (action.spec.sweep || 0) * (action.turnDir || 1));
      }
    }

    if (action.t >= action.spec.dur) {
      const chain = action.queued;
      const chainAimYaw = action.queuedAimYaw;
      const finishedMelee = !!action.name && action.name.startsWith("melee");
      action.queued = false;
      action.queuedAimYaw = null;
      action.name = null;
      action.spec = null;
      action.aimYaw = null;
      /* The grace period begins after recovery, not at the first wind-up.
         Starting it when the strike began consumed most of the nominal
         window inside the authored animation and left only a few tenths for
         an actual defensive decision. */
      if (finishedMelee) action.comboAt = state.clock;
      if (chain) meleeSwing(chainAimYaw);
    }
  }

  function groundY(x, z) {
    return ctx.collide ? ctx.collide.groundHeight(x, z) : terrain.heightAt(x, z);
  }

  /** Update only the steep-DOWNHILL presentation latch.
   *
   * `rawGrade` comes from the ground delta along the displacement that
   * collision actually allowed. It therefore cannot trigger because a
   * hill happens to be nearby, because the body is merely facing down
   * one, or while walking along a contour. */
  function updateDownhill(rawGrade, eligible, dt) {
    const targetGrade = eligible ? Math.max(0, rawGrade) : 0;
    state.downhillGrade = damp(
      state.downhillGrade,
      targetGrade,
      targetGrade > state.downhillGrade ? 20 : 8,
      dt
    );
    const wasSliding = state.downhillSliding;
    if (wasSliding) {
      state.downhillSliding = eligible
        && state.downhillGrade > DOWNHILL_SLIDE_EXIT_GRADE;
    } else {
      state.downhillSliding = eligible
        && state.downhillGrade >= DOWNHILL_SLIDE_ENTER_GRADE;
    }
    if (state.downhillSliding !== wasSliding) {
      /* A planted walk foot is fixed in world space. A skid foot rides
         with the body. Clear the old ownership at both boundaries so
         neither solver drags a target inherited from the other. */
      for (const leg of legs) {
        leg.planted = false;
        leg.swinging = false;
      }
    }
    state.downhillPose = damp(
      state.downhillPose,
      state.downhillSliding ? 1 : 0,
      state.downhillSliding ? 11 : 8,
      dt
    );
  }

  function walkableFrom(fromX, fromZ, dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return true;
    const ux = dx / len;
    const uz = dz / len;
    const here = groundY(fromX, fromZ);
    if (groundY(
      fromX + ux * WALK_SLOPE_NEAR,
      fromZ + uz * WALK_SLOPE_NEAR
    ) - here > WALK_MAX_STEP_UP) return false;
    const rise = groundY(
      fromX + ux * WALK_SLOPE_LOOK,
      fromZ + uz * WALK_SLOPE_LOOK
    ) - here;
    return rise / WALK_SLOPE_LOOK < WALK_SLOPE_LIMIT;
  }

  function boostWalkableFrom(fromX, fromZ, dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return true;
    const destX = fromX + dx;
    const destZ = fromZ + dz;
    const here = groundY(fromX, fromZ);
    const dest = groundY(destX, destZ);
    if (ctx.collide?.blocked?.(destX, destZ, dest)) return false;
    const grade = Math.abs(dest - here) / len;
    return grade < 3.8;
  }

  /** Directed downhill grade and the sharpest local descent along an
   *  already collision-resolved move. Sampling every 18cm prevents a
   *  low-FPS frame from averaging a real ledge into a legal hill. */
  function downhillAlong(fromX, fromZ, toX, toZ) {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-6) return { grade: 0, maxGrade: 0, groundDelta: 0 };
    const steps = Math.max(1, Math.ceil(distance / 0.18));
    const segment = distance / steps;
    let previous = groundY(fromX, fromZ);
    let maxGrade = 0;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const next = groundY(fromX + dx * t, fromZ + dz * t);
      maxGrade = Math.max(maxGrade, (previous - next) / segment);
      previous = next;
    }
    const groundDelta = previous - groundY(fromX, fromZ);
    return {
      grade: Math.max(0, -groundDelta / distance),
      maxGrade: Math.max(0, maxGrade),
      groundDelta,
    };
  }

  const safeAnchor = { x: state.x, y: state.y, z: state.z, yaw: state.yaw };
  let safeAnchorTimer = 0;
  let stuckClock = 0;

  function unstuck(reason = "auto") {
    const curX = state.x;
    const curY = state.y;
    const curZ = state.z;
    const curGy = groundY(curX, curZ);

    let open = null;
    if (ctx.collide?.findOpen) {
      open = ctx.collide.findOpen(curX, curZ, curGy, 48, 10.0, ctx.collide.radius, undefined, (tx, tz) => {
        const tgy = groundY(tx, tz);
        return !ctx.collide.blocked(tx, tz, tgy) && (walkableFrom ? walkableFrom(tx, tz, 0.1, 0.1) : true);
      });
    }

    if (!open && ctx.collide?.findFlightLanding) {
      open = ctx.collide.findFlightLanding(curX, curZ, curY, 12.0);
    }

    let targetX, targetZ, targetYaw;
    if (open && Number.isFinite(open[0]) && Number.isFinite(open[1])) {
      targetX = open[0];
      targetZ = open[1];
      targetYaw = state.yaw;
    } else if (safeAnchor && Number.isFinite(safeAnchor.x) && Number.isFinite(safeAnchor.z)
      && Math.hypot(safeAnchor.x - curX, safeAnchor.z - curZ) < 120.0) {
      targetX = safeAnchor.x;
      targetZ = safeAnchor.z;
      targetYaw = safeAnchor.yaw;
    } else {
      targetX = clamp(curX, -1000, 1000);
      targetZ = clamp(curZ, -1000, 1000);
      targetYaw = state.yaw;
    }

    spawn(targetX, targetZ, targetYaw);
    stuckClock = 0;

    try { ctx.audio?.chord?.([262, 330, 392, 523], 0.28, 0.12); } catch (_) {}
    try { ctx.gameUi?.announce?.("Position recovered"); } catch (_) {}
    return { x: targetX, y: state.y, z: targetZ, reason };
  }

  function spawn(x, z, yaw) {
    state.x = x;
    state.z = z;
    state.y = groundY(x, z);
    state.vy = 0;
    state.grounded = true;
    state.speed = 0;
    if (yaw !== undefined) { state.yaw = yaw; state.camYaw = yaw; }
    state.travelYaw = state.yaw;
    state.travelSpeed = 0;
    state.downhillGrade = 0;
    state.downhillSliding = false;
    state.downhillPose = 0;
    state.stride = 0;
    state.gait = 0;
    camAnchorReady = false;
    /* UNPLANT THE FEET.

       `spawn` moved the body and left the foot IK targets where they
       were. `poseFigure` teleports the figure ~510m to a flat site, so
       both plants stayed half a kilometre away and eased in at
       `1 - exp(-9dt)` - with the target outside the reachable annulus
       the whole time, so `solveTwoJoint` clamped and each leg pointed
       straight at it.

       Measured: 0.9 seconds after a spawn the sabatons are still
       0.78m IN THE AIR with the legs folded up inside the robe. Every
       hero shot is taken at t=0.35s and every turntable frame at
       t~0, so EVERY review image and EVERY gate in this project has
       been photographing a figure with no legs. Run against a settled
       figure the shape gate reports mean 28% where the shipped
       harness reports 80% - 52 points of the error was this.

       The `!leg.planted` branch in solveLegs already snaps plant and
       foot correctly; it was never being asked to. */
    for (const leg of legs) leg.planted = false;
    ctx.jetpack?.reset?.(true);
    ctx.boost?.reset?.(true);
    ctx.shield?.reset?.(true);
    /* Back on their feet. The fall is held rather than expiring, so
       this is the only thing that ends it - and it has to run after
       the position reset, or the pose is cleared on a body that is
       still lying where it died. */
    state.dying = false;
    state.deathPose = 0;
    /* AND THE HAZARDS GO WITH THE BODY. All three self-decay, so a
       lingering slow was only ever a second of wrongness - but a stun
       is different in kind: it takes the trigger as well as the feet,
       and a trooper who respawns unable to shoot has no way of
       knowing why. Nothing that was done to the previous body applies
       to this one. */
    clearSlow();
    clearRoot();
    clearStun();
    if (action.name === "death") cancelTransientActions();
  }
  spawn(state.x, state.z);

  /**
   * Everything the FIGURE does, independent of the camera.
   *
   * Split out because the free-camera path returns early - it is a
   * camera mode, not a pause - and with the posing inline below it,
   * every review harness that framed the figure froze the thing it
   * was pointed at. The character harness reported all five
   * animations moving the weapon 0.00m, which is what a suppressed
   * subject looks like rather than a broken one. Same failure as the
   * weapon harness photographing an empty road.
   */
  /** Flight gear is not the only way the feet can leave the ground.
   *  A vault, fall or ledge departure uses the same tucked-leg family
   *  without pretending the jetpack itself is active. */
  function airbornePose() {
    const equipment = Math.max(
      clamp01(ctx.jetpack?.state?.pose || 0),
      clamp01(ctx.slam?.state?.pose || 0)
    );
    if (state.grounded) return equipment;
    return Math.max(equipment, clamp01(0.62 + Math.abs(state.vy) * 0.045));
  }

  function applyFigurePose(dt) {
    /* Where the body IS, not just what it is doing.
       This lived below the free-camera return with the rest of the
       movement code, so a harness that framed the figure got one
       parked wherever it last stood under player control - the
       turntable rendered eight frames of empty sand and the
       silhouette metric reported 0% coverage, which is what an
       absent subject looks like. Position, facing, legs and crouch
       are body state; only the camera belongs to the camera. */
    /* Read once a frame, before anything asks for the gait: the
       stride length depends on it and the sole angle is measured
       against it. Damped, because a single height sample under a
       moving body crosses every pebble on the level and a stride
       that changed length per pebble would be its own defect. */
    const slopeAhead = (groundY(
      state.x + Math.sin(state.yaw) * 1.4,
      state.z + Math.cos(state.yaw) * 1.4
    ) - groundY(state.x, state.z)) / 1.4;
    state.slopeGrade = damp(
      state.slopeGrade,
      Number.isFinite(slopeAhead) ? clamp(slopeAhead, -2, 2) : 0,
      7, dt
    );
    const gait = readGaitSpec();
    const jetPose = clamp01(ctx.jetpack?.state?.pose || 0);
    const boostPose = clamp01(ctx.boost?.state?.pose || 0);
    const groundedMotion = state.grounded ? 1 - jetPose : 0;
    const downhillPose = clamp01(state.downhillPose) * groundedMotion;
    /* A skid translates without stepping. Fade the cadence-derived
       compression and run lean as the brace pose takes ownership, or
       the body continues bobbing like it is walking above fixed feet. */
    const gaitMotion = groundedMotion * (1 - downhillPose);
    const movingWeight = clamp01(state.speed / WALK) * gaitMotion;
    const walkLeanN = clamp01(state.speed / WALK);
    const sprintLeanN = clamp01(
      (state.speed - WALK) / Math.max(0.1, SPRINT - WALK)
    );
    /* THE LEAN IS SPLIT: most of it belongs to the WHOLE BODY, and
       only the remainder to the spine.

       All of it used to be spine. The shoulder line reached 13.2deg
       at a sprint, which is the right number, and the figure still
       read as bolt upright and rigid at speed - because a person
       running does not hunch, they TIP, from the ankles, with the
       pelvis leading and the legs trailing behind the mass. Bending
       only the spine above a vertical pelvis and vertical legs is a
       stoop, and a stoop reads as posture rather than as momentum.

       So `bodyLean` tilts the figure root, which sits at the feet, so
       the whole trooper pivots about the ground the way a runner
       does; `travelLean` keeps what is left for the spine. The two
       still SUM to the angle the shoulder line had before - 5.7deg
       walking, and now 16deg at a sprint rather than 13.2 - which
       matters because every arm pole, grip seat and hand basis in
       this file was tuned against that shoulder angle and none of
       them needs to move. Those two figures are the DEFAULTS of the
       four lean constants above; a figure may author its own, and a
       heavy one should.

       The legs absorb it: their IK targets are world-space foot
       plants, so tipping the hips forward is a reach they solve
       against rather than a pose that drags the feet. */
    /* The fall's own attitude, added on top: back over the raised
       lance while it charges, then thrown forward so the lance leads
       the body down. The root pivots at the soles, so this tips the
       whole trooper the way a diver tips rather than folding a spine. */
    const slamLean = ctx.slam?.state?.lean || 0;
    const backpedalPose = backpedalWeight();
    const ordinaryLocomotionLean = (LEAN_WALK * walkLeanN + LEAN_SPRINT * sprintLeanN)
      * gaitMotion * lerp(1, 0.42, backpedalPose);
    /* Counter-lean uphill while the boots run downhill. The root is
       pitched from the soles, so a modest negative angle puts the
       hips behind the planted-looking brace without folding the
       breastplate or breaking the two-handed weapon solve. */
    const locomotionLean = ordinaryLocomotionLean
      - downhillPose * 0.14
      + boostPose * 0.075;
    const bodyLean = locomotionLean + slamLean
      + (Number.isFinite(actionPose.lean) ? actionPose.lean : 0);
    const travelLean = (SPINE_LEAN_WALK * walkLeanN + SPINE_LEAN_SPRINT * sprintLeanN)
      * gaitMotion
      * lerp(1, 0.55, backpedalPose)
      - downhillPose * 0.035
      + 0.37 * jetPose;
    // Hip height is the leg, and the root sits at the sole.
    /* Only the LOCOMOTION lean tracks the hips forward. That
       compensation exists so a running trooper's feet stay under the
       mass; applied to a dive it would drag the body a metre out of
       its own collision capsule. */
    leanFootShift = Math.sin(locomotionLean)
      * (figure.limb.thigh + figure.limb.shin + figure.limb.ankle);
    /* Turn the breastplate toward the right-side handhold.  This is
       a torso stance, not a whole-character yaw: the hips continue
       down the path while the shoulders settle behind the weapon.
       ADS adds a little more commitment; melee actions already carry
       their own large authored chest turns, so only a quarter of the
       carry bias remains during a swing. */
    const polearmCarry = !!ctx.weapons?.current?.spec?.polearm;
    /* A slung weapon no longer owns the shoulders.  Leaving the
       low-ready twist active after both hands released did more than
       turn the breastplate: Meshy's raked Spine local Y leaked that
       nominal yaw into 6.8 degrees of backward pitch.  Fade the whole
       carry posture with the same hand-release channel that blends the
       weapon onto the back, so sheathed locomotion starts from the
       neutral torso while draw/sheathe transitions remain continuous. */
    const carryGripWeight = polearmCarry
      ? 1 - clamp01(ctx.weapons?.carry?.handRelease ?? 0)
      : 0;
    const carryAim = clamp01(ctx.weapons?.carry?.ads || 0);
    const carryActionWeight = action.name ? 0.25 : 1;
    const carryStanceYaw = polearmCarry
      ? lerp(-0.31, -0.39, carryAim) * carryActionWeight * carryGripWeight
      : 0;
    /* THE SHOULDER LINE DOES NOT OWN THE RETICLE.

       This used to be the raw `angleDelta(yaw, aimViewYaw)` - the
       chest tracking the camera 1:1, with no limit. It was put there
       for a real reason: without it, orbiting the camera forced the
       rear hand to absorb the entire aim turn and either collapsed
       the elbow or pulled the arm straight. But an unlimited follow
       means looking behind you spins the breastplate a half-turn on
       top of stationary hips, and a human torso does not do that.

       Two changes. The follow is gated on COMMITMENT - the player
       actually firing or aiming, tracked below - so free look moves
       the camera and nothing else. And what remains is clamped to a
       twist a body can hold, with `state.yaw` turning to cover the
       rest, so the legs come round instead of the spine winding up.
       The hand problem the original solved does not come back,
       because the weapon now only chases the camera by the same
       commitment factor (see weapons.js). */
    const carryAimYaw = polearmCarry && !state.free
      ? clamp(
        angleDelta(state.yaw, state.aimViewYaw ?? state.camYaw),
        -MAX_CHEST_TWIST, MAX_CHEST_TWIST
      ) * state.aimCommit * carryGripWeight
      : 0;
    const carryAimPitch = polearmCarry && !state.free
      ? clamp(CAMERA_AIM_BIAS - (state.aimViewPitch ?? CAMERA_AIM_BIAS), -0.40, 0.40)
        * carryGripWeight
      : 0;
    const carryChestYaw = carryStanceYaw + carryAimYaw;
    state.carryChestYaw = carryChestYaw;
    state.carryStanceYaw = carryStanceYaw;
    state.carryAimYaw = carryAimYaw;
    state.carryAimPitch = carryAimPitch;
    const stepPhase = ((state.gait * 2) % 1 + 1) % 1;
    /* Plate mass settles the pelvis into the legs, rises through the
       passing phase, then compresses sharply at contact. Locomotion
       speed stays profile-owned; this delayed vertical response is
       what makes the motion feel armoured instead of weightless. */
    const contactCompression = movingWeight * (0.028 + gait.bodyDrop * 0.14)
      * Math.exp(-stepPhase * 8.5) * IMPACT_SCALE;
    const passingRise = movingWeight * 0.014 * Math.sin(stepPhase * Math.PI)
      * PASSING_RISE_SCALE;
    /* Heavy figures do not glide straight through their stride. Their
       mass crosses onto the planted leg, then rolls back through the
       passing phase. This is presentation-only and deliberately small:
       collision remains centred while the plate visibly carries weight. */
    const weightPhase = Math.sin(state.gait * TAU);
    const weightSway = weightPhase * movingWeight * WEIGHT_SWAY_M;
    const weightRightX = Math.cos(state.yaw);
    const weightRightZ = -Math.sin(state.yaw);
    figure.root.position.set(
      state.x + weightRightX * weightSway,
      state.y - (gait.bodyDrop + contactCompression - passingRise) * groundedMotion
        - (ctx.jetpack?.state?.landPulse || 0) * 0.07
        - boostPose * 0.13
        - downhillPose * (0.13 + Math.sin(state.clock * 10.5) * 0.008),
      state.z + weightRightZ * weightSway
    );
    /* YXZ so the pitch is taken about the body's OWN right, after the
       yaw. In the default XYZ order the pitch would be applied about
       world X and the trooper would lean north-east whatever
       direction they were running in. */
    figure.root.rotation.order = "YXZ";
    figure.root.rotation.set(
      bodyLean,
      state.yaw + actionPose.pelvisYaw,
      Math.sin(state.clock * 7.5) * downhillPose * 0.014
        - weightPhase * movingWeight * WEIGHT_ROLL
    );
    figure.root.position.y += actionPose.drop;
    solveLegs(dt);
    // The arms are NOT posed here. They are solved onto the weapon
    // in postUpdate(), after the weapon has been moved for this
    // frame - posing them here would be overwritten, and posing
    // them instead of solving them is what made the hands miss the
    // grips by 15cm in every frame.
    const groundPoseDrop = state.grounded && !ctx.jetpack?.state?.inFlight
      ? Math.max(boostPose * 0.30, downhillPose * 0.40)
      : 0;
    const baseScale = figure.baseScale || { x: 1, y: 1, z: 1 };
    figure.root.scale.set(
      baseScale.x,
      baseScale.y * (1 - groundPoseDrop * 0.28),
      baseScale.z
    );

    /* Keep the chest mount at bind. Action rotation is applied to the
       polearm's own root in postUpdate(), after carry/recoil has been
       evaluated. Rotating this mount worked only while the weapon sat
       on the body centreline; with a true 42cm side carry it swung the
       entire offset around the sternum and threw both grips beyond arm
       reach. The chest still receives the authored body channels below. */
    if (figure.weaponBindPosition && figure.weaponBindQuaternion) {
      figure.weaponMount.position.copy(figure.weaponBindPosition);
      figure.weaponMount.quaternion.copy(figure.weaponBindQuaternion);
    } else {
      figure.weaponMount.position.set(MOUNT.x, MOUNT.y, MOUNT.z);
      figure.weaponMount.rotation.set(0, MOUNT_YAW, 0);
    }
    /* The body. The weapon mount hangs off the chest, so a swing now
       carries the ribcage, helm, halo, both shoulders and the weapon
       together and the arms trail through IK - which is the whole
       difference between a blow and a stick waved by a statue. The
       pelvis counter-rotates so the turn winds up rather than
       swivelling the whole figure. */
    if (figure.chest) {
      if (figure.chestBindQuaternion) {
        const strideWave = Math.sin(state.gait * TAU);
        poseEuler.set(
          actionPose.chestPitch,
          actionPose.chestYaw + carryStanceYaw
            - strideWave * movingWeight * 0.050,
          -strideWave * movingWeight * 0.020
        );
        chestOffset.setFromEuler(poseEuler);
        figure.chest.quaternion.copy(figure.chestBindQuaternion).multiply(chestOffset);
        /* Apply locomotion pitch in WORLD space around the knight's
           travel-right axis. Meshy's Spine local pitch axis is raked,
           so adding Euler X there partly cancelled at sprint speed.
           This makes 5.7/13.2 degrees mean exactly that on screen. */
        figure.chest.updateWorldMatrix(true, false);
        figure.chest.getWorldQuaternion(chestWorldQuaternion);
        /* The imported Spine's local Y is raked, so camera-follow yaw
           must be applied around WORLD up. Putting it into poseEuler
           turned part of a horizontal orbit into chest roll/pitch and
           still forced the trigger arm to absorb the missing yaw. */
        aimYawQuaternion.setFromAxisAngle(worldUp, carryAimYaw);
        chestWorldQuaternion.premultiply(aimYawQuaternion);
        travelRight.set(
          Math.cos(state.yaw + actionPose.pelvisYaw),
          0,
          -Math.sin(state.yaw + actionPose.pelvisYaw)
        ).normalize();
        travelLeanQuaternion.setFromAxisAngle(travelRight, travelLean);
        chestWorldQuaternion.premultiply(travelLeanQuaternion);
        /* Pitch the shoulder line with the aiming camera so looking
           uphill/downhill does not ask one fixed hand pivot to absorb
           the entire vertical turn. This is world-space for the same
           reason as the locomotion lean above: Meshy's Spine axes are
           raked relative to the rendered breastplate. */
        aimRight.set(
          Math.cos(state.camYaw), 0, -Math.sin(state.camYaw)
        ).normalize();
        aimPitchQuaternion.setFromAxisAngle(aimRight, carryAimPitch);
        chestWorldQuaternion.premultiply(aimPitchQuaternion);
        figure.chest.parent.getWorldQuaternion(chestParentQuaternion).invert();
        figure.chest.quaternion.copy(chestParentQuaternion).multiply(chestWorldQuaternion);
        figure.chest.updateWorldMatrix(false, true);
      } else {
        figure.chest.rotation.set(actionPose.chestPitch, actionPose.chestYaw, 0);
      }
    }
    /* Recover half the locomotion pitch through the neck so the
       armored mass leans while the helmet and sight line remain
       readable. Attack pitch is intentionally not cancelled. */
    if (figure.head && figure.headBindQuaternion) {
      figure.head.quaternion.copy(figure.headBindQuaternion);
      figure.head.updateWorldMatrix(true, false);
      figure.head.getWorldQuaternion(headWorldQuaternion);
      /* Half of the TOTAL lean, not half of the spine's share. The
         head hangs off the chest which hangs off the root, so it
         already carries both; recovering only the spine's part would
         let the helmet pitch down with the body lean and the trooper
         would sprint watching his own boots. */
      headOffset.setFromAxisAngle(travelRight, -(bodyLean + travelLean) * 0.50);
      headWorldQuaternion.premultiply(headOffset);
      /* Let the helmet keep watching the route while the ribcage
         turns into the weapon.  It follows enough of the twist to
         stay connected, but does not stare off the player's right
         shoulder in the low-ready stance. */
      headCarryYawQuaternion.setFromAxisAngle(worldUp, -carryStanceYaw * 0.55);
      headWorldQuaternion.premultiply(headCarryYawQuaternion);
      figure.head.parent.getWorldQuaternion(headParentQuaternion).invert();
      figure.head.quaternion.copy(headParentQuaternion).multiply(headWorldQuaternion);
      figure.head.updateWorldMatrix(false, true);
    }

    /* Halo and tabard lag the body.
       Both are rigid geometry, so the only thing that makes them
       read as hanging is that they arrive LATE and overshoot. Driven
       off the change in yaw and the current speed rather than off a
       clock, so they settle when the player stops. */
    const speedN = clamp01(state.speed / SPRINT);
    let dyaw = state.yaw - lastYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    lastYaw = state.yaw;
    swayVel += (-sway * 42 - swayVel * 8.5) * dt + dyaw * 3.4;
    sway += swayVel * dt;
    sway = clamp(sway, -0.55, 0.55);
    if (figure.crestPivot) {
      figure.crestPivot.rotation.x = HALO_X - speedN * 0.10 + Math.sin(state.stride * 2.1) * 0.02;
    }
    /* Pauldrons LAG the arm rather than riding it. Parented to the
       arm's IK pivot they inherited the full solve, and since the two
       hands go to different grips the two shoulders sat at different
       angles every frame.

       TAKEN AS A ROTATION, NOT AS THREE EULER NUMBERS. This scaled
       and clamped `arm.rotation.x/y/z` independently, and Euler
       angles are not a continuous measure of "how far has the arm
       turned": the decomposition flips branch as the arm swings, so
       an x of 3.0 becomes -3.0, or gimbal lock trades a large y
       against compensating x and z, for an arm pose that barely
       moved. Scaled by 0.22 and clamped at 0.20, that lands the
       plate on a completely different orientation from one frame to
       the next.

       Slerping from identity is the same intent expressed correctly:
       continuous everywhere, the angle it produces is exactly 22% of
       the arm's own, and the cap is a cap on that ANGLE rather than
       on three numbers that do not individually mean anything.

       NOTE ON SCOPE, because this was first written up as the cause
       of a reported shoulder bug and it is not: the SHIPPED figure is
       the imported Meshy rig, which returns `pauldronPivots: []`, so
       none of this runs on it. The reported "shoulder looks smaller
       after weapon use" was the upper arm's own roll winding up - see
       `resetArmsToBind`. This block is a real fix for the procedural
       FALLBACK figure and nothing more. */
    if (figure.pauldronPivots) {
      for (const pp of figure.pauldronPivots) {
        // Shortest-arc angle from rest. |w| because q and -q are the
        // same rotation and only one of them is the short way round.
        const armAngle = 2 * Math.acos(Math.min(1, Math.abs(pp.arm.quaternion.w)));
        const t = armAngle > 1e-4
          ? Math.min(PAULDRON_FOLLOW, PAULDRON_MAX_ANGLE / armAngle)
          : PAULDRON_FOLLOW;
        pp.node.quaternion.identity().slerp(pp.arm.quaternion, t);
      }
    }
    if (figure.clothPivots) {
      for (let i = 0; i < figure.clothPivots.length; i += 1) {
        const pv = figure.clothPivots[i];
        const phase = i * 0.7;
        // Blown back by movement, swung sideways by turning.
        pv.rotation.x = -speedN * 0.34 - Math.sin(state.stride * 3.1 + phase) * 0.07 * speedN;
        pv.rotation.z = sway * (0.5 + (i % 3) * 0.22)
          + Math.sin(state.stride * 2.6 + phase) * 0.05 * speedN;
      }
    }

  }

  function update(dt, camera) {
    state.clock += dt;
    const gaitAtFrameStart = state.gait;
    sampleAction(dt);
    /* How far through the fall, for the camera. Read off the action's
       own clock rather than tracked separately, so there is exactly one
       timeline and it is the one that poses the body. */
    state.deathPose = action.name === "death"
      ? clamp01(action.t / DEATH_FALL_SECONDS) : 0;
    const { lx, ly, jumpPressed } = input.poll();
    const shieldState = ctx.shield?.beginFrame?.(dt, state, input.state) || null;
    const shieldMode = !!shieldState?.active;
    /* The fall resolves BEFORE the pack, because committing to it
       cuts the pack: a slam that has to wait a frame for the jetpack
       to notice spends that frame still climbing. */
    const slamState = ctx.slam?.beginFrame?.(dt, state, input.state) || null;
    const slamMode = !!slamState?.active;
    /* SPACE BEATS THE GLIDE.
       Shift ignites the glide now, so the jetpack chord - Shift held,
       Space pressed - always arrives with a glide already running,
       and the pack refuses to light while one is. Cutting the glide
       here, before the pack reads its own gate, is what keeps "hold
       Shift and press Space" meaning exactly what it always meant.
       No cooldown: taking off is not a failed boost. */
    if (input.state.jetpack && ctx.boost?.state?.active) ctx.boost.stop("jetpack");
    const jetState = ctx.jetpack?.beginFrame?.(dt, state, input.state) || null;
    const flightMode = !!jetState?.inFlight;
    const boostState = ctx.boost?.beginFrame?.(dt, state, input.state) || null;
    const boostMode = !!boostState?.active && !flightMode && !slamMode;
    if (boostState?.justEnded) state.speed = Math.min(state.speed, SPRINT);

    /* The figure is hidden in free-camera mode by default, because
       beauty shots of the landscape should not have a trooper
       standing in them - but `figureOverride` can force it either
       way.
       That override is not a convenience. The weapon is parented to
       the figure's mount, so hiding the figure hides the weapon too,
       and the weapon review harness spent a round photographing an
       empty road: the tool was suppressing the exact object it was
       pointed at. */
    const showFigure = (state.figureOverride !== null
      ? state.figureOverride
      : !state.free) && ((state.firstPerson || 0) < 0.65);

    // Posed before the camera branch, so a free camera watches a
    // living figure instead of a statue.
    applyFigurePose(dt);
    const duskLight = clamp01(ctx.atmos.duskFactor || 0);
    const nightLight = clamp01(ctx.atmos.nightFactor || 0);
    const doctrineAttacking = doctrineGlow.attackRemaining > 0;
    if (doctrineAttacking) {
      doctrineGlow.attackRemaining = Math.max(0, doctrineGlow.attackRemaining - dt);
    }
    const doctrineTarget = doctrineAttacking ? doctrineGlow.peak : 0;
    const doctrineResponse = doctrineAttacking
      ? (doctrineGlow.reducedMotion ? 14 : 36)
      : doctrineGlow.decayRate;
    doctrineGlow.level = damp(doctrineGlow.level, doctrineTarget, doctrineResponse, dt);
    if (!doctrineAttacking && doctrineGlow.level < 0.001) {
      doctrineGlow.level = 0;
      doctrineGlow.peak = 0;
    }
    const doctrineLevel = doctrineGlow.level;
    if (figure.heartLight) {
      /* Dark when the figure is - the lamp used to vanish with the
         rig it was parented to; now that it is scene-parented (see
         the hoist in createPlayer) hiding has to be an intensity,
         never a visibility flip, or the light count changes and the
         whole level recompiles. */
      const heartScale = figure.heartLight.userData.sfIntensityScale ?? 1;
      const targetHeart = showFigure
        ? 0.16 + duskLight * 0.32 + nightLight * 0.24 + doctrineLevel * 0.92
        : 0;
      figure.heartLight.intensity = damp(
        figure.heartLight.intensity, targetHeart * heartScale, 8, dt);
      if (doctrineHeartBase) {
        figure.heartLight.color.copy(doctrineHeartBase)
          .lerp(doctrineGlow.colour, doctrineLevel * 0.68);
      }
      if (heartSocket) {
        heartSocket.updateWorldMatrix(true, false);
        figure.heartLight.position.setFromMatrixPosition(heartSocket.matrixWorld);
      }
    }
    /* The eyes ride the same time-of-day curve as the reliquary, so
       the two read as one lamp burning inside one suit. The night
       figure is the interesting case: the plate around the sockets
       has almost no lit value left, so the glow has to climb or the
       head goes dark while the chest is still lit. */
    if (figure.eyeGlow) {
      const targetEye = 4.2 + duskLight * 1.4 + nightLight * 2.4
        + doctrineLevel * 2.1;
      figure.eyeGlow.material.emissiveIntensity =
        damp(figure.eyeGlow.material.emissiveIntensity, targetEye, 8, dt);
      if (doctrineEyeBase) {
        figure.eyeGlow.material.emissive.copy(doctrineEyeBase)
          .lerp(doctrineGlow.colour, doctrineLevel * 0.54);
      }
    }
    if (figure.readabilityMaterials) {
      const factor = 0.12 + duskLight * 0.88 + nightLight;
      for (let i = 0; i < figure.readabilityMaterials.length; i += 1) {
        const material = figure.readabilityMaterials[i];
        const target = (material.userData.vesperReadability || 0.14) * factor
          + doctrineLevel * 0.18;
        material.emissiveIntensity = damp(material.emissiveIntensity, target, 8, dt);
        const baseEmissive = doctrineReadabilityBase[i];
        if (baseEmissive && material.emissive) {
          material.emissive.copy(baseEmissive)
            .lerp(doctrineGlow.colour, doctrineLevel * 0.34);
        }
      }
    }

    if (state.free) {
      camera.position.copy(state.freePos);
      camera.lookAt(state.freeTarget);
      if (camera.fov !== state.freeFov) {
        camera.fov = state.freeFov;
        camera.updateProjectionMatrix();
      }
      figure.root.visible = showFigure;
      return;
    }
    figure.root.visible = showFigure;

    /* Mouse look.
       The pitch axis was negated - a downward drag looked up - and
       is fixed here. The YAW axis was not, and briefly got "fixed"
       into being wrong: screen-right is cross(forward, up), which
       with the camera looking along +Z is -X, so swinging the view
       right DECREASES yaw. Deriving that from `forward = (sin yaw,
       cos yaw)` and assuming +X was right gave the opposite answer
       and broke a working control.

       LOOK-UP WAS 0.72rad and is now 1.05 - 41 degrees to 60. The
       old number was not wrong on its own; it was written when the
       boom lifted itself out of the ground instead of shortening,
       and under that camera the top of the range was unreachable
       anyway. With the boom fixed the range is real, and 41 degrees
       is not enough to put the reticle on a Gleaner standing on a
       ridge above you - which is most ridges, on a map made of
       craters and dunes. */
    state.camYaw -= lx * 0.0022;
    state.camPitch = clamp(state.camPitch + ly * 0.0020, -1.05, 1.15);

    /* --- movement, camera-relative --- */
    /* Death removes steering authority while preserving gravity and
       a safe landing. Otherwise a dead airborne player can travel
       tens of metres during the respawn timer by continuing to hold
       WASD, which relocates the eventual spawn/camera context. */
    const movementLocked = !!ctx.combat?.player?.dead;
    const mx = movementLocked ? 0 : input.state.move.x;
    const mz = movementLocked ? 0 : input.state.move.y;
    const mag = Math.hypot(mx, mz);

    /* Read from `weapons.carry.ads`, not from the raw mouse button.
       main.js already refuses ADS for a melee weapon and in flight,
       and duplicating those conditions here is how the camera ends up
       zoomed while the weapon is not raised. */
    const sightWant = boostMode || shieldMode ? 0 : clamp01(ctx.weapons?.carry?.ads || 0);
    // Up faster than down: raising sights is a decision, lowering
    // them is a release.
    state.sighted = damp(state.sighted, sightWant,
      sightWant > state.sighted ? 11 : 8, dt);

    const isMeleeAction = !!(action.name && action.name.startsWith("melee"));
    /* Actions with their own drive profile (the lunge) are excluded:
       the profile owns their speed below, and letting the thrust jog
       target fight it would re-accelerate the recovery. */
    const isForwardMelee = isMeleeAction && mz < -0.1 && !action.spec?.drive;

    const target = boostMode
      ? boostState.speed
      : shieldMode
        ? (Number.isFinite(shieldState?.moveSpeed)
          ? shieldState.moveSpeed : ctx.shield.config.moveSpeed)
        : flightMode
          ? (jetState.active ? ctx.jetpack.config.cruiseSpeed : ctx.jetpack.config.glideSpeed)
            * FLIGHT_SPEED_SCALE
          : isForwardMelee
            ? MELEE_THRUST_SPEED
            : (action.name ? WALK : SPRINT);
    /* Sighted movement is a walk at best. The multiplier is applied to
       the TARGET rather than gating sprint, so it also removes the
       sprint option by arithmetic: 8.6 * 0.46 is below the 4.4 walk,
       and a player holding shift and the right button simply moves at
       aiming pace instead of getting a second speed the animation
       never expected. */
    const sighted = flightMode || shieldMode ? 0 : state.sighted;
    /* Digital keys still arrive at magnitude 1 (or sqrt(2) on a
       diagonal), while the touch stick deliberately carries values
       between zero and one. Preserve the keyboard pace, but let a
       half-tilted thumbstick produce a half-speed walk instead of
       snapping straight to full speed. Boost owns its own envelope. */
    const inputAmount = boostMode ? 1 : clamp01(mag);
    /* A hazard's own ground-speed penalty, decaying on its own clock
       rather than trusting whatever set it to clear it again - a
       boss that dies mid-effect must not leave the player permanently
       at quarter speed because nothing was left to call clearSlow(). */
    if (state.slowFor > 0) {
      state.slowFor = Math.max(0, state.slowFor - dt);
      if (state.slowFor <= 0) state.slowFactor = 1;
    }
    /* Held fast. Same self-decaying clock as the slow, for the same
       reason: whatever pinned the trooper may not be there to let go. */
    if (state.rootFor > 0) state.rootFor = Math.max(0, state.rootFor - dt);
    /* And flattened, on its own clock for the same reason again. A
       stun implies a root everywhere below, so the two only ever need
       to be read as one flag from here on. */
    if (state.stunFor > 0) state.stunFor = Math.max(0, state.stunFor - dt);
    const rooted = state.rootFor > 0 || state.stunFor > 0;
    /* THE LUNGE DRIVE. A trapezoid over the clip's own timeline: ramp
       in, hold through the closing dash, fade through recovery. It is
       a FLOOR under the damped speed rather than a target, so the
       dash is ballistic - releasing W mid-lunge does not abort it, and
       the ordinary damp takes over seamlessly as the profile fades.
       Zeroed by everything that pins the trooper (web, stun) and by
       every mode that owns speed outright. */
    let lungeDrive = 0;
    const driveSpec = action.spec?.drive;
    if (driveSpec && !rooted && !flightMode && !boostMode && !shieldMode
      && !slamMode && !movementLocked) {
      const dt0 = action.t;
      if (dt0 <= driveSpec.start) lungeDrive = 0;
      else if (dt0 < driveSpec.ramp) {
        lungeDrive = clamp01((dt0 - driveSpec.start)
          / Math.max(1e-4, driveSpec.ramp - driveSpec.start));
      } else if (dt0 <= driveSpec.end) lungeDrive = 1;
      else lungeDrive = clamp01(1 - (dt0 - driveSpec.end) / Math.max(1e-4, driveSpec.fade));
    }
    const wanted = rooted || slamMode || (shieldMode && shieldState?.movementLocked) ? 0
      : (mag > 0.01 || boostMode)
        ? target * lerp(1, ADS_SPEED, sighted) * inputAmount * state.slowFactor : 0;
    if (shieldMode && shieldState?.movementLocked) {
      state.speed = 0;
    } else if (rooted && !flightMode) {
      // Pinned mid-stride stops dead. The skid a damped stop would
      // allow is a metre and a half at a sprint, and a web that lets
      // you jog a metre and a half is not a web.
      state.speed = 0;
    } else if (boostMode) {
      state.speed = wanted;
    } else if (flightMode) {
      const rate = wanted > state.speed
        ? ctx.jetpack.config.acceleration
        : ctx.jetpack.config.glideDrag;
      state.speed += clamp(wanted - state.speed, -rate * dt, rate * dt);
    } else {
      const speedResponse = wanted > state.speed
        ? (isForwardMelee ? 18.0 : (shieldMode ? 7.5 : GROUND_ACCEL_RESPONSE))
        : GROUND_DECEL_RESPONSE;
      state.speed = damp(state.speed, wanted, speedResponse, dt);
      if (lungeDrive > 0) {
        const driveMax = action.name === "meleePierce" ? MELEE_PIERCE_SPEED : MELEE_LUNGE_SPEED;
        state.speed = Math.max(state.speed,
          driveMax * lungeDrive * state.slowFactor);
      }
    }
    if (flightMode) jetState.horizontalSpeed = state.speed;

    /* --- aim commitment ---
       Left mouse is the commit. ADS counts too: holding sights on a
       target is the same statement of intent as shooting at it, and
       a trooper who aims without turning to face what they are
       aiming at looks broken in exactly the way this replaces.

       The hold is what makes semi-auto fire usable. Commitment keyed
       directly to the button would collapse between two clicks and
       the shoulders would strobe; half a second of memory means a
       burst reads as one sustained engagement. */
    /* Read the weapon's ADS as well as the raw button. They are
       normally the same thing - main.js drives one from the other -
       but not always: the review harnesses put the weapon into sights
       directly through `weapons.setAds`, and a trooper who is visibly
       aiming down the lance while the commitment says otherwise would
       photograph the low-ready pose in every aimed shot. Commitment
       should follow the state of the game, not the state of a
       button. */
    /* Firing commits the shoulders WHEREVER the trooper is. Flight
       and the glide used to be excluded, which was correct while
       neither could shoot; now that both can, excluding them would
       leave the lance pointing down the body's line of travel while
       the bolt left along the reticle - the exact disagreement the
       aim solve exists to prevent. The slam keeps its exclusion: the
       lance is overhead and committed for the whole of it. */
    const committing = !state.free && !slamMode && !shieldMode && (
      input.state.firing
      || input.state.ads
      || (ctx.weapons?.carry?.ads || 0) > 0.5
    );
    if (committing) state.aimHold = 0.55;
    else state.aimHold = Math.max(0, state.aimHold - dt);
    state.aimCommit = damp(state.aimCommit, state.aimHold > 0 ? 1 : 0,
      state.aimHold > 0 ? 15 : 3.4, dt);

    /* --- facing ---
       Locomotion proposes it; the aim only overrides what the spine
       physically cannot cover.

       The naive version of "turn the body to the firing direction"
       drives `state.yaw` straight at the reticle, and because travel
       follows facing in this game that quietly hijacks the stick:
       hold fire at a target 20 degrees off your path and you slew
       onto it. Wrong, and unnecessary - 20 degrees is well inside a
       shoulder turn.

       So the legs are asked to cover only the EXCESS beyond
       `MAX_CHEST_TWIST`. Shooting at something roughly ahead turns
       the torso alone and leaves the path exactly as the player set
       it; shooting at something behind you turns the whole trooper,
       because a spine cannot do it and that is the case the report
       was actually about. */
    const yawBefore = state.yaw;
    let wantYaw = state.yaw;
    if (boostMode) {
      wantYaw = boostState.yaw;
    } else if (shieldMode) {
      wantYaw = state.camYaw;
    } else if (mag > 0.01) {
      /* Both input axes are SCREEN axes and both need negating.

         `move.y` is -1 for W, the way a stick reports forward, but
         atan2 wants a world-space forward; raw, it put W at
         atan2(0,-1) = pi, exactly backwards.

         `move.x` needed it for a subtler reason: screen-right is
         cross(forward, up), and with the camera looking along +Z
         that is -X. Adding +pi/2 for D therefore walked the trooper
         screen-LEFT. It is easy to check this against the wrong
         convention and conclude the strafe is fine - which is what
         happened - so controlCheck now measures displacement against
         the live camera's own basis instead of against an assumed
         axis. */
      wantYaw = state.camYaw + Math.atan2(-mx, -mz);
    }
    const meleeFacing = action.name && action.name.startsWith("melee")
      && Number.isFinite(action.aimYaw);
    /* The turn slash's spin is AUTHORED, not damped: a smoothstep over
       the clip's `turn` window spreads the pivot evenly instead of
       front-loading it the way an exponential response does, and once
       the window ends the profile holds the captured bearing exactly
       for the rest of the swing. Driven off `action.t`, so a throttled
       frame turns further rather than falling behind its own strike. */
    const turnDrive = meleeFacing && Array.isArray(action.spec?.turn)
      && Number.isFinite(action.turnFrom);
    if (turnDrive) {
      const tw = action.spec.turn;
      const u = clamp01((action.t - tw[0]) / Math.max(1e-4, tw[1] - tw[0]));
      const eased = u * u * (3 - 2 * u);
      wantYaw = action.turnFrom + action.turnSweep * eased;
    } else if (meleeFacing) {
      /* Keep the animation and combat arc on one body frame for the
         whole blow. Translation remains camera-relative below, so
         turning the shoulders cannot reverse a held movement key. */
      wantYaw = action.aimYaw;
    } else if (state.aimCommit > 0.002 && !state.free) {
      const aimYaw = state.aimViewYaw ?? state.camYaw;
      const backpedalling = mz > 0.2 && Math.abs(mx) < 0.35;
      if (backpedalling) {
        /* A firing reverse is a backpedal, not a turn-and-run. Keep
           the hips under the reticle so the knees can cycle straight
           backward beneath a stable combat stance. Leaving the body
           at the edge of the chest-twist limit made pure S a 126deg
           crab step; even with correct translation, the feet had to
           cross the pelvis to keep up. */
        wantYaw = aimYaw;
      } else {
        const over = Math.abs(angleDelta(wantYaw, aimYaw)) - MAX_CHEST_TWIST;
        if (over > 0) {
          wantYaw += Math.sign(angleDelta(wantYaw, aimYaw)) * over * state.aimCommit;
        }
      }
    }
    const turnResponse = meleeFacing ? MELEE_TURN_RESPONSE
      : boostMode ? 24
      : shieldMode ? 20
        : lerp(
          lerp(10.0, 6.4, clamp01(state.speed / SPRINT)),
          12.0,
          state.aimCommit
        ) * TURN_RESPONSE_SCALE;
    if (turnDrive) {
      // The profile IS the trajectory; damping it would lag the strike.
      state.yaw = Math.atan2(Math.sin(wantYaw), Math.cos(wantYaw));
    } else {
      state.yaw = dampAngle(state.yaw, wantYaw, turnResponse, dt);
    }
    /* Measure the turn rate that ACTUALLY happened rather than the
       one that was asked for; the damping above means those differ
       by a factor of three at the start of a hard turn, and the leg
       prediction wants the real one. Low-passed because a raw
       per-frame difference is noise at 60Hz and the foot targets
       derived from it would jitter. A body turning to face a target
       while standing still is still turning, so the gait has to see
       it - this is what keeps the feet stepping round the turn
       instead of pivoting on the spot like a mannequin. */
    const yawStep = angleDelta(yawBefore, state.yaw) / Math.max(1e-5, dt);
    state.yawRate = damp(state.yawRate, yawStep, 14, dt);

    /* Flight resolves the complete frame displacement once, after
       vertical intent is known. Sweeping horizontal at the old Y and
       then vertical at the new XZ allows a descending diagonal to
       pass over an obstacle in the first query and below it in the
       second even though the real segment crosses the solid. */
    let flightWantX = state.x;
    let flightWantZ = state.z;
    const motionStartX = state.x;
    const motionStartZ = state.z;
    let downhillUpdated = false;
    if ((mag > 0.01 || boostMode || lungeDrive > 0) && !slamMode) {
      const step = state.speed * dt;
      /* Melee and ranged aim commitment can own the BODY bearing, but
         neither may steal the movement stick. Preserve the same
         camera-relative travel the pressed WASD direction requested;
         otherwise S can become forward movement toward the target and
         A/D gain a forward component as the body turns to aim. The
         existing gait already supports body-relative strafing during
         aim commitment.

         The LUNGE is the one exception, and deliberately: it is a
         committed dash along the bearing captured at the press. The
         stick cannot steer it mid-flight and releasing W does not
         stop it - which is what separates a lunge from a jog that
         happens to be swinging. */
      const moveYaw = boostMode ? boostState.yaw
        : lungeDrive > 0 && Number.isFinite(action.aimYaw) ? action.aimYaw
        : (shieldMode || meleeFacing || state.aimCommit > 0.002)
          ? state.camYaw + Math.atan2(-mx, -mz)
          : state.yaw;
      const nx = state.x + Math.sin(moveYaw) * step;
      const nz = state.z + Math.cos(moveYaw) * step;

      if (flightMode) {
        flightWantX = clamp(nx, -1010, 1010);
        flightWantZ = clamp(nz, -1010, 1010);
        /* A slope-embedded but walking-legal launch column exits
           vertically before accepting steering, so the takeoff
           exemption cannot be ratcheted sideways through a bank. */
        if (jetState.takeoffClearing) {
          flightWantX = state.x;
          flightWantZ = state.z;
        }
      } else {
      /* Slope limit, measured over a FIXED lookahead and applied per
         axis so that it deflects rather than freezes.

         Without a limit the player walks up crater walls like a fly.
         But the first version had two faults that together made the
         terrain feel like invisible walls. It measured the rise over
         one frame's step, so the gradient it computed depended on the
         player's current speed and the frame rate - tiny at the
         instant you start moving. And it was all-or-nothing: walking
         at any angle into a bank stopped the trooper dead instead of
         sliding them along it, which is what every shooter does and
         what a player expects.

         A fixed 0.55m probe is stable regardless of speed, and the
         axis-separated fallback is the same trick the masonry
         collision uses - so a steep flank now turns you along itself
         instead of pinning you. */
      /* Judged on the SUSTAINED slope over 1.6m, with a separate cap
         on how big a single step up may be.

         A short probe cannot tell a wall from a crest. The dune field
         is only 2.5% steeper than the limit, but steep ground does not
         have to be common to stop you - it has to be CONNECTED, and a
         slip-face ridge one metre wide is a wall that runs for
         hundreds of metres. Measured over 0.55m, every one of those
         crests read as a cliff, and a third of all attempts to walk
         off the Pilgrim's Road failed within fifty metres. That is
         what turns a map into a corridor.

         Over 1.6m a crest averages out and the player steps over it,
         while a crater wall stays steep for the whole probe and still
         stops them. The near check is what keeps that from becoming
         a licence to walk through a vertical face. */
      const walkable = (dx, dz) => (boostMode
        ? boostWalkableFrom(state.x, state.z, dx, dz)
        : walkableFrom(state.x, state.z, dx, dz));
      let mx2 = nx;
      let mz2 = nz;
      if (!walkable(nx - state.x, nz - state.z)) {
        const dx = nx - state.x;
        const dz = nz - state.z;
        const len = Math.hypot(dx, dz);
        const base = Math.atan2(dz, dx);
        let deflected = false;
        /* A slope is not an axis-aligned wall. Try increasingly broad
           contour-following turns so a trench bank or dune face
           deflects the player instead of producing a zero-motion
           frame. Every candidate still passes both slope gates, so
           this cannot ratchet a player up an unclimbable face. */
        for (const turn of [Math.PI / 8, -Math.PI / 8, Math.PI / 4, -Math.PI / 4,
          Math.PI * 3 / 8, -Math.PI * 3 / 8, Math.PI / 2, -Math.PI / 2]) {
          const tx = Math.cos(base + turn) * len;
          const tz = Math.sin(base + turn) * len;
          if (!walkable(tx, tz)) continue;
          mx2 = state.x + tx;
          mz2 = state.z + tz;
          deflected = true;
          break;
        }
        if (!deflected) {
          if (walkable(dx, 0)) mz2 = state.z;
          else if (walkable(0, dz)) mx2 = state.x;
          else { mx2 = state.x; mz2 = state.z; }
        }
      }
      {
        /* Masonry. `slide` returns the furthest legal position along
           the attempted move, falling back to each axis alone, which
           is what makes a corridor feel like a corridor instead of a
           full stop every time the stick is not exactly parallel to
           the wall. */
        let px = clamp(mx2, -1010, 1010);
        let pz = clamp(mz2, -1010, 1010);
        if (ctx.collide) {
          /* Grounded collision follows the walking surface at each
             candidate. Supplying the body's damped `state.y` here
             let a downhill step enter an obstacle before the body
             settled, after which reverse and strafe all read blocked. */
          if (boostMode && state.grounded) {
            /* Boost frames can cover multiple collision cells when a
               tab is throttled. Sweep them in capsule-sized grounded
               steps so a 100ms frame cannot hop a one-metre pillar. */
            const dx = px - state.x;
            const dz = pz - state.z;
            const count = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.20));
            const sx = dx / count;
            const sz = dz / count;
            let bx = state.x;
            let bz = state.z;
            for (let i = 0; i < count; i += 1) {
              const out = ctx.collide.slide(
                bx, bz, bx + sx, bz + sz, null, undefined,
                (tx, tz) => (boostMode
                  ? boostWalkableFrom(bx, bz, tx - bx, tz - bz)
                  : walkableFrom(bx, bz, tx - bx, tz - bz))
              );
              const moved = Math.hypot(out[0] - bx, out[1] - bz);
              bx = out[0];
              bz = out[1];
              if (moved < 1e-5) break;
            }
            px = bx;
            pz = bz;
          } else {
            const out = ctx.collide.slide(
              state.x, state.z, px, pz,
              state.grounded ? null : state.y,
              undefined,
              state.grounded
                ? (tx, tz) => walkable(tx - state.x, tz - state.z)
                : null
            );
            px = out[0];
            pz = out[1];
          }
        }
        // Stride is measured on the distance ACTUALLY travelled, not
        // the distance asked for. Walking into a wall must not keep
        // driving the gait, or the legs stroll on the spot.
        const travelled = Math.hypot(px - state.x, pz - state.z);
        const descent = downhillAlong(state.x, state.z, px, pz);
        const groundDelta = descent.groundDelta;
        const descentGrade = descent.grade;
        /* Carry a grounded body by the continuous surface delta BEFORE
           asking whether support was lost. Previously XZ advanced
           first while Y could descend only 1.5m/s; at full speed even
           a ten-degree hill outran that settle, opened a 20cm gap, and
           changed an ordinary walk into a fall.

           Preserve a real ledge: an abrupt drop steeper than the
           continuous-dune classifier is not ground transport, so the
           existing support test below hands it to gravity. Any
           pre-existing landing offset is preserved. */
        if (state.grounded && groundDelta < 0
          && descent.maxGrade <= DOWNHILL_MAX_CONTINUOUS_GRADE) {
          state.y += groundDelta;
        }
        if (boostMode) {
          const hereGy = groundY(px, pz);
          state.y = Math.max(state.y, hereGy);
        }
        const slideEligible = state.grounded
          && travelled > 1e-4
          && descentGrade > 0
          && descent.maxGrade <= DOWNHILL_MAX_CONTINUOUS_GRADE
          && !boostMode && !flightMode && !shieldMode && !slamMode;
        updateDownhill(descentGrade, slideEligible, dt);
        downhillUpdated = true;
        /* A boost is a committed lunge, not a six-metre sprint
           compressed into four frames. Its dedicated body-relative
           leg solve below owns the boots, so the walking clock freezes
           until normal locomotion resumes.
           A steep downhill skid uses the same visual truth: the boots
           move WITH the body instead of taking full walking strides. */
        const gaitTravel = !state.grounded
          ? 0
          : boostMode ? 0
            : travelled * lerp(1, 0.04, state.downhillPose);
        state.stride += gaitTravel;
        state.gait += gaitTravel / Math.max(0.55, readGaitSpec().strideLen);
        state.x = px;
        state.z = pz;
      }
      }
    }
    if (!downhillUpdated) updateDownhill(0, false, dt);
    /* THE STEP THE BODY STARTED HAS TO FINISH.
     *
     * The gait is integrated from DISTANCE TRAVELLED, which is the
     * whole reason a planted foot never slides - and it means a body
     * that stops advancing stops the cycle wherever it is. Braking
     * out of a sprint, that is a boot parked at knee height for the
     * half-second the trooper takes to shed 8m/s, and then a hurried
     * settle when the walk finally drops below its own threshold.
     * It is the third of the reported leg faults and the only one
     * that is neither an angle nor a snap: it is a leg that has
     * simply stopped animating while you watch it.
     *
     * So a swing - and ONLY a swing, never a planted foot - is given
     * a cadence floor that grows as the shortfall between the body's
     * speed and a walk grows. A stance foot is untouched, so distance
     * still owns the plant and the no-slip claim is unchanged. */
    if (state.grounded && !boostMode && !flightMode
      && (legs[0].swinging || legs[1].swinging)) {
      const shortfall = clamp01((GAIT_SETTLE_SPEED - state.speed) / GAIT_SETTLE_SPEED);
      const floor = dt * GAIT_SETTLE_CADENCE * shortfall;
      const advanced = state.gait - gaitAtFrameStart;
      if (floor > advanced) state.gait += floor - advanced;
    }
    if (boostMode) {
      ctx.boost?.noteMotion?.(motionStartX, motionStartZ, state.x, state.z, dt);
    }

    /* --- vertical --- */
    const gy = groundY(flightMode ? flightWantX : state.x, flightMode ? flightWantZ : state.z);
    if (!flightMode && state.grounded && state.y > gy + GROUNDED_SUPPORT_SKIN) {
      /* Ask the whole capsule footprint whether it is still supported.
         Center-only ground is wrong at a ridge: one sabaton can still
         be on the lip even when the pelvis has crossed it. Conversely,
         when the complete footprint is below the soles, keeping the
         grounded flag alive is literally walking on air. */
      const support = ctx.collide?.flightGroundHeight
        ? ctx.collide.flightGroundHeight(state.x, state.z, ctx.collide.radius)
        : gy;
      if (state.y > support + GROUNDED_SUPPORT_SKIN) {
        state.grounded = false;
        state.vy = Math.min(0, state.vy);
        for (const leg of legs) leg.planted = false;
      }
    }
    if (!flightMode && !shieldMode && state.grounded && jumpPressed && !input.state.jetpack
      && !rooted) {
      state.vy = 9.6;
      state.grounded = false;
    }
    if (flightMode) {
      const cfg = ctx.jetpack.config;
      const agl = state.y - gy;
      const ceiling = gy + cfg.maxAltitude;
      if (jetState.active) {
        // Lookahead along flight path to detect rising terrain / steep hills
        const speed = Math.max(15, state.speed);
        const lookDist = Math.max(3.0, speed * 0.45);
        const lookYaw = (Math.abs(mx) > 0.01 || Math.abs(mz) > 0.01)
          ? (state.camYaw + Math.atan2(-mx, -mz))
          : state.yaw;
        const lookX = clamp(state.x + Math.sin(lookYaw) * lookDist, -1010, 1010);
        const lookZ = clamp(state.z + Math.cos(lookYaw) * lookDist, -1010, 1010);
        const lookGy = groundY(lookX, lookZ);
        const aheadRise = Math.max(0, lookGy - gy);
        const effGround = Math.max(gy, lookGy);
        const effAgl = state.y - effGround;

        let targetVy;
        if (state.y >= ceiling - 0.12 || (state.y - gy) >= cfg.softAltitude) {
          targetVy = clamp((cfg.softAltitude - (state.y - gy)) * 2.4, -cfg.descendSpeed, 0);
        } else {
          const altitudeNeed = clamp((cfg.cruiseAltitude - effAgl) * 3.5, -3.5, 24.0);
          const terrainNeed = aheadRise > 0 ? (aheadRise / 0.40) : 0;
          targetVy = Math.max(altitudeNeed, clamp(terrainNeed + 3.0, 0, 24.0));
        }
        state.vy = damp(state.vy, targetVy, 9.0, dt);
      } else if (slamMode) {
        /* THE FALL OWNS THE AXIS, EVEN OUT OF A FLIGHT.
           Committing to the slam cuts the pack, but the pack stays
           `inFlight` until it lands - so the whole descent is still
           resolved here, by the capsule sweep, with the pack's gravity
           and terminal-fall clamp. Left alone that turned the fastest
           attack in the game into an ordinary drop that never struck
           anything. The fall replaces the velocity outright rather
           than accelerating from whatever the flight left behind. */
        state.vy = slamState.verticalSpeed;
      } else {
        state.vy = Math.max(-cfg.terminalFall, state.vy - cfg.gravity * dt);
      }

      let nextY = state.y + state.vy * dt;
      if (jetState.active) {
        nextY = Math.max(nextY, gy + 0.35);
      }
      /* A terrain drop can move the local ceiling far below the
         current body in one horizontal frame. Max altitude limits
         ascent; it must never teleport an already-airborne player
         downward to a newly lowered ceiling. The controller instead
         approaches it at the bounded descend speed above. */
      if (state.y <= ceiling && nextY > ceiling) {
        nextY = ceiling;
        state.vy = Math.min(0, state.vy);
      }
      let landingImpactSpeed = Math.max(0, -state.vy);
      let verticalHit = false;
      let terrainLandingContact = false;
      if (ctx.collide?.sweepFlightCapsule) {
        const attemptedVy = state.vy;
        landingImpactSpeed = Math.max(landingImpactSpeed, -attemptedVy);
        const startX = state.x;
        const startZ = state.z;
        const out = ctx.collide.sweepFlightCapsule(
          state.x, state.y, state.z,
          flightWantX, nextY, flightWantZ,
          ctx.collide.radius, 2.35, cfg.sweepStep, jetState.takeoffClearing
        );
        const travelled = Math.hypot(out.x - startX, out.z - startZ);
        state.x = out.x;
        state.z = out.z;
        state.y = out.y;
        if (jetState.takeoffClearing && !ctx.collide.flightBlocked(
          state.x, state.z, state.y, ctx.collide.radius, 2.35
        )) jetState.takeoffClearing = false;
        verticalHit = out.hitY;
        if (out.hitY && ctx.collide.flightGroundHeight) {
          const footprintSupport = ctx.collide.flightGroundHeight(
            state.x, state.z, ctx.collide.radius
          );
          const centerSupport = groundY(state.x, state.z);
          /* A terrain sweep resolves within the 2cm contact skin;
             roofs remain metres above this support footprint. Carry
             that source distinction into the landing handoff instead
             of guessing from center ground height. */
          terrainLandingContact = Number.isFinite(footprintSupport)
            && state.y <= footprintSupport + 0.04
            /* Reuse the grounded controller's actual step and sustained-
               slope gates. A fixed sub-step cutoff left fully walkable
               40-60cm rim rises hovering forever, while a multi-metre
               Fosse face still fails both the shared walkability test
               and the authoritative near-step cap. The full capsule
               footprint already spans the grounded controller's 0.45m
               near probe, while `blocked` verifies the center is a
               legal standing column without rejecting a valid contour
               landing just because one far direction climbs sharply. */
            && footprintSupport - centerSupport <= WALK_MAX_STEP_UP
            && !ctx.collide.blocked(state.x, state.z, centerSupport);
        }
        if (out.hitX || out.hitZ) {
          const localGround = groundY(state.x, state.z);
          const isTerrainContact = state.y <= localGround + 1.2;
          if (isTerrainContact && jetState.active) {
            state.y = Math.max(state.y, localGround + 0.35);
            state.vy = Math.max(state.vy, 10.0);
          } else {
            state.speed = Math.min(state.speed, Math.max(2.5, travelled / Math.max(dt, 1e-4)));
            jetState.horizontalSpeed = state.speed;
          }
        }
        ctx.jetpack.noteMotion(travelled, out.hitX || out.hitZ);
        if (out.hitY) {
          state.vy = 0;
          /* Roofs and catwalk decks are true flight collision but not
             walking supports. If an unpowered descent meets one,
             drift toward the nearest column that reaches authored
             ground instead of hovering forever on an ungroundable
             surface. The drift itself is swept, bounded and slow. */
          if (!terrainLandingContact && !jetState.active
            && attemptedVy < 0 && state.y > gy + 0.12
            && ctx.collide.findFlightLanding) {
            /* Landing-site search is the expensive part of the roof
               escape. Cache the validated static-world target across
               contact frames instead of rescanning up to 192 columns
               every tenth of a second. */
            const cached = jetState.landingAssist;
            let safe = cached && Math.hypot(cached[0] - state.x, cached[1] - state.z) <= 6.5
              ? cached : null;
            if (!safe && jetState.landingAssistRetry <= 0) {
              safe = ctx.collide.findFlightLanding(state.x, state.z, state.y, 6);
              if (!safe) {
                /* A broad roof can have no ground-reachable column
                   inside the first search ring. Choose a swept,
                   deterministic six-metre drift (biased toward the
                   map interior) and rescan from there, instead of
                   repeating an exhaustive null search every frame or
                   hovering forever. */
                const inward = Math.atan2(-state.z, -state.x);
                let best = null;
                let bestScore = -Infinity;
                for (const turn of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2,
                  -Math.PI / 2, Math.PI * 3 / 4, -Math.PI * 3 / 4, Math.PI]) {
                  const tx = state.x + Math.cos(inward + turn) * 6;
                  const tz = state.z + Math.sin(inward + turn) * 6;
                  const side = ctx.collide.sweepFlightCapsule(
                    state.x, state.y, state.z, tx, state.y, tz,
                    ctx.collide.radius, 2.35, cfg.sweepStep
                  );
                  const moved = Math.hypot(side.x - state.x, side.z - state.z);
                  if (moved < 0.5) continue;
                  const clearance = state.y - groundY(side.x, side.z);
                  const score = moved + clamp(clearance, 0, 16) * 0.04;
                  if (score > bestScore) {
                    bestScore = score;
                    best = [side.x, side.z, groundY(side.x, side.z)];
                  }
                }
                safe = best;
              }
              jetState.landingAssistRetry = 0.65;
            }
            if (safe) {
              jetState.landingAssist = safe;
              const dx = safe[0] - state.x;
              const dz = safe[1] - state.z;
              const distToSafe = Math.hypot(dx, dz);
              const assist = Math.min(distToSafe, 8 * dt);
              if (distToSafe > 0.12) {
                const side = ctx.collide.sweepFlightCapsule(
                  state.x, state.y, state.z,
                  state.x + dx / distToSafe * assist,
                  state.y,
                  state.z + dz / distToSafe * assist,
                  ctx.collide.radius, 2.35, cfg.sweepStep
                );
                state.x = side.x;
                state.z = side.z;
                state.vy = -3.5;
              }
              else {
                jetState.landingAssist = null;
                jetState.landingAssistRetry = 0;
              }
            }
          }
        } else {
          jetState.landingAssist = null;
        }
      } else {
        state.x = flightWantX;
        state.z = flightWantZ;
        state.y = nextY;
      }

      let support = groundY(state.x, state.z);
      /* A flight slam may reach terrain on the same sweep that its
         horizontal capsule brushes a Scar shard or vein. Handing that
         overlapping column to the grounded controller completes the
         slam inside static geometry: the attack fires, but every later
         movement frame is blocked. Reconcile only committed slam
         landings, and keep the correction local to the contact point. */
      if (slamMode && state.vy <= 0
        && (terrainLandingContact || state.y <= support + 0.10)
        && ctx.collide?.findOpen) {
        const radius = ctx.collide.radius;
        const staticBlocked = ctx.collide.blocked(state.x, state.z, support, radius)
          || ctx.collide.flightBlocked?.(state.x, state.z, support,
            radius, 2.35, true);
        if (staticBlocked) {
          state.slamLandingCorrections += 1;
          const safe = ctx.collide.findOpen(state.x, state.z, support,
            96, 8, radius, groundY, (tx, tz) => {
              const ty = groundY(tx, tz);
              return !ctx.collide.flightBlocked?.(tx, tz, ty, radius, 2.35, true);
            });
          if (safe) {
            state.x = safe[0];
            state.z = safe[1];
            support = groundY(state.x, state.z);
            state.y = support;
            terrainLandingContact = true;
          } else {
            /* A malformed authored pocket should not hold the player
               forever. The ordinary bounded recovery is the final
               fallback and still lets this committed slam resolve. */
            unstuck("slam-landing");
            support = groundY(state.x, state.z);
            terrainLandingContact = true;
          }
        }
      }
      /* Terrain contact hands the capsule back to the walking support
         even on a steep but legal slope. The center fallback preserves
         the old flat-ground behavior when a collision implementation
         does not expose footprint metadata. */
      if (state.vy <= 0 && (terrainLandingContact || state.y <= support + 0.10)) {
        /* sweepFlightCapsule zeroes vertical velocity on contact, so
           use the pre-contact descent captured above for landing
           animation/audio intensity. */
        const impact = landingImpactSpeed;
        /* Do not turn a valid rim contact into a center teleport.
           Preserve the collision-resolved height on the handoff
           frame; ordinary grounded easing can settle the body toward
           its walking support afterward without an under-hill pop. */
        state.y = terrainLandingContact
          ? Math.max(support, state.y)
          : support;
        state.vy = 0;
        state.grounded = true;
        state.speed = Math.min(state.speed, SPRINT);
        /* The pack still books its own landing - it is what clears
           `inFlight` and arms the recharge - but the slam's own strike
           is the louder event, so the pack lands silently under it. */
        ctx.jetpack.land(state, slamMode ? 0 : impact);
        for (const leg of legs) leg.planted = false;
        if (slamMode) ctx.slam.impact();
      } else {
        state.grounded = false;
        if (verticalHit && state.y < support) state.y = support;
      }
    } else if (!state.grounded) {
      /* A committed fall replaces gravity outright rather than adding
         to it. Accelerating a plunge from whatever vertical velocity
         the jump happened to leave behind makes the same input take a
         different amount of time depending on how it was entered,
         which is the one thing a telegraphed attack must not do. */
      if (slamMode) state.vy = slamState.verticalSpeed;
      else if (boostMode) {
        // Skimming / airborne glide: smooth gravity while thrusters maintain forward propulsion over terrain
        state.vy = Math.max(-12, state.vy - 14.0 * dt);
        state.y += state.vy * dt;
        if (state.y <= gy) {
          state.y = gy;
          state.vy = 0;
          state.grounded = true;
          for (const leg of legs) leg.planted = false;
        }
      } else {
        state.vy -= 19.6 * dt;
        state.y += state.vy * dt;
        if (state.y <= gy) {
          state.y = gy;
          state.vy = 0;
          state.grounded = true;
          for (const leg of legs) leg.planted = false;
          if (slamMode) ctx.slam.impact();
        }
      }
    } else {
      /* A collision-resolved landing can begin above center support on
         a legal slope. Exponential damping alone drops almost the full
         gap in one throttled 100ms frame; cap only the downward settle
         so touchdown cannot visibly pop under the hill at low FPS. */
      const easedGroundY = damp(state.y, gy, 22, dt);
      state.y = boostMode
        ? Math.max(state.y, gy)
        : (state.y > gy
          ? Math.max(gy, state.y - GROUNDED_SETTLE_DOWN_SPEED * dt, easedGroundY)
          : easedGroundY);
    }

    const travelX = state.x - motionStartX;
    const travelZ = state.z - motionStartZ;
    const travelDistance = Math.hypot(travelX, travelZ);
    if (travelDistance > 1e-5) state.travelYaw = Math.atan2(travelX, travelZ);
    const measuredTravelSpeed = dt > 1e-5 ? travelDistance / dt : 0;
    state.travelSpeed = damp(state.travelSpeed, measuredTravelSpeed, 18, dt);

    /* --- Stuck detection & auto-recovery --- */
    const isGameplayActive = ctx.runtime?.phase === "playing"
      && !ctx.runtime?.paused
      && !ctx.intro?.isBlocking?.()
      && !ctx.combat?.player?.dead
      && !state.free
      && !state.dying;

    if (isGameplayActive) {
      const curGround = groundY(state.x, state.z);
      /* Walking and flight deliberately use different collision rules.
         The flight capsule samples the complete terrain footprint and
         cannot apply the grounded controller's step allowance. Asking it
         to validate a grounded pose therefore marks legal slopes, paving
         relief and the landing-site approach as overlaps. The auto-recovery
         clock then calls `spawn` every 2.5 seconds, zeroing speed and gait
         even though grounded movement is legal.

         Detect penetration with the controller that currently owns the
         body. Grounded poses use the same walking support height as
         `slide`; airborne poses keep the full-height flight capsule. */
      const isOverlapping = state.grounded
        ? !!ctx.collide?.blocked?.(state.x, state.z, curGround, ctx.collide.radius)
        : !!ctx.collide?.flightBlocked?.(
          state.x, state.z, state.y, ctx.collide.radius, 2.0
        );
      const isTryingToMove = (mag > 0.05 || boostMode || input.state.move.x !== 0 || input.state.move.y !== 0) && !rooted;
      const isMotionless = travelDistance < 0.02 && state.travelSpeed < 0.05;

      // Floating/caught on an ungroundable structure/roof without active flight
      const isUngroundablePerch = !state.grounded && !flightMode && Math.abs(state.vy) < 0.25 && state.y > curGround + 0.15;

      // Legitimate safe grounded location
      const isLegitimatelySafe = state.grounded
        && !isOverlapping
        && state.y <= curGround + 0.10
        && Math.abs(state.vy) < 0.01;

      if (isLegitimatelySafe) {
        safeAnchorTimer += dt;
        if (safeAnchorTimer >= 0.8) {
          safeAnchorTimer = 0;
          safeAnchor.x = state.x;
          safeAnchor.y = state.y;
          safeAnchor.z = state.z;
          safeAnchor.yaw = state.yaw;
        }
      }

      const isStuck = isOverlapping
        || isUngroundablePerch
        || (isTryingToMove && isMotionless && (!state.grounded || isOverlapping));

      if (isStuck) {
        stuckClock += dt;
        if (stuckClock >= 2.5) { // 2.5s stuck in an object
          unstuck("auto");
        }
      } else {
        stuckClock = Math.max(0, stuckClock - dt * 2.0);
      }
    } else {
      stuckClock = 0;
    }

    applyFigurePose(dt);

    /* --- camera --- */
    const jetPose = clamp01(ctx.jetpack?.state?.pose || 0);
    /* THE DEATH CAMERA. Eased, not cut.
       A third-person camera that keeps its standing anchor while the
       body falls out from under it ends up looking at empty sand with
       the trooper somewhere below frame - which is exactly what a
       player does not want to be shown at the moment they most want
       to know what happened. The boom lengthens a little and the
       anchor comes down with the body. */
    const dyingPose = clamp01(state.deathPose);
    const dist = state.camDist
      * lerp(1.14, 1.27, jetPose)
      * (1 + dyingPose * 0.34);
    camOffset.set(
      Math.sin(state.camYaw) * Math.cos(state.camPitch),
      -Math.sin(state.camPitch),
      Math.cos(state.camYaw) * Math.cos(state.camPitch)
    ).multiplyScalar(-dist);

    tmp.set(state.x,
      state.y + EYE + jetPose * 0.24 - dyingPose * (EYE - 0.75),
      state.z);
    const want = tmp.clone().add(camOffset);
    /* Keep the camera out of the ground by SHORTENING THE BOOM, not
       by lifting it.

       Lifting was the original approach and it silently ate almost
       the whole look-up range. The boom points opposite the view, so
       looking up swings the camera DOWN and back - at the -0.72rad
       limit that is 3.4m below the trooper on a 5.2m boom, which on
       flat ground is two metres underground. Raising it back out put
       the camera ABOVE the trooper, and `lookAt` then aimed from up
       there down at his head: measured, a full-limit look-up
       produced 9.2 degrees of actual aim. The player was pushing the
       stick to the top of its travel and the shot went nowhere near
       where they were pointing.

       Pulling the camera IN along its own boom keeps the direction
       and only changes how close the shot is - which is the trade
       every third-person camera makes against a wall, and it is the
       one that preserves aim. */
    /* 0.45m of clearance, not 0.9. Under the old lifting camera the
       number was nearly free; against a boom that shortens it is the
       whole budget, because the height it has to play with is the
       1.62m eye and nothing else. At 0.9 the boom had 0.72m to spend
       and collapsed to a third of its length by 17 degrees of
       look-up - so every ordinary upward glance snapped to first
       person. At 0.45 it has 1.17m, and 26 degrees still leaves most
       of the boom. Pulling in cannot push the camera through a dune
       the way lifting could, so the smaller margin is also safer
       than it was. */
    const STEPS = 12;
    let reach = 1;
    for (let i = 1; i <= STEPS; i += 1) {
      const t = i / STEPS;
      const px = lerp(tmp.x, want.x, t);
      const py = lerp(tmp.y, want.y, t);
      const pz = lerp(tmp.z, want.z, t);
      if (py < groundY(px, pz) + 0.45) { reach = (i - 1) / STEPS; break; }
    }
    /* --- first-person mode on steep upward look angles ---
       When looking up steeply (e.g. aiming at Gleaners on ridges,
       flying bosses, or aerial threats), the third-person boom pulls
       down and behind the helmet, causing the heavy armor/pauldrons
       to obstruct the view. Seamlessly transition to a clean
       first-person camera directly at eye level. */
    const upAngle = -state.camPitch;
    const fpTarget = clamp01((upAngle - 0.35) / 0.22);
    state.firstPerson = damp(state.firstPerson || 0, fpTarget, 16, dt);
    const fpWeight = state.firstPerson;

    if (reach < 1) want.lerpVectors(tmp, want, Math.max(0.16, reach));
    if (fpWeight > 0.001) want.lerp(tmp, fpWeight);

    /* The chase spring runs on its own anchor, and the camera is a
       COPY of it. The recoil shake below moves camera.position, and
       `lookAt` aims from wherever the camera stands at a target fixed
       over the trooper's head - so a shaken position becomes a
       different look direction on the very next frame. Lerping the
       camera from its own shaken position fed 0.27 degrees of drift
       per burst straight back into the aim. */
    if (!camAnchorReady) {
      camAnchor.copy(want);
      camAnchorReady = true;
    } else {
      camAnchor.lerp(want, 1 - Math.exp(-14 * dt));
    }
    camera.position.copy(camAnchor);

    const viewDirX = Math.sin(state.camYaw) * Math.cos(state.camPitch);
    const viewDirY = -Math.sin(state.camPitch);
    const viewDirZ = Math.cos(state.camYaw) * Math.cos(state.camPitch);

    const tpTargetX = tmp.x;
    const tpTargetY = tmp.y + 0.35;
    const tpTargetZ = tmp.z;

    const fpTargetX = tmp.x + viewDirX * 100;
    const fpTargetY = tmp.y + viewDirY * 100;
    const fpTargetZ = tmp.z + viewDirZ * 100;

    const lookTargetX = lerp(tpTargetX, fpTargetX, fpWeight);
    const lookTargetY = lerp(tpTargetY, fpTargetY, fpWeight);
    const lookTargetZ = lerp(tpTargetZ, fpTargetZ, fpWeight);

    camera.lookAt(lookTargetX, lookTargetY, lookTargetZ);
    /* Terrain clearance and chase smoothing can change the optical ray
       substantially from the requested camYaw/camPitch.  Feed the
       actual reticle direction back into next frame's shoulder follow;
       the one-frame lag is settled by the same damped camera motion and
       avoids solving the weapon against a direction the player is not
       truly seeing. */
    camera.getWorldDirection(viewForward);
    state.aimViewYaw = Math.atan2(viewForward.x, viewForward.z);
    state.aimViewPitch = Math.asin(clamp(viewForward.y, -1, 1));

    /* RECOIL SHAKE - the near end of the shot.

       Everything else a discharge produces happens where the bullet
       goes. Without something on the camera the weapon reads as a
       remote trigger for distant events, which is what "the gun feels
       weak" was describing.

       Deliberately confined to the three degrees of freedom that DO
       NOT turn the camera: a jog of the eye position, a roll about
       the view axis, and a nudge on the field of view. Shots leave
       along the camera ray and `aimViewYaw`/`aimViewPitch` above feed
       the shoulder follow, so a shake that pitched or yawed the
       camera would walk the player's own aim off target and wind the
       torso solve with it. Rolling about local Z leaves the forward
       vector untouched by construction, and both reads are already
       taken, so this cannot leak into either.

       Placed after the reads for the same reason - order is the
       guarantee, not a convention. */
    state.punch = damp(state.punch, 0, 9.5, dt);
    if (state.punch > 0.0015) {
      state.punchPhase = (state.punchPhase + dt * 47) % TAU;
      const a = state.punch;
      const s = Math.sin(state.punchPhase);
      const c = Math.cos(state.punchPhase * 0.71);
      camShakeAxis.set(1, 0, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(camShakeAxis, s * a * 0.052);
      camShakeAxis.set(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(camShakeAxis, c * a * 0.040);
      camera.rotateZ(s * a * 0.021);
    }

    /* The rite shove. Same construction rule as the recoil above: it
       may translate the camera and roll it about its own Z, and it may
       not touch yaw or pitch, because those two are read by the aim
       solve and the torso follow. */
    state.heave = damp(state.heave, 0, state.heaveDecay, dt);
    if (state.heave > 0.0015) {
      state.heavePhase = (state.heavePhase + dt * state.heaveFreq) % TAU;
      const a = state.heave;
      const s = Math.sin(state.heavePhase);
      const c = Math.cos(state.heavePhase * 0.63);
      camShakeAxis.set(1, 0, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(camShakeAxis, s * a * 0.075);
      camShakeAxis.set(0, 1, 0).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(camShakeAxis, c * a * 0.096);
      camera.rotateZ(c * a * 0.030);
    }

    /* The zoom rides the EASED sight value, so it is the same curve
       the weapon comes up on. Recoil is added after the zoom rather
       than before it, because a punch is an absolute kick in degrees
       - scaling it by the zoom would make a shot fired down the
       sights shove the view less than the same shot from the hip. */
    const targetFov = lerp(lerp(62, 69, jetPose), ADS_FOV, state.sighted)
      + state.punch * 1.6
      // A rite breathes the lens out. Small, but it is the difference
      // between the world reacting and a decal being drawn on it.
      + state.heave * 2.4
      + clamp01(ctx.boost?.state?.pose || 0) * 4.5;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }

    state.bob += dt * state.speed;
  }

  /** Where a foot wants to stand, in world space, for a given
   *  fore/aft offset along the facing direction. */
  const LEAD_SIDE = 1;
  /* Hip-width, not knock-kneed.  The imported hips sit around
     +/-0.116m; the old +/-0.058m targets crossed both knees and
     pointed the sabatons inward beneath the tabard. It is also the
     centreline guard below: a foot is never allowed nearer the
     midline than this, whatever the turn is doing. */
  const HIP_HALF = locomotionValue("hipHalf", 0.115);
  /* The line a PLANTED foot may not cross. Deliberately inboard of
     HIP_HALF: a planted foot is not allowed to move without a
     reason, so the guard has to be somewhere a correct plant never
     reaches. Ankles this close are already touching. */
  const STANCE_GUARD = locomotionValue("stanceGuard", Math.max(0.055, HIP_HALF - 0.030));
  /* HOW WIDE THE WALKING TRACK IS, which is not the same question as
     how wide the STANDING stance is.

     A figure at rest owns its ground with the sabatons apart, and a
     broad rig should. A figure WALKING puts each boot down nearer the
     line it is travelling along, because the mass has to pass over
     the planted foot and a wide plant makes the body roll sideways to
     do it. Holding one width for both is exactly what makes a broad
     figure waddle: the Bastion planted its ankles 46cm apart at every
     speed, which is wider than its own hip bones.

     `hipHalfMoving` defaults to `hipHalf`, so a figure that does not
     author it keeps precisely the gait it had. */
  const HIP_HALF_MOVING = locomotionValue("hipHalfMoving", HIP_HALF);
  /* Rewritten by `readGaitSpec` every frame; this is the standing
     value a spawn's first foot placement uses. */
  let trackHalf = HIP_HALF;
  /* THE PLANTED-FOOT GUARD IS A CONSTANT, and it has to be, even
     though the track it guards is not.

     A planted foot is only ever MOVED when it is inboard of this
     line, so a guard that follows the live track breaks the whole
     no-slip claim from the other end: brake out of a walk and the
     track widens back toward the standing stance, the guard widens
     with it, and every foot planted at the narrow width is suddenly
     "crossing" and gets pivoted outward - a foot moving under a body
     that is trying to stop, which is precisely the artefact the
     guard exists to prevent. Sized off the NARROWEST width the gait
     can plant at, so it sits inboard of every legal plant at every
     speed and a foot that never drifts never moves at all. */
  const TRACK_GUARD = Math.min(
    STANCE_GUARD,
    Math.max(0.045, Math.min(HIP_HALF, HIP_HALF_MOVING) - 0.030)
  );

  /**
   * Where a foot wants to stand for a body standing at
   * (`bx`, `bz`) facing `byaw` - the general form. `footRest` is
   * this evaluated at the body's CURRENT transform; the swing
   * targets below evaluate it at a PREDICTED one.
   *
   * Splitting the two is the whole repair. The old single function
   * could only ever answer in the frame the body occupied at the
   * instant it was asked, so a landing point computed at toe-off was
   * a straight-line extrapolation of a heading the body had already
   * left. Through a turn that put the foot up to a metre wide of the
   * path it was actually going to take.
   */
  function footPlaceAt(leg, bx, bz, byaw, fore, out) {
    const sin = Math.sin(byaw);
    const cos = Math.cos(byaw);
    const lead = leg.side === LEAD_SIDE ? 1 : -1;
    const spread = Number.isFinite(actionPose.stanceSpread) ? actionPose.stanceSpread : 0;
    const push = Number.isFinite(actionPose.stanceZ) ? actionPose.stanceZ : 0;
    const REACH_XZ = 0.30;
    const lateral = leg.side * (trackHalf + clamp(spread, -0.16, 0.16));
    fore += lead * clamp(push, -REACH_XZ, REACH_XZ);
    // Track the hips forward under the body lean - see leanFootShift.
    fore += leanFootShift;
    const x = bx + sin * fore + cos * lateral;
    const z = bz + cos * fore - sin * lateral;
    const gy = groundY(x, z);
    return out.set(x, (Number.isFinite(gy) ? gy : state.y) + figure.limb.ankle, z);
  }

  /**
   * The body's transform when the swinging foot is due to land,
   * assuming it holds its current speed and turn rate: a
   * constant-curvature arc, which is what a damped heading actually
   * traces and what a straight-line guess gets wrong.
   *
   * Writes into `predictBody` as {x, z, yaw}. `tau` is seconds ahead.
   */
  const predictBody = { x: 0, z: 0, yaw: 0 };
  function aimDetachedTravel() {
    return (action.name && action.name.startsWith("melee")
      && Number.isFinite(action.aimYaw)) || state.aimCommit > 0.002;
  }

  function predictBodyAt(tau) {
    /* Cap the look-ahead. A stalled or very slow gait can ask for
       most of a second, and a second of a hard turn is 90 degrees -
       far past where a constant-rate assumption is honest. */
    const t = clamp(tau, 0, 0.42);
    const w = clamp(state.yawRate, -3.2, 3.2);
    if (aimDetachedTravel()) {
      /* An attack can face independently of WASD. This was originally
         limited to melee, but ranged aim commitment has the same split:
         the body turns toward the reticle while A/D/S remain camera-
         relative. Predict pelvis translation along the motion actually
         resolved this frame, while still predicting the body's committed
         turn for stance orientation. Otherwise a firing backpedal slides
         backward while both boots reach toward aimed-body forward. */
      const v = state.travelSpeed;
      predictBody.x = state.x + Math.sin(state.travelYaw) * v * t;
      predictBody.z = state.z + Math.cos(state.travelYaw) * v * t;
      predictBody.yaw = state.yaw + w * t;
      return predictBody;
    }
    const v = state.speed;
    const sin = Math.sin(state.yaw);
    const cos = Math.cos(state.yaw);
    let fore;
    let lat;
    if (Math.abs(w) < 1e-3) {
      // Straight: the arc degenerates and the closed form divides by
      // zero, so take the limit rather than the formula.
      fore = v * t;
      lat = 0;
    } else {
      const theta = w * t;
      fore = (v * Math.sin(theta)) / w;
      lat = (v * (1 - Math.cos(theta))) / w;
    }
    predictBody.x = state.x + sin * fore + cos * lat;
    predictBody.z = state.z + cos * fore - sin * lat;
    predictBody.yaw = state.yaw + w * t;
    return predictBody;
  }

  /** Where a foot wants to stand, in world space, for a given
   *  fore/aft offset along the facing direction. */
  function footRest(leg, fore, out) {
    /* STANCE. A two-handed glaive stroke is driven from the feet, and
       until now no clip touched them: leg pixels moved 0.4-3.9
       against a torso moving 5-15, so every attack was delivered
       from a parade rest however hard the chest turned. `stanceZ`
       drives the lead foot forward into a lunge and the trailing one
       back; `stanceSpread` widens the base under it. Both are read
       and clamped inside `footPlaceAt`.

       Clamped to what the leg can actually reach: the chain is
       THIGH + SHIN = 0.82m under a hip at 0.90m, so a foot driven
       0.52m forward sits 0.95m from the hip - outside the reachable
       annulus. An unguarded read there also put a NaN into the
       target once, and a NaN survives the solver's clamp (which
       clamps magnitude, not finiteness) and poisons every joint
       downstream for the rest of the session.

       The end effector is the ANKLE, so the result sits an ankle's
       height ABOVE the ground - targeting the sole's height buries
       the whole sabaton. */
    return footPlaceAt(leg, state.x, state.z, state.yaw, fore, out);
  }

  /**
   * Push a foot back onto its own side of the body.
   *
   * The prediction below places a foot correctly for the turn it
   * expects; this catches the turn it did not - a stick reversed
   * mid-swing, or a body that keeps rotating over an already planted
   * foot until the foot is on the wrong side of the midline. Without
   * it the trooper's ankles scissor, which is the single most
   * legible way for a gait to look broken.
   *
   * The correction rotates the foot ABOUT THE PELVIS rather than
   * sliding it inward: it preserves the distance from the hip, so
   * the leg stays as reachable as it was, and it reads as a sabaton
   * pivoting on its ball, which is what a person turning in armour
   * actually does. `blend` is how much of the violation to take out
   * this frame.
   */
  function uncross(leg, point, bx, bz, byaw, blend, guard = trackHalf) {
    const dx = point.x - bx;
    const dz = point.z - bz;
    const sin = Math.sin(byaw);
    const cos = Math.cos(byaw);
    const lat = dx * cos - dz * sin;        // +X is the trooper's right
    const fore = dx * sin + dz * cos;
    const floor = leg.side * guard;
    // Already outboard of the guard on its own side: nothing to do.
    if (leg.side < 0 ? lat <= floor : lat >= floor) return false;
    const radius = Math.hypot(lat, fore);
    if (radius < 1e-4) return false;
    /* Solve for the bearing that puts this foot exactly on the
       guard line at its own radius. If the foot is nearer the body
       than the guard is wide there is no such bearing, so fall back
       to straight out to the side. */
    const s = clamp(floor / radius, -1, 1);
    const want = Math.atan2(s, Math.sqrt(Math.max(0, 1 - s * s)) * Math.sign(fore || 1));
    const have = Math.atan2(lat, fore);
    const turn = angleDelta(have, want) * clamp01(blend);
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const nLat = lat * c + fore * sn;
    const nFore = fore * c - lat * sn;
    point.x = bx + sin * nFore + cos * nLat;
    point.z = bz + cos * nFore - sin * nLat;
    return true;
  }

  function solveJetLegs(dt, pose) {
    const facing = state.yaw + actionPose.pelvisYaw;
    figure.root.updateMatrixWorld(true);
    const rootQuat = figure.root.quaternion;
    for (let i = 0; i < 2; i += 1) {
      const leg = legs[i];
      /* Lift both sabatons behind the pelvis while keeping them
         asymmetric. The slight phase motion gives sustained thrust
         a living balance correction rather than a frozen skydiver. */
      const flutter = Math.sin(state.clock * 5.2 + i * Math.PI) * 0.035 * pose;
      footTmp.set(
        leg.side * lerp(HIP_HALF, 0.19, pose),
        lerp(figure.limb.ankle, 0.43 + flutter, pose),
        lerp(0, -0.29 - i * 0.035, pose)
      ).applyMatrix4(figure.root.matrixWorld);

      if (figure.legBindQuaternions && figure.kneeBindQuaternions) {
        figure.legPivots[i].quaternion.copy(figure.legBindQuaternions[i]);
        figure.kneePivots[i].quaternion.copy(figure.kneeBindQuaternions[i]);
        figure.legPivots[i].updateWorldMatrix(true, true);
      }
      kneePole.set(leg.side * 0.10, -0.08, 1).normalize().applyQuaternion(rootQuat);
      clampReach(i, footTmp);
      const lengths = figure.legLengths ? figure.legLengths[i] : figure.limb;
      solveTwoJoint(
        figure.legPivots[i], figure.kneePivots[i],
        footTmp, kneePole, lengths.thigh, lengths.shin, LEG_AXIS
      );

      /* NOTHING IS HOLDING THIS FOOT UP. The shin trails backwards
         and slightly above the horizontal here, so a sole aimed at
         the horizon - which is what an absolute pitch produces - is
         an ankle folded through more than a right angle. Hand it to
         the shin instead and let it hang. */
      leg.footDev = damp(leg.footDev, lerp(0, FLIGHT_ANKLE_DEV, pose), 12, dt);
      leg.footFollow = pose;
      leg.footRoll = 0;
      orientFoot(i, facing, leg.footDev, pose, 0);
      /* The gait's own record of where this boot is. Left stale
         through a flight it holds the launch position, so a landing
         starts from a target a whole flight path away - and any
         harness reading `leg.foot` measures the ground the trooper
         took off from. */
      leg.foot.copy(footTmp);
      leg.plant.copy(footTmp);
      leg.swinging = false;
      leg.planted = false;
    }
  }

  /** Ground boost lunge: one boot attacks the travel line while the
   *  other braces behind it, and both ride with the translating body.
   *
   * The ordinary gait deliberately leaves a stance foot planted in
   * world space. At 19-27m/s that makes the pelvis travel past its own
   * foot in one or two frames, so the leg stretches behind the player
   * before snapping forward. A boost is propulsion, not a run cycle:
   * rebuild both targets from the boost's authoritative direction on
   * every frame and keep the stride itself frozen until the boost ends. */
  function solveBoostLegs(dt, pose) {
    const boost = ctx.boost?.state;
    let dx = Number(boost?.directionX);
    let dz = Number(boost?.directionZ);
    const directionLength = Math.hypot(dx, dz);
    if (!(directionLength > 1e-5)) {
      const facing = Number.isFinite(state.travelYaw) ? state.travelYaw : state.yaw;
      dx = Math.sin(facing);
      dz = Math.cos(facing);
    } else {
      dx /= directionLength;
      dz /= directionLength;
    }
    const facing = Math.atan2(dx, dz);
    const rightX = dz;
    const rightZ = -dx;
    const slope = (
      groundY(state.x + dx * 0.18, state.z + dz * 0.18)
      - groundY(state.x - dx * 0.18, state.z - dz * 0.18)
    ) / 0.36;
    /* Toes up into an uphill line, down into a downhill one, but
       only as far as an ankle goes - the global clamp in
       `orientFoot` is the backstop, this is the pose. */
    const groundDev = clamp(Math.atan(slope) * 0.68, -0.35, 0.42);
    figure.root.updateMatrixWorld(true);

    for (let i = 0; i < 2; i += 1) {
      const leg = legs[i];
      const lead = leg.side === LEAD_SIDE;
      /* The blend makes ignition and release continuous while the
         targets remain body-relative throughout. The lead sabaton is
         visibly committed downrange; the trail leg is the long brace
         that sells the thrust without ever being left behind. */
      const fore = lead
        ? lerp(0.10, 0.42, pose)
        : lerp(-0.08, -0.34, pose);
      const lateral = leg.side * lerp(HIP_HALF, HIP_HALF + 0.065, pose);
      const x = state.x + dx * fore + rightX * lateral;
      const z = state.z + dz * fore + rightZ * lateral;
      const gy = groundY(x, z);
      leg.foot.set(x, gy + figure.limb.ankle, z);
      leg.plant.copy(leg.foot);
      leg.swinging = false;
      leg.planted = false;
      const tilt = legGroundTilt(i, x, z, facing);
      leg.footDev = damp(leg.footDev, groundDev, 18, dt);
      leg.footFollow = damp(leg.footFollow, 0, 18, dt);
      leg.footRoll = damp(leg.footRoll, tilt.roll, 14, dt);

      if (figure.legBindQuaternions && figure.kneeBindQuaternions) {
        figure.legPivots[i].quaternion.copy(figure.legBindQuaternions[i]);
        figure.kneePivots[i].quaternion.copy(figure.kneeBindQuaternions[i]);
        figure.legPivots[i].updateWorldMatrix(true, true);
      }
      kneePole.set(
        dx + rightX * leg.side * 0.18,
        -0.30,
        dz + rightZ * leg.side * 0.18
      ).normalize();
      clampReach(i, leg.foot);
      leg.plant.copy(leg.foot);
      const lengths = figure.legLengths ? figure.legLengths[i] : figure.limb;
      solveTwoJoint(
        figure.legPivots[i], figure.kneePivots[i],
        leg.foot, kneePole, lengths.thigh, lengths.shin, LEG_AXIS
      );
      orientFoot(i, facing, leg.footDev, leg.footFollow, leg.footRoll);
    }
  }

  /** A grounded skid: wide, asymmetric boots that ride with the body.
   *
   * Ordinary locomotion deliberately plants each foot in world space;
   * doing that here would make a sliding body walk past its own boots.
   * These targets are rebuilt from the resolved travel frame instead,
   * so the sabatons stay braced against the slope while visibly moving
   * downhill with the hips. */
  function solveDownhillLegs(dt, pose) {
    const facing = Number.isFinite(state.travelYaw) ? state.travelYaw : state.yaw;
    const sin = Math.sin(facing);
    const cos = Math.cos(facing);
    figure.root.updateMatrixWorld(true);
    /* Toes DOWN into the fall line: the brace is the ball of the
       boot, not the heel. */
    const slopeDev = clamp(-Math.atan(Math.max(0, state.downhillGrade)) * 0.68, -0.65, 0);

    for (let i = 0; i < 2; i += 1) {
      const leg = legs[i];
      const lead = leg.side === LEAD_SIDE;
      /* One boot searches ahead for purchase, the other trails as a
         brake. Widen both beyond the walking stance so the silhouette
         reads as balance rather than a paused mid-stride. */
      const fore = lead ? 0.25 : -0.19;
      const lateral = leg.side * (HIP_HALF + 0.055);
      const x = state.x + sin * fore + cos * lateral;
      const z = state.z + cos * fore - sin * lateral;
      const gy = groundY(x, z);
      footTmp.set(x, gy + figure.limb.ankle, z);
      const follow = 1 - Math.exp(-lerp(12, 22, pose) * dt);
      leg.foot.lerp(footTmp, follow);
      leg.plant.copy(leg.foot);
      leg.swinging = false;
      leg.planted = false;
      const tilt = legGroundTilt(i, x, z, facing);
      leg.footDev = damp(leg.footDev, slopeDev, 14, dt);
      leg.footFollow = damp(leg.footFollow, 0, 16, dt);
      leg.footRoll = damp(leg.footRoll, tilt.roll, 12, dt);

      if (figure.legBindQuaternions && figure.kneeBindQuaternions) {
        figure.legPivots[i].quaternion.copy(figure.legBindQuaternions[i]);
        figure.kneePivots[i].quaternion.copy(figure.kneeBindQuaternions[i]);
        figure.legPivots[i].updateWorldMatrix(true, true);
      }
      kneePole.set(
        sin + cos * leg.side * 0.13,
        -0.24,
        cos - sin * leg.side * 0.13
      ).normalize();
      clampReach(i, leg.foot);
      leg.plant.copy(leg.foot);
      const lengths = figure.legLengths ? figure.legLengths[i] : figure.limb;
      solveTwoJoint(
        figure.legPivots[i], figure.kneePivots[i],
        leg.foot, kneePole, lengths.thigh, lengths.shin, LEG_AXIS
      );
      orientFoot(i, facing, leg.footDev, leg.footFollow, leg.footRoll);
    }
  }

  function solveLegs(dt) {
    /* Every unsupported body borrows the pack's airborne legs. A vault,
       a ledge fall and the Penitent's Fall must not advance a grounded
       walk cycle merely because the pack itself is dark. */
    const jetPose = airbornePose();
    if (jetPose > 0.001) {
      solveJetLegs(dt, jetPose);
      return;
    }
    const boostPose = clamp01(ctx.boost?.state?.pose || 0);
    if (state.grounded && boostPose > 0.025) {
      solveBoostLegs(dt, boostPose);
      return;
    }
    const downhillPose = clamp01(state.downhillPose);
    if (downhillPose > 0.025) {
      solveDownhillLegs(dt, downhillPose);
      return;
    }
    const moving = state.speed > 0.35;
    const gait = readGaitSpec();
    const cycle = state.gait;

    for (let i = 0; i < 2; i += 1) {
      const leg = legs[i];
      if (!leg.planted) {
        footRest(leg, 0, leg.plant);
        leg.foot.copy(leg.plant);
        leg.planted = true;
      }

      if (!moving) {
        /* THE BRAKE. `leg.plant` is the last TOUCHDOWN, and a leg
           caught mid-swing has not had one for most of a stride - so
           adopting it here teleported the boot backward by up to
           1.29m in a single frame, which is the reported "legs warp
           when you stop". Take the pose the foot is actually in and
           ease that under the hips instead; on a leg that was
           already planted this is a no-op, because plant and foot
           are the same point. */
        if (leg.swinging) {
          leg.plant.copy(leg.foot);
          leg.swinging = false;
          /* A boot caught in the air owes the ground a step, and it
             is the only foot here that does. An already-planted one
             is merely tidying its stance and must keep the slow ease
             or a standing trooper's feet fidget. */
          leg.settling = true;
        }
        // Standing: ease both feet back under the hips rather than
        // leaving them wherever the last step finished.
        footRest(leg, 0, footTmp);
        if (leg.settling && leg.plant.distanceToSquared(footTmp) < 0.0016) {
          leg.settling = false;
        }
        leg.plant.lerp(footTmp, 1 - Math.exp(-(leg.settling ? 17 : 9) * dt));
        leg.foot.copy(leg.plant);
        const tilt = legGroundTilt(i, leg.foot.x, leg.foot.z, state.yaw);
        /* Damped, not assigned. A snap here put the whole of a
           toe-off or heel-strike angle into one frame at exactly the
           moment the rest of the body was settling. */
        leg.footDev = damp(leg.footDev, clamp(tilt.pitch, -0.55, 0.42), 10, dt);
        leg.footFollow = damp(leg.footFollow, 0, 12, dt);
        leg.footRoll = damp(leg.footRoll, tilt.roll, 10, dt);
      } else {
        const u = (cycle + leg.phase) % 1;
        if (u >= gait.stance) {
          const t = (u - gait.stance) / (1 - gait.stance);
          if (!leg.swinging) {
            leg.swinging = true;
            /* Start the swing from the ankle's ACTUAL toe-off pose.
               `leg.plant` is the flat contact point, while late
               stance has already lifted `leg.foot` by up to 11.5cm.
               Copying the flat plant here snapped the ankle down on
               the first swing frame and made the fully trailing leg
               briefly unreachable. */
            leg.from.copy(leg.foot);
            leg.target.copy(leg.foot);
          }
          /* AIM AT WHERE THE BODY IS GOING TO BE, and re-aim every
             frame as that gets less speculative.

             The two obvious schemes are both wrong. Recomputing the
             landing point from the body's CURRENT position each
             frame makes the foot chase a target that runs away from
             it at walking pace: the leg kicks forward forever and
             never passes behind the hips. Freezing the point at
             toe-off fixes that, but freezes a straight-line
             extrapolation of a heading the body abandons the moment
             the player turns - which is what threw a foot up to a
             metre wide of the path and crossed the ankles on a
             reversal.

             Predicting the pelvis at TOUCHDOWN does neither, because
             the horizon shrinks as the swing runs: at lift-off it
             looks a whole swing ahead, at touchdown it looks nowhere
             and resolves to the body's real transform plus one
             landing step. So the target stops running away AND stops
             going stale, and on a straight line it reduces exactly
             to the frozen point it replaces. */
          const swingTravel = gait.strideLen * (1 - gait.stance);
          const remaining = swingTravel * (1 - t);
          const tau = remaining / Math.max(0.6, state.speed);
          const body = predictBodyAt(tau);
          if (aimDetachedTravel()) {
            /* Keep the stance under the aimed pelvis, but lead the
               landing along actual travel. A firing trooper can face
               the reticle while backing up or strafing, so putting
               `landing` on body-forward makes the boot reach against
               its own motion. The body prediction already follows the
               measured path; this last step gives the ankle a real
               backpedal target while the sabaton and knee remain
               oriented with the combat stance. */
            footPlaceAt(leg, body.x, body.z, body.yaw, 0, footTmp);
            footTmp.x += Math.sin(state.travelYaw) * gait.landing;
            footTmp.z += Math.cos(state.travelYaw) * gait.landing;
            const landingGround = groundY(footTmp.x, footTmp.z);
            footTmp.y = (Number.isFinite(landingGround) ? landingGround : state.y)
              + figure.limb.ankle;
          } else {
            footPlaceAt(leg, body.x, body.z, body.yaw, gait.landing, footTmp);
          }
          /* A reversal can still aim across the midline, because the
             predicted heading is a heading the body has not reached
             and the stick may reverse again inside the swing. */
          uncross(leg, footTmp, body.x, body.z, body.yaw, 1);
          /* Ease onto the new aim rather than snapping to it. The
             prediction moves whenever the turn rate does, and an
             un-damped target puts that jitter straight into the
             ankle. Converging harder late in the swing keeps the
             touchdown point honest. */
          leg.target.lerp(footTmp, 1 - Math.exp(-lerp(9, 26, t) * dt));
          const e = t * t * (3 - 2 * t);
          leg.foot.copy(leg.from).lerp(leg.target, e);
          leg.foot.y = lerp(leg.from.y, leg.target.y, e)
            + Math.sin(t * Math.PI) * gait.lift;
          /* Guard the swept path, not only its endpoints. Both ends
             are legal in their own frame and the straight line
             between them still cuts the corner: a foot lifting from
             behind a turn and landing ahead of it passes through the
             midline on the way. It is a foot in the air, so it may
             be moved freely - and the correction is zero at
             touchdown, where the predicted frame has become the real
             one, so this cannot fight the landing point.

             RAMPED IN, not applied whole on the first swing frame.
             A body that slides relative to its own facing - deflected
             along a wall, or turning over a planted foot - leaves the
             stance boot inboard of the guard, and taking all of that
             out at once rotated the foot 0.32m about the pelvis in a
             single frame at exactly the moment it left the ground.
             It is a snap on the flat, with nothing steep or fast
             about it, and it was the largest one left. The ramp is
             finished long before mid-swing, so the guarantee this
             exists for is unchanged. */
          uncross(leg, leg.foot, state.x, state.z, state.yaw,
            smoothstep01(t / 0.16));
          /* THE SWING FOOT HANGS OFF THE SHIN. Held to a world angle
             instead - which is what this did - a knee folded 140
             degrees under the pelvis took every degree of that out
             of the ankle, and the trooper ran with both sabatons
             pulled 114 degrees past what an ankle reaches. It rides
             the shin for the whole swing and hands ownership back to
             the ground over the last fifth, so the sole arrives
             flat. Toe-off hands over the other way: `toeEase` in the
             stance branch is 1 exactly here, so the two meet. */
          leg.footFollow = 1 - smoothstep01((t - 0.78) / 0.22);
          /* The ankle's own trajectory through a stride, which is
             not a settle from one pose to another: pointed off the
             push, pulled up to clear the ground, and dropped back
             toward flat to meet it. */
          const toeUp = smoothstep01(t / 0.32);
          const reach = smoothstep01((t - 0.55) / 0.45);
          /* Weightless for most of the swing - the boot is riding
             the shin, not the hill - so do not go and read the hill. */
          const landTilt = leg.footFollow < 0.985
            ? legGroundTilt(i, leg.target.x, leg.target.z, state.yaw)
            : FLAT_TILT;
          /* Ends on the same value the stance branch opens with, so
             touchdown is a handoff and not a step change. */
          const strike = lerp(0.14, -0.30, clamp01(
            (state.speed - WALK) / Math.max(0.1, SPRINT - WALK)
          ));
          leg.footDev = lerp(-0.34, 0.22, toeUp) + (strike - 0.22) * reach
            + clamp(landTilt.pitch, -0.55, 0.42) * (1 - leg.footFollow);
          leg.footRoll = damp(leg.footRoll, landTilt.roll * (1 - leg.footFollow), 12, dt);
        } else {
          if (leg.swinging) {
            leg.swinging = false;
            leg.plant.copy(leg.target);
            /* Touchdown, and the only frame that is one. Driving the
               print off accumulated stride instead - the way the
               footstep audio does - puts it under the PELVIS, half a
               stride from either boot, and on a turn it walks a line
               the trooper never took. */
            ctx.vfx?.footprint?.(leg.plant.x, leg.plant.z, state.travelYaw,
              leg.side, clamp01(state.speed / SPRINT));
          }
          /* PLANTED: the body moves over it, and on a straight line
             it is not touched at all - which is the claim
             `footSlipCheck` exists to hold, and this must not break.

             A turn is the one case where holding it perfectly still
             is wrong. The body keeps rotating over a fixed foot, and
             after enough rotation that foot is behind the other
             ankle or across the midline: the trooper walks into its
             own scissors. A real one does not resist this, it pivots
             on the ball of the sabaton. So the guard is allowed to
             turn a planted foot about the pelvis, and ONLY by as
             much as the crossing violation demands - which is
             identically zero whenever the body is not turning, so
             the straight-line slip stays at zero too. */
          /* Pivot as fast as the body is turning. A fixed rate is
             either too slow to keep up with a stick reversal or fast
             enough to look like the foot is being dragged on a
             gentle arc; tying it to the turn means the sabaton
             scuffs round exactly as hard as the turn requires. */
          const pivotRate = 6 + 9 * Math.abs(state.yawRate);
          /* Guarded INSIDE the placement line, not on it. A foot is
             put down at exactly `trackHalf`, so a guard at the same
             width sits on top of every fresh plant and the trig that
             recovers the lateral offset does not return the placement
             value to the last bit - which had a correctly planted
             foot creeping outward a tenth of a millimetre per frame
             forever, on a straight line, for no reason. `TRACK_GUARD`
             is inboard of the narrowest width this gait ever plants
             at, so a plant that never drifts never moves at all. */
          if (uncross(leg, leg.plant, state.x, state.z, state.yaw,
            1 - Math.exp(-pivotRate * dt), TRACK_GUARD)) {
            // A pivoted foot has moved across the ground, so it has
            // to re-read its height or it hangs off the last one.
            const pg = groundY(leg.plant.x, leg.plant.z);
            if (Number.isFinite(pg)) leg.plant.y = pg + figure.limb.ankle;
          }
          leg.foot.copy(leg.plant);
          const stanceT = u / Math.max(0.001, gait.stance);
          const heelSettle = clamp01(stanceT / 0.18);
          const toeOff = clamp01((stanceT - 0.72) / 0.28);
          const toeEase = toeOff * toeOff * (3 - 2 * toeOff);
          leg.foot.y += toeEase * lerp(0.065, 0.115, clamp01(state.speed / SPRINT));
          /* Heel strike, roll through, drive off the ball - and lie
             along the hill while doing it. Without the terrain term
             a boot planted on a 30-degree slope is held flat and
             cuts straight through it, which no amount of correct leg
             IK above hides. */
          const tilt = toeEase < 0.985
            ? legGroundTilt(i, leg.plant.x, leg.plant.z, state.yaw)
            : FLAT_TILT;
          /* Planted: the GROUND owns this sole - until the heel comes
             off it. `toeEase` is the heel lift, so it is also exactly
             how much of the boot the ankle has taken back, and it
             reaches 1 at toe-off where the swing collects it. */
          leg.footFollow = toeEase;
          /* HOW THE FOOT MEETS THE GROUND depends on how fast it is
             arriving. A march lands heel first; a sprint lands on
             the ball of the boot, which is not a stylisation - it is
             what the leg does at speed, and asking for a flat sole
             at 8.6m/s wrote a request the ankle then had to be
             clamped out of. */
          const strike = lerp(0.14, -0.30, clamp01(
            (state.speed - WALK) / Math.max(0.1, SPRINT - WALK)
          ));
          leg.footDev = lerp(strike, 0, heelSettle) - toeEase * 0.34
            + clamp(tilt.pitch, -0.55, 0.42) * (1 - toeEase);
          leg.footRoll = damp(leg.footRoll, tilt.roll * (1 - toeEase), 14, dt);
        }
      }

      /* Reset the two aimed bones to bind before solving.  Aim IK is
         underconstrained around the segment axis; feeding last
         frame's twist back into the next let the feet accumulate a
         full 180-degree reversal over several cycles. */
      if (figure.legBindQuaternions && figure.kneeBindQuaternions) {
        figure.legPivots[i].quaternion.copy(figure.legBindQuaternions[i]);
        figure.kneePivots[i].quaternion.copy(figure.kneeBindQuaternions[i]);
        figure.legPivots[i].updateWorldMatrix(true, true);
      }

      // Knees bend forward with a small outward bias, over their toes.
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      kneePole.set(
        sin + cos * leg.side * 0.10,
        -0.15,
        cos - sin * leg.side * 0.10
      ).normalize();
      /* Inside the leg's own reach BEFORE the solver clamps it
         silently. On a hillside the trailing ankle asks for ground
         more than a leg-length below the hip, and a clamped solve
         leaves the sabaton floating off a straight leg. */
      /* The CONTACT RECORD is deliberately not touched. `leg.plant`
         is where this boot came down and what the slip check holds
         still; `leg.foot` is where the ankle is drawn, toe lift and
         reach clamp included. Copying one into the other would let
         a clamped stance creep the plant uphill a little every
         frame. */
      clampReach(i, leg.foot);
      const lengths = figure.legLengths ? figure.legLengths[i] : figure.limb;
      solveTwoJoint(
        figure.legPivots[i], figure.kneePivots[i],
        leg.foot, kneePole, lengths.thigh, lengths.shin, LEG_AXIS
      );
      orientFoot(
        i, state.yaw + actionPose.pelvisYaw,
        leg.footDev, leg.footFollow, leg.footRoll
      );
    }
  }

  /**
   * Solve the arms onto the weapon's grips.
   *
   * Called AFTER weapons.update(), deliberately. The weapon moves
   * every frame for bob, sway, recoil and the aim transition; hands
   * placed before that lag it by exactly one frame, which reads as
   * the weapon vibrating inside the grip.
   */
  /* Measured off the skinned hand, not guessed: the vertices weighted
     to LeftHand/RightHand span 0.21m along the bone's local +Y, and
     the posed SKIN centroid the review harness measures sits 0.117m
     up that axis - not the 0.106m the raw vertex centroid gives, and
     it is the skin figure that has to land on the haft. The palm face
     is then ~0.055m off, which is half a gauntlet plus the haft's own
     radius. */
  const PALM_ALONG_FINGERS = 0.117;
  const PALM_HALF_THICKNESS = 0.055;
  /* WHICH LOCAL AXIS THE PALM FACES.
     The meshes are mirrored in X only, so there is one answer for
     both hands - an earlier `[1, -1]` guessed that the mirroring must
     flip the palm too, and had the trigger hand gripping the haft
     with the back of its hand. +1 means the palm looks along local
     +Z. */
  const HAND_PALM_LOCAL_Z = 1;
  /* Relaxed-hand correction around the finger/forearm axis. This is
     figure-authored because a skinned mesh's visible palm plane does
     not necessarily line up exactly with its hand bone. Weapon grips
     use their separate PALM_ROLL path below and are unaffected. */
  let FREE_HAND_PALM_TURN = Number.isFinite(figure.freeHandPalmTurn)
    ? figure.freeHandPalmTurn
    : 0;

  const restHand = new THREE.Vector3();
  const restElbowPole = new THREE.Vector3();
  const wristTarget = new THREE.Vector3();
  const shoulderTarget = new THREE.Vector3();
  const handDirection = new THREE.Vector3();
  const aimPoleRightLocal = new THREE.Vector3();

  /* The RESIDUAL wrist cock left between the forearm and the fingers.

     The fingers follow the forearm continuation now, not the shaft -
     the along-the-shaft hold welded the hand to the weapon and let
     the wrist fold to whatever the forearm arrived at, which with the
     hip carry meant both wrists snapped a right angle. These are how
     far short of dead-straight each hand settles, per hand because
     the two holds were art-directed separately:

       support (left): straight off the forearm, palm up, thumb
       forward - so nearly zero residual.
       trigger (right): palm onto the outside of the haft, thumb
       forward - a side grip carries a touch more natural cock.

     The caps are small, so the tilt is nearly the full bend, and
     re-seating the palm moves the wrist target well up the forearm -
     the hand finally spans wrist-to-grip the way a hand does. The
     elbows fold further and the reach numbers drop as a consequence;
     the pose windows in qa.js are retargeted to the measured hold,
     and the kink-direction gates remain the anatomy police. */
  const WRIST_BEND_MAX = [0.09, 0.17];

  /* Roll of each palm about its own finger axis, in radians.
     [support (left), trigger (right)]. Positive is the direction
     that turns both palms further ONTO the haft; see the note at the
     application site for why no gate constrains this and it has to
     be set by looking. Mutable so `qa.setPalmRoll` can sweep it in a
     live session rather than by rebuild-and-squint.

     0.24 rad is about 14 degrees, chosen off a sweep of -0.40 to
     +0.30 shot from behind (the player's own bearing) and from
     outboard. At 0 both gauntlets present their broad flat face
     square to the camera with the haft passing behind them - beside
     the shaft rather than around it. By 0.24 the palm side has
     turned onto the haft and the gauntlet's long axis lines up with
     it. Past 0.40 the seat breaks and palm contact error jumps from
     0.055m to 0.63m, so the usable window is not wide. */
  const PALM_ROLL = [0.24, 0.24];
  const wristForearm = new THREE.Vector3();
  const wristTiltAxis = new THREE.Vector3();
  const wristTiltedY = new THREE.Vector3();
  const wristBendElbowW = new THREE.Vector3();
  const wristBendHandW = new THREE.Vector3();
  const poleAxis = new THREE.Vector3();
  const poleCross = new THREE.Vector3();

  /* WHERE EACH ELBOW SITS, as a direction in the trooper's own frame.
     Figure -X is the trooper's RIGHT, +Y up, +Z forward.

     Mutable so `qa.setElbowPole` can sweep them: these were tuned by
     measuring the pose they produce rather than by argument, and the
     next person to change them should do the same rather than nudge
     numbers and look at a screenshot. */
  const CARRY_ELBOW_POLE = [
    new THREE.Vector3(0.438, -0.146, 0.887),
    /* Down, outboard and BEHIND - the bend kinks backward.

       Three rounds of tuning this pole against the old carry all
       failed the same way, and the post-mortem is worth keeping: the
       rear grip sat at rib height 19cm BEHIND the shoulder, and on
       that shoulder-wrist line the elbow's circle contained no
       down-and-back point at all. Every reachable elbow either flared
       at shoulder height or kinked FORWARD of the arm - which is the
       "bending the wrong way" read - so the pole was picking among
       wrong answers. The carry itself had to move: REST_PITCH now
       cants the shaft muzzle-up so the rear grip drops to the hip,
       and gripRear moved forward along the haft so the hand rides
       BESIDE the hip rather than behind it (weapons.js).

       On that geometry this pole measures: elbow 19cm below the
       shoulder, 24cm outboard, 11cm behind it, with the bend's
       perpendicular offset pointing 5cm BACKWARD - the direction a
       right elbow actually folds. Chosen from a measured sweep of
       both pole arcs (saintfall-arm-anatomy.mjs --sweep); re-run that
       before touching this number.

       Of the arc's near-identical candidates this is the most
       HORIZONTAL: the arm now hangs close to vertical, so a
       down-dominant pole runs along it and pays for the same elbow
       in conditioning (0.48 surviving at the worst bearing, against
       0.68 for this one). When several poles buy the same pose, take
       the one most perpendicular to the limb. */
    new THREE.Vector3(-0.85, -0.35, -0.30),
  ];

  /**
   * Flatten a pole into the plane the elbow actually turns in.
   *
   * Only the part of a pole perpendicular to the shoulder-wrist line
   * decides anything; the part along it cancels in the solver. So
   * this changes NO settled pose - it restates the same choice in the
   * plane where it lives.
   *
   * What it does change is what happens between two poles. Returns
   * false if there is nothing left to normalise, meaning the pole was
   * parallel to the arm and never carried a choice at all.
   */
  function flattenPole(pole, axis) {
    pole.addScaledVector(axis, -pole.dot(axis));
    if (pole.lengthSq() < 1e-8) return false;
    pole.normalize();
    return true;
  }

  /**
   * Blend one flattened pole toward another BY ROTATION, about the
   * arm itself.
   *
   * Straight-line interpolation between two poles is what put the
   * elbow back on its own: the carry pole is near horizontal and the
   * rest pole points down and back, so half way between them the pole
   * aims down the hanging arm - the exact degeneracy the calibrated
   * poles were chosen to avoid, manufactured in the middle of the
   * sheathe by the blend. Trigger conditioning measured 0.149 there,
   * with both ENDS of the blend sound, which is why sweeping settled
   * bearings found nothing.
   *
   * Turning about the arm keeps every intermediate pole in the plane
   * perpendicular to it, because that plane is closed under rotation
   * about its own normal. There is no middle to get wrong.
   */
  function turnPoleToward(pole, target, axis, t) {
    const dot = clamp(pole.dot(target), -1, 1);
    let angle = Math.acos(dot);
    if (angle < 1e-5) { pole.copy(target); return; }
    poleCross.crossVectors(pole, target);
    if (poleCross.dot(axis) < 0) angle = -angle;
    pole.applyAxisAngle(axis, angle * t).normalize();
  }
  /**
   * Carry the arm-solve frame with the WEAPON, not with the reticle.
   *
   * This rotates the two things the arm solve is built from: the
   * trigger hand's approach direction, and the elbow poles. Both have
   * to end up in the frame the lance is actually in, because that is
   * where the wrist targets are.
   *
   * `carryAimYaw` already carries `aimCommit`, but `carryAimPitch`
   * did not - it tracked the camera whatever the trooper was doing.
   * At low ready that is a real disagreement rather than a rounding
   * one: the lance eases back to the body's own facing and ignores
   * the reticle, while the pole kept swinging with it. The pole then
   * leans toward the arm it is supposed to be square to, and the
   * elbow starts choosing its own side again - trigger conditioning
   * measured 0.369 at low ready against 0.765 committed, and low
   * ready is where the inversion was reported from.
   *
   * The chest keeps the ungated pitch; that lean is deliberate and is
   * not what the arms solve against.
   */
  function rotateCarryVector(vector) {
    const yaw = state.carryAimYaw || 0;
    const pitch = (state.carryAimPitch || 0) * clamp01(state.aimCommit ?? 1);
    if (yaw) vector.applyAxisAngle(worldUp, yaw);
    if (pitch) {
      aimPoleRightLocal.set(Math.cos(yaw), 0, -Math.sin(yaw));
      vector.applyAxisAngle(aimPoleRightLocal, pitch);
    }
    return vector.applyQuaternion(figure.root.quaternion);
  }
  /**
   * Where a free hand hangs, with the walk in it.
   *
   * The empty-handed pose used to be one fixed point per arm, so a
   * trooper with the lance on his back ran the whole way to the next
   * objective with both arms bolted to his hips. Arms swinging is
   * most of what makes a walk read as a walk - it is the only part of
   * the body that shows the cadence from the front.
   *
   * Driven by `state.gait`, the same distance-integrated cycle the
   * legs use, so the swing cannot drift out of step with the feet at
   * any speed or on any slope. Opposed diagonally: `legs[0]` is the
   * trooper's anatomical RIGHT leg (the controller indexes limbs by
   * spatial side) while `armPivots[0]` is the LEFT arm, so index 0
   * against index 0 is already the correct cross-body pairing and
   * needs no phase offset.
   */
  const restSwing = { fore: 0, lift: 0 };
  const loadoutArm = new THREE.Vector3();
  function restArmTarget(i, out) {
    const side = i === 0 ? 1 : -1;
    const jetPose = airbornePose();
    const walkN = clamp01(state.speed / WALK);
    const sprintN = clamp01((state.speed - WALK) / Math.max(0.1, SPRINT - WALK));
    // Standing still is a hang, not a swing: amplitude starts at zero.
    const amp = freeArmValue("walkSwing", 0.180) * walkN
      + freeArmValue("sprintSwing", 0.080) * sprintN;
    const phase = i === 0 ? 0 : Math.PI;
    const sw = Math.sin(state.gait * TAU + phase);
    restSwing.fore = sw * amp;
    /* A swinging arm does not stay straight. It lifts a little away
       from the hip on the forward stroke and tucks back on the
       return, and the hand rises as it comes forward - without that
       the arm reads as a pendulum bolted to a shoulder. */
    /* A CARRIED WEAPON DAMPS THE STROKE IT RIDES ON, and by how much
       depends on what it is. A hammer wants its swing; a braced tower
       shield is held still in front of the body and does not travel
       47cm across it twice a stride. Optional-chained, so a level
       without a loadout - which is every level but Kenosis - keeps
       exactly the arms it had. */
    const carried = ctx.loadout?.armSwing?.(i);
    if (Number.isFinite(carried)) restSwing.fore *= carried;
    restSwing.lift = Math.abs(sw) * amp * freeArmValue("swingLift", 0.38);
    const restX = side * (freeArmValue("idleX", 0.205)
      + freeArmValue("walkX", 0.015) * walkN
      + freeArmValue("sprintX", 0.008) * sprintN);
    /* AND AN ARM SWINGING FORWARD FOLDS.
       `swingLift` above is symmetric - it raises the hand at both
       ends of the stroke - so on its own the elbow holds one angle
       and the whole arm hinges at the shoulder. That is a pendulum,
       and it is what "the arms are too stiff" looks like from the
       side however wide the swing is.

       The elbow is not authored anywhere: it falls out of how far
       this target sits from the shoulder against the arm's own
       length, so the only way to make it work through the cycle is to
       move the hand nearer the shoulder on the way forward and let it
       hang back out on the return. Signed by the stroke, so it is one
       smooth sinusoid with no crease at the crossing, and zero by
       default - a figure that does not ask for it swings exactly as
       it did. */
    const restY = freeArmValue("idleY", 0.84)
      + freeArmValue("walkY", -0.01) * walkN
      + freeArmValue("sprintY", 0.11) * sprintN
      + restSwing.lift * freeArmValue("liftY", 0.50)
      + restSwing.fore * freeArmValue("swingFoldY", 0);
    const restZ = freeArmValue("idleZ", 0.060) + restSwing.fore;
    /* WHERE A CARRIED HAND WANTS TO BE.
       The free-hand pose is a hand with nothing in it. A shield arm
       is braced - bent, and forward of the hip - and no amount of
       damping the swing will put it there. Additive, in figure-root
       space, before the flight blend. */
    if (ctx.loadout?.armPose) {
      loadoutArm.set(restX, restY, restZ);
      ctx.loadout.armPose(i, loadoutArm, { side, walkN, sprintN, jetPose });
      return out.set(
        lerp(loadoutArm.x, side * freeArmValue("flightX", 0.205), jetPose),
        lerp(loadoutArm.y, freeArmValue("flightY", 0.985), jetPose),
        lerp(loadoutArm.z, freeArmValue("flightZ", -0.17), jetPose)
      ).applyMatrix4(figure.root.matrixWorld);
    }
    return out.set(
      lerp(restX, side * freeArmValue("flightX", 0.205), jetPose),
      /* Long, relaxed walking arms; a sprint raises the hands and
         closes the elbows into the compact armoured-running shape. */
      lerp(restY, freeArmValue("flightY", 0.985), jetPose),
      lerp(restZ, freeArmValue("flightZ", -0.17), jetPose)
    ).applyMatrix4(figure.root.matrixWorld);
  }

  function restArmPole(i, out) {
    const side = i === 0 ? 1 : -1;
    const jetPose = airbornePose();
    const sprintN = clamp01((state.speed - WALK) / Math.max(0.1, SPRINT - WALK));
    return out.set(
      lerp(
        side * (freeArmValue("poleX", 0.22)
          + freeArmValue("poleSprintX", 0.06) * sprintN),
        side * freeArmValue("flightPoleX", 0.25),
        jetPose
      ),
      lerp(
        freeArmValue("poleY", -0.60),
        freeArmValue("flightPoleY", -0.52),
        jetPose
      ),
      lerp(
        freeArmValue("poleZ", -0.78) - restSwing.fore * 0.35,
        freeArmValue("flightPoleZ", -0.92),
        jetPose
      )
    ).normalize().applyQuaternion(figure.root.quaternion);
  }

  /* The local rotation a FREE hand should hold: fingers following the
     forearm down, back of the hand outboard. Its own scratch, because
     the grip path calls it while still holding the grip frame in the
     shared one. */
  const freeHandX = new THREE.Vector3();
  const freeHandY = new THREE.Vector3();
  const freeHandZ = new THREE.Vector3();
  const freeHandBasis = new THREE.Matrix4();
  const freeHandWorld = new THREE.Quaternion();
  const freeHandParent = new THREE.Quaternion();
  function restHandLocalQuaternion(i, out) {
    const hand = figure.handPivots[i];
    figure.elbowPivots[i].getWorldPosition(restElbow);
    hand.getWorldPosition(restWrist);
    freeHandY.copy(restWrist).sub(restElbow);
    if (freeHandY.lengthSq() < 1e-8) freeHandY.set(0, -1, 0);
    freeHandY.normalize();
    /* Palm INWARD, toward the leg. `freeHandZ` is the palm axis, so
       it points at the body rather than away from it - outward put
       the backs of the hands against the thighs. */
    const side = i === 0 ? 1 : -1;
    freeHandZ.set(-side * HAND_PALM_LOCAL_Z, 0, 0)
      .applyQuaternion(figure.root.quaternion);
    freeHandZ.addScaledVector(freeHandY, -freeHandZ.dot(freeHandY));
    if (freeHandZ.lengthSq() < 1e-8) freeHandZ.set(0, 0, 1);
    freeHandZ.normalize();
    /* Both wrists need the same anatomical turn but opposite signed
       bone rotations. The side factor removes the forward component
       from each authored palm and turns it toward the body. */
    if (Math.abs(FREE_HAND_PALM_TURN) > 1e-6) {
      freeHandZ.applyAxisAngle(freeHandY, side * FREE_HAND_PALM_TURN);
    }
    /* AND A HAND HOLDING SOMETHING FACES IT.
       These gauntlets have no finger bones - the rig carries a single
       `Hand` - so a fist cannot close on a haft. What CAN be done is
       roll the wrist until the palm is presented to the thing it is
       carrying, which is most of what reads as a grip: a shield's
       enarme and a maul's haft do not want the same wrist, so this is
       per hand. Radians about the forearm, optional-chained. */
    const carriedTurn = ctx.loadout?.handTurn?.(i);
    if (Number.isFinite(carriedTurn) && Math.abs(carriedTurn) > 1e-6) {
      freeHandZ.applyAxisAngle(freeHandY, carriedTurn);
    }
    /* AND A HAND THAT AIMS NEEDS MORE THAN A ROLL.
       `handTurn` only spins the palm about the forearm, which is
       enough to present a palm to a haft and not enough to point
       anything: a weapon welded into the fist can only be aimed by
       moving the WRIST. So a loadout may rewrite the whole basis -
       both vectors, in world space - and the pair is re-squared
       afterwards because whatever it hands back is a wish, not
       necessarily an orthonormal one. */
    if (ctx.loadout?.handBasis) {
      ctx.loadout.handBasis(i, freeHandY, freeHandZ);
      if (freeHandY.lengthSq() < 1e-8) freeHandY.set(0, -1, 0);
      freeHandY.normalize();
      freeHandZ.addScaledVector(freeHandY, -freeHandZ.dot(freeHandY));
      if (freeHandZ.lengthSq() < 1e-8) freeHandZ.set(0, 0, 1);
      freeHandZ.normalize();
    }
    freeHandX.crossVectors(freeHandY, freeHandZ).normalize();
    freeHandBasis.makeBasis(freeHandX, freeHandY, freeHandZ);
    freeHandWorld.setFromRotationMatrix(freeHandBasis);
    hand.parent.getWorldQuaternion(freeHandParent).invert();
    return out.copy(freeHandParent).multiply(freeHandWorld);
  }

  function handTurnStep(dt) {
    const frameDt = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
    return 18 * clamp(frameDt, 1 / 240, 1 / 30);
  }

  function solveRestArm(i, dt) {
    restArmTarget(i, restHand);
    /* The elbow trails the hand. Poling it straight back on both
       strokes locks the arm; letting the pole follow the swing keeps
       a soft bend that opens forward and closes on the backswing. */
    restArmPole(i, elbowPole);
    // Flattened for the same reason as the carry path: the swing
    // moves this pole every frame, and a pole square to the arm is
    // the only kind that keeps deciding which way the elbow points.
    figure.armPivots[i].getWorldPosition(shoulderTarget);
    poleAxis.copy(restHand).sub(shoulderTarget);
    if (poleAxis.lengthSq() > 1e-8) flattenPole(elbowPole, poleAxis.normalize());
    solveTwoJoint(figure.armPivots[i], figure.elbowPivots[i], restHand,
      elbowPole,
      figure.armLengths ? figure.armLengths[i].upper : figure.limb.upper,
      figure.armLengths ? figure.armLengths[i].fore : figure.limb.fore,
      ARM_AXIS);
    /* A FREE WRIST IS AUTHORED, not inherited.
       This used to copy the hand's BIND quaternion, which is its
       rotation relative to the FOREARM - and the forearm has just been
       rotated by the IK, by however much it took to reach the hand
       target. So the hand inherited the solver's roll and hung off the
       thigh twisted, which is what was reported from play.
       Nothing about a hanging arm depends on how the elbow got there. */
    const hand = figure.handPivots[i];
    restHandLocalQuaternion(i, handRestTarget);
    if (handOrientationTransition[i]) {
      hand.quaternion.rotateTowards(handRestTarget, handTurnStep(dt));
      if (hand.quaternion.angleTo(handRestTarget) < 0.001) {
        hand.quaternion.copy(handRestTarget);
        handOrientationTransition[i] = false;
      }
    } else {
      hand.quaternion.copy(handRestTarget);
    }
    hand.updateWorldMatrix(false, true);
  }

  /**
   * Put both arms back to bind before anything solves them.
   *
   * `aimJoint` reads a joint's CURRENT orientation and applies only
   * the minimal rotation that points its axis at the target. That
   * fixes the aim and says nothing about the ROLL about that axis -
   * so the roll is not solved, it is INHERITED, and inherited from
   * a value that is itself last frame's inheritance. It is a
   * free-running integrator with no reference.
   *
   * The legs have always been reset to bind before their solve, two
   * hundred lines up. The arms never were, and they were the only
   * chain in the rig running open-loop.
   *
   * Measured across one melee swing (saintfall-pauldron-probe.mjs):
   * the two upper arms settle at -1.16 and +0.33 radians of twist -
   * an asymmetry of 48 degrees that PERSISTS after the swing ends,
   * because nothing ever winds it back. Linear-blend skinning pinches
   * a limb's cross-section where it is twisted, so 67 degrees of roll
   * collapses that deltoid and the shoulder reads visibly smaller
   * than its opposite number. That is the reported bug exactly:
   * occasional, after weapon use, one side only, and it stays.
   *
   * Resetting costs two quaternion copies a frame and makes the pose
   * a pure function of this frame's targets.
   */
  function resetArmsToBind() {
    if (!figure.armBindQuaternions || !figure.elbowBindQuaternions) return;
    for (let i = 0; i < 2; i += 1) {
      figure.armPivots[i].quaternion.copy(figure.armBindQuaternions[i]);
      figure.elbowPivots[i].quaternion.copy(figure.elbowBindQuaternions[i]);
    }
  }

  function postUpdate(dt = 1 / 60) {
    const weapon = ctx.weapons && ctx.weapons.current;
    // Before ANY of the branches below, all of which solve arms.
    if (figure.root.visible) resetArmsToBind();
    /* With no weapon there are no grips, so the solver drove both
       hands to the same stale target and they folded across the
       chest - directly over the heart-lantern and sunburst, in the
       two review shots that exist to photograph them. */
    if ((!weapon || !weapon.root.visible) && figure.root.visible) {
      figure.root.updateMatrixWorld(true);
      for (let i = 0; i < 2; i += 1) solveRestArm(i, dt);
      return;
    }
    /* Lance on the back: the hands are free, so they get the same
       walking arms as the empty-handed pose rather than being held
       at the grips of something that is no longer in front of them. */
    if (weapon && figure.root.visible && ctx.weapons.carry.handRelease >= 0.999) {
      figure.root.updateMatrixWorld(true);
      for (let i = 0; i < 2; i += 1) solveRestArm(i, dt);
      return;
    }
    if (!weapon || !figure.root.visible) return;

    /* Layer authored combat motion around the weapon's own handhold,
       not around the chest mount. `weapons.update()` has just restored
       the low-ready/ADS/recoil transform, so these deltas are cleanly
       reapplied once per frame and never accumulate. Premultiplying
       preserves the old parent-space action rotation order. */
    weapon.root.position.x += actionPose.x;
    weapon.root.position.y += actionPose.y;
    weapon.root.position.z += actionPose.z;
    poseEuler.set(actionPose.pitch, actionPose.yaw, actionPose.roll);
    weaponOffset.setFromEuler(poseEuler);
    weapon.root.quaternion.premultiply(weaponOffset);
    /* Run the shaft through the hands. Written ABSOLUTELY off the
       bind, every frame, including the frames where the offset is
       zero - the grips are persistent nodes on a weapon that is
       built once and reused, so a clip that only wrote them while
       it was playing would leave the hands wherever the last thrust
       ended. The haft is authored along local +X with the blade at
       +X, so travelling toward the butt is negative. */
    if (weapon.gripBindX) {
      weapon.gripFront.position.x = weapon.gripBindX.front - actionPose.slide;
      weapon.gripRear.position.x = weapon.gripBindX.rear - actionPose.slide;
    }
    weapon.root.updateWorldMatrix(true, true);
    figure.root.updateMatrixWorld(true);

    /* Final two-hand reach constraint for authored actions. The
       polearm now lives 42cm to the side, so old mount-space clips can
       otherwise carry that lateral offset beyond a shoulder even when
       their rotations are good. Translate the handhold—not either
       hand—just enough to keep both elbows inside a bent 34–92% reach
       window. Carry/ADS is already authored inside the window and is
       intentionally left untouched. */
    if (action.name && weapon.root.parent) {
      for (let iteration = 0; iteration < 4; iteration += 1) {
        reachCorrection.set(0, 0, 0);
        let corrections = 0;
        for (let i = 0; i < 2; i += 1) {
          const anchor = i === 0 ? weapon.gripFront : weapon.gripRear;
          anchor.getWorldPosition(gripTarget);
          figure.armPivots[i].getWorldPosition(shoulderTarget);
          reachDirection.copy(gripTarget).sub(shoulderTarget);
          const contactDistance = reachDirection.length();
          if (contactDistance < 1e-5) continue;
          const arm = figure.armLengths ? figure.armLengths[i] : figure.limb;
          const reach = arm.upper + arm.fore;
          /* Clamp the GRIP distance, with no inset credit.

             This used to clamp `contactDistance - inset` and add the
             inset back, because the wrist was then placed a flat
             0.116m nearer the shoulder than the grip - so a grip at
             0.92 reach plus the inset was genuinely reachable.

             Seating the palm on the haft moved the wrist off that
             line: the offset is now perpendicular to the shaft, and
             buys no reach at all. The constraint went on granting the
             credit anyway, decided melee3's contact frame was inside
             the window, and let both arms hit 0% slack with the
             gauntlets 11cm off the grips - at the moment of impact,
             which is the most-looked-at frame in the game.

             0.90 rather than 0.92 leaves room for the seat itself. */
          const wanted = clamp(contactDistance, reach * 0.34, reach * 0.90);
          if (Math.abs(wanted - contactDistance) < 0.001) continue;
          reachCorrection.addScaledVector(
            reachDirection.normalize(), wanted - contactDistance
          );
          corrections += 1;
        }
        if (!corrections) break;
        reachCorrection.multiplyScalar(1 / corrections);
        weapon.root.getWorldPosition(weaponWorld);
        weaponWorld.add(reachCorrection);
        weapon.root.parent.worldToLocal(weaponWorld);
        weapon.root.position.copy(weaponWorld);
        weapon.root.updateWorldMatrix(true, true);
      }
    }

    figureRight.set(1, 0, 0).applyQuaternion(figure.root.quaternion);
    weapon.butt.getWorldPosition(shaftButt);
    weapon.tip.getWorldPosition(shaftTip);
    shaftDirection.copy(shaftTip).sub(shaftButt).normalize();

    for (let i = 0; i < 2; i += 1) {
      // Role order is explicit: Left support hand takes the forward
      // grip; Right trigger hand takes the rear grip.
      const anchor = i === 0 ? weapon.gripFront : weapon.gripRear;
      anchor.updateWorldMatrix(true, false);
      gripTarget.setFromMatrixPosition(anchor.matrixWorld);

      /* WHERE THE WRIST GOES, given where the PALM has to end up.

         The wrist is not the contact. Meshy's hand bone sits at the
         wrist and the hand runs 0.21m along its local +Y to the
         fingertips, with the palm mass centred about 0.105m up that
         axis (measured off the skin weights, not assumed). The old
         solve backed the wrist a flat 0.116m toward the shoulder and
         then aimed +Y at the grip - which points the FINGERS at the
         haft and, since the fingers are longer than the inset, pushes
         them 9cm through and past it. That is the open hand hanging
         off the pole in every review shot.

         Placing the palm instead means working backwards: take the
         approach direction, build the grip frame from it, then step
         back down the finger axis and off the palm face. */
      figure.armPivots[i].getWorldPosition(shoulderTarget);
      if (i === 1 && figure.triggerWristOffsetLocal) {
        // The right hand takes the under-haft grip from outboard and
        // below, so its approach is authored rather than derived.
        handDirection.copy(figure.triggerWristOffsetLocal);
        rotateCarryVector(handDirection).normalize();
      } else {
        // The support hand crosses the chest, so it arrives from its
        // own shoulder.
        handDirection.copy(shoulderTarget).sub(gripTarget).normalize();
      }

      /* Grip frame. FINGERS ALONG THE HAFT, palm onto it.

         A real hand wraps a shaft with the fingers crossing it, and
         that is what the first attempt built. It cannot work here:
         this rig has no finger bones - only LeftHand and RightHand -
         so the fingers are frozen straight and 0.21m long. Pointed
         across the haft they project a hand's width of splayed digits
         out of the silhouette from every angle, which is precisely
         the "not holding it" read.

         Laid ALONG the shaft the same rigid fingers sit inside the
         haft's own line and the palm covers it. It is not the grip an
         animator would pose with knuckles; it is the one that reads
         as holding at the distance the player is standing. */
      /* THE HOLD, as art-directed:

           support (left):  the hand runs STRAIGHT off the forearm,
                            palm up, thumb forward - the haft lies
                            across the open palm.
           trigger (right): on the OUTSIDE of the haft, palm facing
                            inward onto it, thumb forward.

         `handY` is the finger axis. It used to be laid along the
         SHAFT - the no-finger-bones workaround - which welded the
         hand to the weapon and let the wrist fold to whatever angle
         the forearm happened to arrive at; that read as both wrists
         snapped square. The fingers now follow the FOREARM
         continuation instead, per the direction above, and the palm
         direction is authored per hand: up for the support cradle,
         inboard for the trigger side-grip. The seat construction
         below keeps each palm ON its grip whatever the fingers do,
         so the hold survives the change of finger axis.

         SOLVED ITERATIVELY, because the forearm cannot be known until
         the arm is solved and the wrist target cannot be derived
         until the fingers are known. Pass 0 seeds the fingers along
         the shaft; each following pass turns the finger axis toward
         the measured forearm (down to WRIST_BEND_MAX residual),
         re-derives the wrist target from the turned basis, and
         re-solves. Turning the fingers up the forearm also moves the
         wrist target up it - the hand now spans wrist-to-grip the way
         a hand does - so each pass shifts the forearm a little; three
         passes settle it to a few degrees. */
      const release = clamp01(ctx.weapons?.carry?.handRelease || 0);
      for (let bendPass = 0; bendPass < 3; bendPass += 1) {
      if (bendPass === 0) handY.copy(shaftDirection).normalize();
      else handY.copy(wristTiltedY);
      /* Palm seeds, MEASURED not assumed: figure-local +X through the
         root quaternion points trooper-LEFT (the first attempt seeded
         the trigger palm with -figureRight on the strength of an old
         comment calling that inboard, and the probe measured the palm
         facing 0.76 outboard - away from the haft it is holding). */
      if (i === 0) handZ.set(0, 1, 0);
      else handZ.copy(figureRight);
      handZ.addScaledVector(handY, -handZ.dot(handY));
      if (handZ.lengthSq() < 1e-8) handZ.set(0, 1, 0);
      handZ.normalize();

      /* PALM ROLL: the last free parameter in the hold.
         The palm seed above fixes which way the palm faces to within
         a roll about the finger axis, and NOTHING measures that roll
         - the palm sits on the shaft either way, so contact error,
         wrist error and reach are all blind to it. That is why it
         drifted: every gate in the suite passed while both palms sat
         a few degrees off the haft, presenting as the gauntlets
         gripping slightly edge-on rather than wrapping.
         Rolled about handY so the seat below is unaffected: the
         wrist target is derived from handY and handZ AFTER this, so
         the palm stays on its grip at any roll. */
      if (PALM_ROLL[i]) handZ.applyAxisAngle(handY, PALM_ROLL[i]).normalize();

      /* Seat the hand OFF the haft along the palm normal, and back
         down the finger axis so the palm - not the fingertips - lands
         on the grip. Seating along the raw approach instead let the
         offset leak into the finger axis whenever the approach leaned,
         and the hand slid up or down the shaft off its grip. */
      wristTarget.copy(gripTarget)
        .addScaledVector(handY, -PALM_ALONG_FINGERS)
        .addScaledVector(handZ, -PALM_HALF_THICKNESS);

      /* Local +Z is the PALM on this rig, so the basis takes handZ as
         authored. HAND_PALM_LOCAL_Z flips it in one place if that
         convention is ever wrong, rather than per hand - the meshes
         are mirrored in X only, so there is one answer for both. */
      handZ.multiplyScalar(HAND_PALM_LOCAL_Z);
      handX.crossVectors(handY, handZ).normalize();

      /* LETTING GO, mid-sheathe. The lance travels to the back on its
         own; if the hands stayed solved onto its grips they would
         follow it round behind the shoulder and the arms would tie
         themselves in a knot at the far end. Blending the wrist to
         the same rest position the no-weapon branch above uses means
         the release is the arms relaxing, not the IK being switched
         off - and it runs backwards for the draw at no extra cost. */
      if (release > 0.0001) {
        restArmTarget(i, restHand);
        wristTarget.lerp(restHand, release);
      }

      /* Each arm has a different job.

         LEFT/support crosses the breastplate, so its elbow comes
         forward of the chest instead of disappearing behind it.
         RIGHT/trigger stays low and outboard beside the ribs.  The
         old mirrored pole sent that right elbow across the sternum,
         folding it to 61 degrees and producing the raised shrug in
         the user's screenshot. */
      /* BOTH POLES ARE ROUGHLY SQUARE TO THE ARM, and that is the
         whole point of the numbers rather than a happy accident.

         With the weapon at the hip the shoulder-wrist line runs
         nearly straight down, so a pole pointing DOWN says nothing
         about where the elbow goes - it is parallel to the axis the
         elbow turns about, and cancels. The trigger pole used to be
         (-0.25, -0.95, -0.62): 8.9 degrees off the arm, 98.8% of it
         cancelling. The elbow was left to be placed by what survived,
         which was rounding noise, so it span with the reticle and
         turned inside-out - the reported defect.

         These are the poles that reproduce the pose the arms already
         held at the forward reticle, recovered by measuring where the
         elbow actually sat and reading back the pole that implies
         (scripts/saintfall-elbow-pole-calibrate.mjs). Same pose,
         stated in a way the solver can act on. Both are close to
         horizontal because that is what "square to a hanging arm"
         means. Re-run the calibration before nudging them by hand,
         and keep `perp` in the elbow sweep well clear of zero. */
      elbowPole.copy(CARRY_ELBOW_POLE[i]);
      elbowPole.normalize();
      rotateCarryVector(elbowPole);
      /* The wrist already blends to its rest target during sheathe,
         so the elbow pole must make the same trip.  Switching from a
         carry pole to the rest pole only at handRelease=1 produced a
         visible 30cm elbow pop on the final frame (and in reverse on
         draw). Both poles are world-space here, making this blend
         continuous and exactly equal to solveRestArm at full release.

         TURNED about the arm rather than interpolated straight at it -
         see turnPoleToward. Both poles are flattened into the elbow's
         own plane first, which leaves every settled pose exactly as it
         was and gives the blend somewhere safe to happen. The arm axis
         is taken from the ALREADY-BLENDED wrist target, because that
         is the arm the solver is about to be handed. */
      poleAxis.copy(wristTarget).sub(shoulderTarget);
      if (poleAxis.lengthSq() > 1e-8) {
        poleAxis.normalize();
        /* Measured BEFORE flattening, on purpose. Afterwards the pole
           is perpendicular by construction and reads 1.000 whatever
           was handed in, so a gate on the flattened value proves only
           that flattenPole works. What still matters is how much of
           the AUTHORED pole was real: flattening something nearly
           parallel to the arm leaves a tiny residual, and normalising
           that amplifies whatever noise it was made of. This is the
           number that was 0.012 when the elbow span, and 0.149 in the
           middle of the sheathe. */
        if (state.armDebug) {
          const d = state.armDebug[i];
          d.perp = 1 - Math.abs(elbowPole.dot(poleAxis));
          d.wx = wristTarget.x; d.wy = wristTarget.y; d.wz = wristTarget.z;
          d.px = elbowPole.x; d.py = elbowPole.y; d.pz = elbowPole.z;
        }
        if (flattenPole(elbowPole, poleAxis) && release > 0.0001) {
          restArmPole(i, restElbowPole);
          if (flattenPole(restElbowPole, poleAxis)) {
            turnPoleToward(elbowPole, restElbowPole, poleAxis, release);
          }
        }
      }

      const arm = figure.armLengths ? figure.armLengths[i] : figure.limb;
      /* No reach clamp here on purpose. Pulling an out-of-range wrist
         target back toward the shoulder was tried, and it trades the
         wrong thing: the arm stops being locked straight, but the
         hand it is holding the weapon with moves FURTHER off the
         grip, from 10.7cm to 11.5cm. A locked arm is a pose problem;
         a detached hand is the defect being fixed. The demand is
         reduced at its source instead - see melee3's contact key. */
      solveTwoJoint(
        figure.armPivots[i], figure.elbowPivots[i],
        wristTarget, elbowPole, arm.upper, arm.fore, ARM_AXIS
      );

      /* The wrist-bend check that decides whether pass 1 runs: the
         angle between the SOLVED forearm and the authored finger
         axis. The tilt FADES OUT through the sheathe release rather
         than switching off - a hard release threshold here turned the
         cap off in one step as the hands let go, and the stow sweep
         measured it as a 150mm elbow snap at sheathe phase 0.77. As
         the hands leave the grips the release path owns the pose, so
         the cap tapers to nothing by release 0.6. */
      const capFade = 1 - clamp01(release / 0.6);
      if (bendPass === 2 || capFade <= 0.0001) break;
      figure.elbowPivots[i].getWorldPosition(wristBendElbowW);
      figure.handPivots[i].getWorldPosition(wristBendHandW);
      wristForearm.copy(wristBendHandW).sub(wristBendElbowW);
      if (wristForearm.lengthSq() < 1e-8) break;
      wristForearm.normalize();
      const wristBend = Math.acos(clamp(wristForearm.dot(handY), -1, 1));
      if (wristBend <= WRIST_BEND_MAX[i] + 0.01) break;
      wristTiltAxis.crossVectors(handY, wristForearm);
      if (wristTiltAxis.lengthSq() < 1e-8) break;
      wristTiltAxis.normalize();
      wristTiltedY.copy(handY)
        .applyAxisAngle(wristTiltAxis, (wristBend - WRIST_BEND_MAX[i]) * capFade);
      }
      /* Fully author the hand roll. A one-axis aim reaches the grip
         but leaves twist inherited from the forearm, which made the
         open palm face down beside the pole. The frame was built
         above, before the wrist target was derived from it - it has
         to be, because the wrist position depends on where the palm
         and fingers point. Reuse it rather than recomputing from the
         solved wrist, which would feed the solver's own error back
         into the orientation. */
      const hand = figure.handPivots[i];
      handBasis.makeBasis(handX, handY, handZ);
      handWorldQuaternion.setFromRotationMatrix(handBasis);
      /* Blend grip roll to the authored free-hand roll through the
         same release channel as the wrist target. Do it in forearm
         space, then rate-limit only the transition. Near 180 degrees,
         a moving world-space slerp can change which shortest arc it
         chooses and roll the gauntlet almost 100 degrees in one frame. */
      hand.parent.getWorldQuaternion(handParentQuaternion);
      handParentQuaternion.invert();
      handRestQuaternion.copy(handParentQuaternion).multiply(handWorldQuaternion);
      /* Blend toward the AUTHORED free-hand roll, not the bind. The
         bind is relative to the forearm, so it hands the solver's own
         roll back to the wrist - the same reason the resting pose was
         coming out twisted. */
      if (release > 0.0001) {
        restHandLocalQuaternion(i, handFreeTarget);
        handRestQuaternion.slerp(handFreeTarget, release);
        handOrientationTransition[i] = true;
      }
      if (handOrientationTransition[i]) {
        hand.quaternion.rotateTowards(handRestQuaternion, handTurnStep(dt));
        if (release <= 0.0001 && hand.quaternion.angleTo(handRestQuaternion) < 0.001) {
          hand.quaternion.copy(handRestQuaternion);
          handOrientationTransition[i] = false;
        }
      } else {
        hand.quaternion.copy(handRestQuaternion);
      }
      hand.updateWorldMatrix(false, true);
    }
  }

  /**
   * Shove the camera, once, for a discharge.
   *
   * Impulses ACCUMULATE up to a ceiling, the same way the weapon's
   * own recoil does, so holding the trigger builds a tremor instead
   * of re-triggering one identical jolt per shot at the cadence of
   * the gun - which reads as a strobe rather than as sustained fire.
   */
  function punch(amount = 1) {
    state.punch = Math.min(1, state.punch + 0.42 * amount);
  }

  /**
   * Shove the view because a rite landed. `weight` runs 0..1 from a
   * light proc to a capstone and picks the CHARACTER of the shake, not
   * just its size: a heavy event rings slowly and hangs, a light one
   * is a single quick tick. Returns false when motion is reduced or
   * the request is empty, so callers can stay silent.
   */
  function doctrineKick(strength = 0.5, weight = 0) {
    const amount = Number.isFinite(strength) ? clamp(strength, 0, 1.4) : 0;
    if (amount <= 0.001) return false;
    const reduced = systemReducedMotion
      || (typeof document !== "undefined"
        && !!document.body?.classList?.contains("sf-reduced-motion"));
    // Not zero: a reduced-motion player still needs to know the rite
    // fired, and a tenth of the shove is under the threshold that
    // causes trouble while staying above the one that reads.
    const scaled = amount * (reduced ? 0.12 : 1);
    const w = clamp(Number.isFinite(weight) ? weight : 0, 0, 1);
    state.heave = Math.min(1, state.heave + scaled * lerp(0.30, 0.62, w));
    state.heaveFreq = lerp(23, 11, w);
    state.heaveDecay = lerp(9.0, 4.4, w);
    return true;
  }

  /**
   * A ground-speed penalty from a hazard - webbing, in practice, but
   * written against nothing more specific than "how slow" and "how
   * long" so a second hazard can reuse it rather than growing a
   * second multiplier field.
   *
   * Stacks toward whichever is stronger and refreshes toward whichever
   * timer is longer, rather than overwriting either - a second web
   * landing while one is already active must not read as a reprieve.
   */
  function applySlow(factor, seconds) {
    const f = Number.isFinite(factor) ? clamp(factor, 0.05, 1) : 1;
    const s = Math.max(0, Number(seconds) || 0);
    if (s <= 0) return false;
    state.slowFactor = state.slowFor > 0 ? Math.min(state.slowFactor, f) : f;
    state.slowFor = Math.max(state.slowFor, s);
    return true;
  }

  function clearSlow() {
    state.slowFactor = 1;
    state.slowFor = 0;
  }

  /**
   * Hold the trooper where they stand for `seconds`. The web's own
   * verb, written as generically as the slow: no ground travel, no
   * jump, no boost or ignition (those two ask `state.rootFor`
   * themselves), while aiming, firing, swinging and Aegis go on as
   * normal. Refreshes toward the LONGER hold, so a second pin on a
   * held trooper extends the first rather than shortening it.
   */
  function applyRoot(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    if (s <= 0) return false;
    state.rootFor = Math.max(state.rootFor, s);
    return true;
  }

  function clearRoot() {
    state.rootFor = 0;
  }

  /**
   * Flattened. Everything `applyRoot` takes, plus the hands: no shot,
   * no swing, no slam, no boost and no pack for `seconds`, and the
   * attack side of that is enforced in main.js's input dispatch
   * because that is where the game decides what a press means.
   *
   * A swing already in the air is CUT rather than allowed to finish.
   * The alternative - letting the clip run while the input is refused
   * - is a trooper who lands a hit they have already been knocked
   * flat out of, and a player who cannot tell whether the stun
   * applied.
   *
   * Refreshes toward the longer stun, like the root and the slow.
   */
  function applyStun(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    if (s <= 0) return false;
    state.stunFor = Math.max(state.stunFor, s);
    if (action.name && action.name.startsWith("melee")) cancelTransientActions();
    return true;
  }

  function clearStun() {
    state.stunFor = 0;
  }

  /**
   * External displacement - something hauling the trooper. Goes
   * through the same masonry slide and slope gates as a step, so a
   * line cannot drag a body through a wall or up a face it could not
   * walk; a wall simply stops the haul. Returns the distance actually
   * moved so the caller can tell "pinned against something" from
   * "landing". Vertical settles on its own: the grounded branch of
   * `update` eases `state.y` onto whatever ground the body is now over.
   */
  function drag(dx, dz) {
    if (state.free || !Number.isFinite(dx) || !Number.isFinite(dz)) return 0;
    const nx = clamp(state.x + dx, -1010, 1010);
    const nz = clamp(state.z + dz, -1010, 1010);
    let px = nx;
    let pz = nz;
    if (ctx.collide) {
      const out = ctx.collide.slide(
        state.x, state.z, nx, nz,
        state.grounded ? null : state.y,
        undefined,
        state.grounded
          ? (tx, tz) => walkableFrom(state.x, state.z, tx - state.x, tz - state.z)
          : null
      );
      px = out[0];
      pz = out[1];
    }
    const moved = Math.hypot(px - state.x, pz - state.z);
    state.x = px;
    state.z = pz;
    return moved;
  }

  return {
    state,
    punch,
    pulseDoctrine,
    doctrineKick,
    applySlow,
    clearSlow,
    applyRoot,
    clearRoot,
    applyStun,
    clearStun,
    drag,
    carryElbowPole(i) { return CARRY_ELBOW_POLE[i]; },
    /* The palm roll, readable and writable, because it is the one
       part of the hold no metric can grade - see PALM_ROLL. */
    palmRoll(i) { return PALM_ROLL[i]; },
    setPalmRoll(support, trigger) {
      PALM_ROLL[0] = support;
      PALM_ROLL[1] = trigger;
    },
    /* QA-tunable because the last few degrees depend on the visible
       skinned palm surface, not only the abstract hand bone. */
    freeHandPalmTurn() { return FREE_HAND_PALM_TURN; },
    setFreeHandPalmTurn(radians) {
      if (Number.isFinite(radians)) FREE_HAND_PALM_TURN = radians;
      return FREE_HAND_PALM_TURN;
    },
    input,
    figure,
    locomotionProfile: () => ({
      walkSpeed: WALK,
      sprintSpeed: SPRINT,
      groundAcceleration: GROUND_ACCEL_RESPONSE,
      groundDeceleration: GROUND_DECEL_RESPONSE,
      turnResponseScale: TURN_RESPONSE_SCALE,
      flightSpeedScale: FLIGHT_SPEED_SCALE,
      hipHalf: HIP_HALF,
      hipHalfMoving: HIP_HALF_MOVING,
      strideScale: STRIDE_SCALE,
      stanceBias: STANCE_BIAS,
      bodyDropScale: BODY_DROP_SCALE,
      impactScale: IMPACT_SCALE,
      weightSwayM: WEIGHT_SWAY_M,
      weightRoll: WEIGHT_ROLL,
      leanWalk: LEAN_WALK,
      leanSprint: LEAN_SPRINT,
      spineLeanWalk: SPINE_LEAN_WALK,
      spineLeanSprint: SPINE_LEAN_SPRINT,
      /* Live, not authored: the width the gait is actually running
         at this instant, so a probe can tell a narrowing track from
         a figure that never narrows. */
      trackHalf,
      trackGuard: TRACK_GUARD,
    }),
    /* The leg solver's RESOLVED constants, for the review harness.
       `footPose` is figure-authored with defaults filled in here, so a
       probe that reads the figure sees only half the answer and one
       that hard-codes 0.55 measures its own copy of a number this
       file is free to move. */
    legRig: () => ({
      restPitch: REST_FOOT_PITCH,
      flightDev: FLIGHT_ANKLE_DEV,
      devLimit: [ANKLE_DEV_MIN, ANKLE_DEV_MAX],
      hipHalf: HIP_HALF,
      stanceGuard: STANCE_GUARD,
      trackHalf,
      trackGuard: TRACK_GUARD,
      ankle: figure.limb.ankle,
      reach: figure.legLengths
        ? figure.legLengths.map((l) => l.thigh + l.shin)
        : [figure.limb.thigh + figure.limb.shin, figure.limb.thigh + figure.limb.shin],
    }),
    beginAction,
    sampleActionAt,
    meleeSwing,
    meleePierce,
    die,
    cancelTransientActions,
    listActions: () => Object.keys(ACTIONS),
    actionSpec: (n) => ACTIONS[n] || null,
    get action() { return action.name; },
    update,
    postUpdate,
    legs,
    spawn,
    unstuck,
    setFree(on, pos, target, fov) {
      state.free = !!on;
      if (pos) state.freePos.set(pos[0], pos[1], pos[2]);
      if (target) state.freeTarget.set(target[0], target[1], target[2]);
      if (fov) state.freeFov = fov;
    },
    get position() { return { x: state.x, y: state.y, z: state.z }; },
  };
}
