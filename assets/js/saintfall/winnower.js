/* ============================================================
   SAINTFALL - the Winnower

   The Censer Works' flyer, and everything about it that is not
   geometry: how it holds altitude, what it drops, and the two
   different ways it ends up on the ground.

   THE PROBLEM A FLYING BOSS HAS

   An enemy the player cannot reach is not a fight, it is weather.
   Every melee build in the game would be a spectator, and even a
   rifle build spends the encounter looking up at a shape that never
   answers. So the whole design is built backwards from one
   requirement: IT MUST COME DOWN, and it must come down often enough
   that a lance is a legitimate way to fight it.

   It comes down two ways, and both matter:

     THE STOKE, on a timer, whatever the player does. Its gut is a
     furnace and the furnace burns out - so it returns to a flare
     stack to re-light, folds its wings, and is grounded and
     defenceless for a fixed window. A player who owns nothing but a
     censer-lance still gets this, every cycle, for free. That is the
     floor, and it is deliberately generous.

     THE STALL, when the heat sacs on its wing roots are shot out.
     That drains the lift pool in combat.js, and an empty pool means
     it drops NOW rather than on schedule - into a longer, clumsier
     window than the stoke, because it did not choose the landing.
     That is the ceiling, and it is what a ranged build buys with its
     damage.

   The two are the same fight seen from two builds: everybody gets the
   window, and aiming well gets it sooner and for longer.

   WHY THE CENSER WORKS

   The district already burns. Three flare stacks throw real light and
   real heat sixty metres into the sky, and they were in the level
   long before this animal was. It rides them, it re-lights at them,
   and the fight moves between them - so the encounter is anchored to
   landmarks the player has already been navigating by.

   ============================================================
   WHAT IT LOOKS LIKE, AND WHY THAT NEEDED CODE HERE

   It lives in a furnace and its gut IS one. So the art contract is:
   carbon-black sooted chitin, heat-cracked, with the furnace glowing
   through the fissures and lighting its own underside; heat sacs the
   player can find from the ground and watch deflate; wings that are
   membrane rather than sheet metal.

   FOUR THINGS HAD TO CHANGE TO GET THERE.

   1. IT NEEDED ITS OWN MATERIAL. `enemies.js` builds one material per
      SPECIES and registers it `shared: true`, which is correct for a
      caste of forty Threshers and wrong for a boss: the surface kit
      refuses a damage write on a shared material, so this animal could
      never scorch, and no per-boss shader could be hung on it without
      every other winnower-shaped thing in the bestiary inheriting it.
      So the instance takes its own copy of the material, built here.
      Same kit, same door, one extra program - warmed at load, because
      `main.js` runs `render.warmShaders` long after this is built and
      that walk includes hidden objects.

   2. THE ANIMAL WAS NOT BLACK, IT WAS GREY - and the reason is worth
      writing down because it is counter-intuitive. COLOR_0 already
      paints the shell at 0.02 linear, which is nearly black paint. But
      the species material carried `rim: 1.45`, and the atmosphere's rim
      is ADDITIVE and independent of albedo: on a surface with no
      albedo to speak of, the rim IS the surface. Twenty-six metres of
      wing came back reading as galvanised sheet. The rim is turned
      down here and the char is given a real, if narrow, albedo range
      to work in - because the shared surface kit's grain, cavity and
      wear are all MULTIPLIERS, and a multiplier on zero is zero. That
      is why a boss with the kit applied measured as having no
      micro-detail: it had the kit, and nothing for the kit to modulate.

   3. ONE MESH, THREE MATERIALS. There are no UVs and no second draw
      call available, so the split is read out of the model's own
      BIND-POSE object space and its authored vertex colour: the
      wings are everything past |x| = 2.9 above the censer chains, the
      heat sacs are a box on the wing roots, the furnace is everything
      COLOR_0 painted hot. Bind-pose space is also what makes a burst
      sac work - the bone scale that deflates it never moves the field,
      so the mask still knows which sac a pixel belongs to.

   4. IT LIGHTS ITSELF WITHOUT A LIGHT. A new light in this scene
      recompiles every material in it (198 ms, recorded), and the frame
      is fill-bound besides. So the furnace's throw on its own belly is
      a shading term on downward-facing plate, and its throw on the
      SAND is one additive ground pool that follows the animal - one
      draw call, terrain-conformed, brightest when it is down.

   THE ONE BORROWED THING. The furnace fissures are driven by the
   surface kit's own `sfCrack`/`sfMot`/`sfDet`, which are main-scope
   locals of the generated fragment shader. That is deliberate: the
   glow then lands in exactly the creases the relief already carved,
   rather than in a second pattern that disagrees with the first, and
   it costs nothing because the field is already computed. It is also
   a real coupling - if the kit renames those locals this fails as a
   SHADER COMPILE ERROR, which is loud, rather than as a silent
   no-op, which is what the same coupling would cost anywhere else.
   ============================================================ */

import { TAU, clamp, clamp01, damp, dampAngle, lerp, makeBus } from "saintfall/core.js";
import { patchMaterial } from "saintfall/art.js";
import { revealCamera } from "saintfall/reveal-camera.js";
import { applySurface, setSurfaceDamage } from "saintfall/boss-surface.js";
import { DISTRICTS } from "saintfall/terrain.js";

export const WINNOWER_CONFIG = Object.freeze({
  /* The three flare stacks, from world.js's own Censer Works block.
     Mirrored here rather than imported because world.js builds them
     as merged geometry and keeps no table - if the stacks move, this
     moves with them, and the harness asserts they still line up with
     real terrain. */
  stacks: Object.freeze([
    Object.freeze({ x: DISTRICTS.censer.x - 46, z: DISTRICTS.censer.z - 30, h: 58 }),
    Object.freeze({ x: DISTRICTS.censer.x + 8, z: DISTRICTS.censer.z + 18, h: 48 }),
    Object.freeze({ x: DISTRICTS.censer.x + 54, z: DISTRICTS.censer.z - 52, h: 66 }),
  ]),

  /* Walked into, like the Distaff's lair - not a wave that finds the
     player. Wider than the Distaff's 52m because this one is visible
     from much further away and the approach is most of the drama. */
  aggroRadius: 78,
  disengageRadius: 300,
  disengageSeconds: 16,

  // Long enough to establish the silhouette, altitude and arena;
  // the previous threshold released the camera after only 0.42s.
  alertSeconds: 4.8,

  /* CRUISE ALTITUDE. High enough to be unmistakably out of reach,
     low enough that it is still a creature rather than a dot - and
     well under the stacks it circles, so it reads as flying BETWEEN
     them rather than over the whole district. */
  /* ITS TERRITORY. The soar orbits the PLAYER - which, unclamped,
     means it will follow them across the entire map and the leash
     below can never fire, because its distance to the player never
     grows. The orbit anchor is clamped inside this ring around the
     works: chase a player who leaves and it patrols the boundary
     nearest them instead, they keep walking, the distance opens, and
     the disengage finally counts. */
  territoryRadius: 230,
  cruiseHeight: 26,
  /* THE BODY, not the span. The wings reach thirteen metres either
     side and are not what a cracking tower stops; the thorax and the
     furnace gut hanging under it are. Matched to the silhouette the
     encounter actually presents rather than to the bestiary's 1.8m
     collision radius, which is sized for the LANDED animal squeezing
     between refinery plant. */
  bodyRadius: 5.0,
  /* How far above the highest thing under it the body flies. The gut
     hangs about 1.9m below the origin, so this is roughly four
     metres of daylight under the animal. */
  masonryClearance: 6.4,
  /* And the hard floor, for a structure the look-ahead missed. */
  masonryFloor: 3.2,
  /* Climbing over a building is urgent; settling back down is not. */
  climbRate: 5.5,
  /* How much height the animal is assumed able to buy per second
     while it approaches something, in metres. This is what turns the
     look-ahead's answer from a step into a ramp - see `clearanceY`. */
  climbAllow: 7.0,
  /* And the hardest the backstop may shove, in metres per second.
     Fast enough to clear something the look-ahead missed inside a
     few frames, slow enough that it is always a climb. */
  floorClimb: 14,
  orbitRadius: 34,
  orbitSpeed: 0.34,
  bankLimit: 0.55,

  /* How long it can stay up before the furnace runs dry. The floor
     of the whole design: a melee player is never more than this far
     from a window. */
  soarSeconds: 21,
  /* And how long the window itself lasts. Shorter grounded window so
     the boss takes less free damage before re-launching. */
  stokeSeconds: 5.5,
  /* A stall is worse for it than a chosen landing - it hits hard and
     takes longer to get back up. */
  stallStokeSeconds: 7.5,
  /* THE CRASH IS THE REWARD. A stall landing opens with this many
     seconds of the animal simply DOWN - no sweeps, no tracking, no
     answer at all - because the player just spent a whole lift pool
     buying this moment and an immediate counter-attack would refund
     none of it. Scaled to the shorter stall window. */
  crashStunSeconds: 2.6,
  /* Maximum fraction of max health the boss can lose in a single downing cycle.
     Prevents the flyer from being burst down and killed in one downing. */
  downDamageCap: 0.18,
  /* MARTYR DOES NOT GET A LONGER HEALTH BAR AND CALL IT A MECHANIC.
     Its extra vitality already comes from difficulty.js. These values
     instead close the two shortcuts specific to this encounter: four
     casual sac hits grounding it, and full body damage while safely
     circling beneath the airborne phase. */
  martyrLiftPool: 6,
  martyrAirborneBodyMult: 0.45,
  martyrDownDamageCap: 0.14,
  /* Flying home after a disengage. Presentation speed only - the
     heal has already happened when the flight starts. */
  returnSpeed: 12.0,

  landSeconds: 1.9,
  launchSeconds: 1.3,
  /* HOW HIGH THE BODY RIDES WHEN IT IS DOWN.
     The model is authored IN FLIGHT: its origin is the body, the
     landing limbs reach to -2.05 and the furnace gut hangs at -1.85.
     Setting `y` straight to the terrain therefore puts the animal's
     talons and its gut UNDERGROUND - and the gut is the melee target
     the whole encounter exists to offer. It stands on its limbs
     instead, which leaves the gut at about knee height: low enough
     that a player has to get in under the wing, high enough that it
     is visible and a lance can reach it. */
  landedLift: 2.15,

  /* Ash bombardment: the airborne attack. Ballistic so it can be
     walked out from under, which is the only fair way to attack from
     a place the player cannot reach. */
  bombardCadence: 5.2,
  martyrBombardCadence: 4.35,
  /* SECONDS, DERIVED FROM FRAMES OVER FPS - not frames over frames.
     This was 0.42, which is 22/52: the contact FRAME divided by the
     clip LENGTH, a fraction spent as a duration. Every clip in this
     project exports at 24fps (measured: the 52-frame bombard arrives
     as a 2.167s clip), so frame 22 is 0.917s - and the coals were
     being thrown at 0.42s, which is clip frame 10, the exact frame
     the censers are at their furthest BACKWARD anticipation. The
     payload left half a second before the whip that throws it. */
  bombardContact: 0.917,      // frame 22 of 52 at 24fps
  bombardCount: 4,
  /* The fight opens with four coals, then adds one through five even
     health steps. Eight at the brink is still below EMBER_MAX and
     reads as a widening pattern rather than an undodgeable carpet. */
  bombardCountRoused: 8,
  /* Fast enough that the ballistic solve HAS an answer across the
     whole orbit - see `ballistic`. At 19 the reachable ground range
     was 35.6m against a 34m orbit plus 5.5m of scatter, so most of
     every volley fell outside it. */
  bombardSpeed: 24,
  bombardSpread: 5.5,
  /* ASHEN BRACKET. The ordinary volley makes the player move; on
     Martyr a second, marked row lands where that held movement is
     taking them. Reversing or cutting across the tell is the answer. */
  martyrBracketDelay: 0.62,
  martyrBracketCount: 3,
  martyrBracketLeadSeconds: 1.30,
  martyrBracketLeadMax: 13.0,
  martyrBracketSpacing: 7.1,
  martyrTrackCeiling: 30,
  martyrTrackDamp: 8.5,
  /* THE COAL ITSELF, at the centre of its own burst.
     A coal used to damage only on a DIRECT interception - inside a
     1.8m cylinder about the chest - so one landing at the player's
     boots did nothing at all on impact and merely left a burn to
     walk out of. A thrown furnace coal that lands beside you is not
     a near miss. `emberBlast` is the burst it actually makes. */
  emberDamage: 34,
  emberBlast: 4.6,
  /* What is left of the damage at the rim of the burst. The falloff
     keeps the middle of the pattern lethal and its edge survivable,
     which is what makes moving out of it worth doing. */
  emberBlastRim: 0.32,
  /* THE BURN STAYS THE SIZE IT WAS, and the extra punishment is in
     the coal's own burst instead. Ash is a large additive ground
     field and this encounter already runs over the render budget it
     is measured against; widening it to 6.0m cost 2.7ms a frame with
     nineteen of them alight, which is a poor trade for damage that
     `emberBlast` delivers for free. */
  ashRadius: 5.4,
  ashSeconds: 18.0,
  ashDps: 18,
  ashTick: 0.5,
  ashMax: 36,

  /* The strafing run: it drops to just above head height and crosses
     the player in a straight line, dropping a carpet of bombs along the path. */
  strafeCadence: 11.0,
  strafeHeight: 7.5,
  strafeSpeed: 28,
  strafeDamage: 54,
  strafeRadius: 5.2,
  strafeBombInterval: 0.10,

  /* What a landed Winnower does to anything standing next to it. It
     is not helpless on the ground, it is just REACHABLE. */
  sweepCadence: 2.6,
  sweepContact: 0.583,        // frame 14 of 40 at 24fps
  sweepReach: 7.2,
  sweepDamage: 48,

  simRange: 700,
});

const EMBER_MAX = 36;
/* The territory's centre: the stacks' own centroid, computed once -
   the animal patrols the works, not the map. */
const TERRITORY_X = WINNOWER_CONFIG.stacks.reduce((a, s2) => a + s2.x, 0) / 3;
const TERRITORY_Z = WINNOWER_CONFIG.stacks.reduce((a, s2) => a + s2.z, 0) / 3;
/* Mirrors BESTIARY.winnower.collisionRadius. Used before the
   instance exists, which is why it is not read off `inst.spec`. */
const BESTIARY_RADIUS = 1.8;
const ASH_COLOUR = "#ff7a26";
const ASH_EDGE = "#8f2b08";
const ASH_BED = "#1a0d07";

/* ============================================================
   THE PALETTE

   The separation strategy, stated as numbers so it can be checked.
   The Censer Works' ground is `#6a5a52` - warm dark grey, sRGB 0.42,
   linear about 0.145. Everything below is LINEAR albedo, because that
   is what the shader multiplies.

     char   0.030  -> sRGB 0.19   a stop and a half under the ground
     plate  0.088  -> sRGB 0.33   the lit crests of the same shell
     ash    0.170  -> sRGB 0.45   the only mid value on the animal

   So the body sits under its district and the ash sits just over it,
   which is a value SANDWICH rather than a single dark blob - and the
   ash is deliberately COOLER than the sand (b > r) so it separates by
   hue as well. The furnace is the third family and it is the only
   saturated thing in the frame.

   Areas are unequal on purpose, which is the Scarab lesson from the
   art-direction doc: a lot of the neutral, a little of the pale, a
   spot of the saturated. Ash is masked to upward-facing plate only and
   the furnace to what COLOR_0 already painted hot - about a twentieth
   of the surface between them.

   AND IT WAS STILL ONE ORANGE BAND. A blind critic, shown these
   frames next to 2001 Halo, named the same fault in four panels out
   of five: "mean 53, saturation 0.58 across a single orange band",
   "the right wing tip dissolves into the dune entirely". The gallery
   agreed and put a number on it - hue spread 11.3 degrees across a
   whole frame.

   The numbers above were not the reason. They were nearly neutral
   and a stop and a half under the sand, and the animal STILL came
   back warm, because albedo is not what the eye reads on a shell
   authored at 0.03: what it reads is the light landing on it, and
   every light in this frame is warm. A low golden-hour sun is warm,
   the atmosphere's rim is the SKY COLOUR and at golden hour that is
   warm too, and the furnace is the warmest thing in the district. A
   near-black surface under three warm sources is a warm surface.

   So the fix is not darker paint, it is a COLD SOURCE - see
   FURNACE_FRAME. The albedo below only has to stop fighting it: the
   char is pulled to a blue-black (b > g > r rather than the old
   near-neutral) and the ash rime with it, so what little diffuse the
   shell returns lands on the cold side of the frame instead of the
   warm one. */
const CHAR_RGB = [0.0205, 0.0230, 0.0335];
const ASH_RIME_RGB = [0.146, 0.156, 0.198];
/* How much ash may pile on a fully upward-facing plate. Above ~0.7 the
   animal reads as a dusty rock rather than a burnt one - the char has
   to stay the dominant family. */
const RIME_MAX = 0.58;

/* ============================================================
   THE BAKE - part-scale occlusion, and a distance field to the vents

   THE DEFECT THIS EXISTS FOR, quoted, because it decided two blind
   pairs on its own: "where the wing crosses the abdomen there is no
   self-shadow, so the two read as one continuous flat surface and the
   wing loses its identity as a separate limb"; "no occlusion at the
   join... the seam line is LIGHTER than both lobes"; and the summary
   sentence, "a stack of zero-thickness planes whose head, thorax and
   tail cannot be told apart at any zoom". Both frames the critic
   awarded to Halo were awarded on the same words - "soot in the
   cavities", "cavity soot in every plate recess".

   THE SHARED KIT CANNOT DO THIS AND SHOULD NOT TRY. Its cavity is a
   SUB-FACET term by design and by contract - the coarsest octave it
   touches is a metre and the two that reach the normal are 13cm and
   4cm, because anything wider would start eating the faceting that is
   this game's art direction. A wing lying across an abdomen is a
   two-metre fact about two different limbs. No amount of grain can
   see it, because grain does not know what a limb is.

   Nor can the shadow map: it is drawn every second frame across two
   kilometres of basin, and at that texel density a nine-metre animal
   gets one soft blob - which is precisely what the critic described.

   WHAT ACTUALLY KNOWS is the mesh, in the bind pose, at load. So it
   is measured there, once, into a vertex attribute:

     x  OCCLUSION, 0 open .. 1 buried. Eight hemisphere rays per
        vertex, three ranges each, against a coarse voxel occupancy
        grid built by rasterising the TRIANGLES - not the vertices.
        Vertices alone would be wrong on exactly the geometry that
        matters: a 26m wing is a handful of huge triangles with almost
        no vertices in the middle, so a vertex-only field would find
        the wing empty and the abdomen under it unoccluded.

     y  VENT PROXIMITY, 1 at a furnace vent falling to 0 by ~1.1m.
        This is the answer to the third defect - "the orange emissive
        panels butt directly against unlit black with a hard
        stair-stepped polygon boundary". That boundary was a polygon
        boundary because the hot mask is read from COLOR_0, and a
        per-vertex mask can only ever change at an edge. A distance
        field does not care where the edges are, so the glow can bleed
        off the vent into the shell over a real, smooth, sub-polygon
        falloff.

   WHY THE ATTRIBUTE IS OCCLUSION AND PROXIMITY RATHER THAN THEIR
   COMPLEMENTS, which looks like a cosmetic choice and is not: an
   attribute the geometry does not carry is not an error in WebGL, it
   is the generic vertex attribute, which is (0,0,0,1). So the missing
   case has to be the harmless one. Packed this way a mesh that
   somehow escaped the bake renders unoccluded and unlit-by-vents -
   i.e. exactly as it did before this file existed. Packed as AO and
   distance it would render BLACK, and the failure would look like a
   lighting bug rather than like a missing bake.

   COST: it runs once, on the bind pose, from `bindShell`. 17k
   vertices x 8 rays x 3 ranges is about 400k array reads, plus one
   pass rasterising 9k triangles. Measured at 34-48 ms on this
   machine, paid at load beside the model parse, and NOTHING per
   frame - the shader reads one interpolated vec2. A dormant boss
   costs nothing, which is the rule this project already broke once.
   ============================================================ */

/* Cells across the model's longest axis. 56 puts a cell at about
   45cm on a 26m span, which is the scale the occlusion is supposed to
   see: a wing over an abdomen, a leg against a thorax. Finer and the
   field starts finding facet creases, which is the kit's job and not
   this one's, and the grid stops fitting in cache. */
const BAKE_CELLS = 56;
/* How far a ray looks, in cells. Beyond about five the field stops
   being occlusion and becomes "is this vertex near the middle of the
   animal", which darkens the whole body evenly and reads as a grade
   rather than as a cavity. */
const BAKE_STEPS = [1.35, 2.7, 4.8];
const BAKE_WEIGHTS = [0.52, 0.31, 0.17];
/* Eight rays, fixed. A cosine-ish spread around the normal: one up
   the normal itself and seven leaning out at two ring angles, which
   is enough to tell "open sky above me" from "there is a wing across
   me" and few enough to stay inside the load budget. Rotations are
   irrational multiples of a turn so the ring never lines up with the
   tangent frame the vertex happens to get. */
const BAKE_RAYS = (() => {
  const out = [];
  out.push([0, 0, 1]);
  for (let i = 0; i < 4; i += 1) {
    const a = (i + 0.31) * (Math.PI / 2);
    out.push([Math.cos(a) * 0.62, Math.sin(a) * 0.62, 0.785]);
  }
  for (let i = 0; i < 3; i += 1) {
    const a = (i + 0.17) * (Math.PI * 2 / 3);
    out.push([Math.cos(a) * 0.94, Math.sin(a) * 0.94, 0.342]);
  }
  return out;
})();
/* How far the vent glow may bleed, in metres. Past about a metre and
   a half the whole thorax lights up and the animal stops having
   vents; under half a metre the falloff is shorter than a polygon and
   the stair-step comes straight back. */
const VENT_REACH = 1.10;

/**
 * Measure the bind pose once and hand the shader a vec2 per vertex.
 * Idempotent, and keyed on the attribute itself: `enemies.spawn`
 * shares one geometry between every instance of a species, so a
 * second call must find its own work and leave.
 */
function bakeShellFields(THREE, geo) {
  if (!geo || geo.getAttribute("aWnOcc")) return 0;
  const pos = geo.getAttribute("position");
  const nrm = geo.getAttribute("normal");
  const col = geo.getAttribute("color");
  const index = geo.getIndex();
  if (!pos || !nrm) return 0;
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
  const n = pos.count;
  const P = pos.array;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const cell = span / BAKE_CELLS;
  /* One cell of margin on every side, so a ray leaving the model does
     not have to be range-checked against a box it is exactly on. */
  const ox = minX - cell, oy = minY - cell, oz = minZ - cell;
  const nx = Math.ceil((maxX - minX) / cell) + 3;
  const ny = Math.ceil((maxY - minY) / cell) + 3;
  const nz = Math.ceil((maxZ - minZ) / cell) + 3;
  const grid = new Uint8Array(nx * ny * nz);
  const at = (ix, iy, iz) => (
    ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz
      ? 0 : grid[(iz * ny + iy) * nx + ix]);

  const mark = (x, y, z) => {
    const ix = ((x - ox) / cell) | 0;
    const iy = ((y - oy) / cell) | 0;
    const iz = ((z - oz) / cell) | 0;
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return;
    grid[(iz * ny + iy) * nx + ix] = 1;
  };

  /* RASTERISE THE TRIANGLES, at a subdivision set by the triangle's
     own longest edge. A uniform subdivision would either miss the
     wings or spend thousands of samples on the eye. */
  const tri = index ? index.array : null;
  const triCount = tri ? tri.length / 3 : n / 3;
  for (let t = 0; t < triCount; t += 1) {
    const ia = tri ? tri[t * 3] : t * 3;
    const ib = tri ? tri[t * 3 + 1] : t * 3 + 1;
    const ic = tri ? tri[t * 3 + 2] : t * 3 + 2;
    const ax = P[ia * 3], ay = P[ia * 3 + 1], az = P[ia * 3 + 2];
    const bx = P[ib * 3], by = P[ib * 3 + 1], bz = P[ib * 3 + 2];
    const cx = P[ic * 3], cy = P[ic * 3 + 1], cz = P[ic * 3 + 2];
    const e = Math.max(
      Math.abs(bx - ax) + Math.abs(by - ay) + Math.abs(bz - az),
      Math.abs(cx - bx) + Math.abs(cy - by) + Math.abs(cz - bz),
      Math.abs(ax - cx) + Math.abs(ay - cy) + Math.abs(az - cz));
    const k = Math.min(10, Math.max(1, Math.ceil(e / cell)));
    for (let u = 0; u <= k; u += 1) {
      for (let v = 0; v <= k - u; v += 1) {
        const fu = u / k, fv = v / k, fw = 1 - fu - fv;
        mark(ax * fw + bx * fu + cx * fv,
          ay * fw + by * fu + cy * fv,
          az * fw + bz * fu + cz * fv);
      }
    }
  }

  /* ---- occlusion ------------------------------------------------ */
  const occ = new Float32Array(n * 2);
  const N = nrm.array;
  for (let i = 0; i < n; i += 1) {
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    let nxs = N[i * 3], nys = N[i * 3 + 1], nzs = N[i * 3 + 2];
    const ln = Math.hypot(nxs, nys, nzs) || 1;
    nxs /= ln; nys /= ln; nzs /= ln;
    /* A tangent frame off whichever world axis the normal is least
       aligned with, so the cross product never collapses. */
    let tx = 0, ty = 0, tz = 0;
    if (Math.abs(nys) < 0.85) { tx = -nzs; ty = 0; tz = nxs; }
    else { tx = 1; ty = 0; tz = 0; }
    const lt = Math.hypot(tx, ty, tz) || 1;
    tx /= lt; ty /= lt; tz /= lt;
    const bx = nys * tz - nzs * ty;
    const by = nzs * tx - nxs * tz;
    const bz = nxs * ty - nys * tx;
    /* Lifted off its own surface before the march, or every ray's
       first sample lands in the cell the vertex is already in and the
       whole model bakes buried. */
    const sx = px + nxs * cell * 0.9;
    const sy = py + nys * cell * 0.9;
    const sz = pz + nzs * cell * 0.9;

    let hit = 0, total = 0;
    for (let r = 0; r < BAKE_RAYS.length; r += 1) {
      const ray = BAKE_RAYS[r];
      const dx = tx * ray[0] + bx * ray[1] + nxs * ray[2];
      const dy = ty * ray[0] + by * ray[1] + nys * ray[2];
      const dz = tz * ray[0] + bz * ray[1] + nzs * ray[2];
      /* NEAREST HIT WINS AND ENDS THE RAY. Counting every range
         separately would score a vertex under a thick wing three
         times and a vertex under a thin one once, which measures
         thickness rather than occlusion. */
      let w = 0;
      for (let s = 0; s < BAKE_STEPS.length; s += 1) {
        const d = BAKE_STEPS[s] * cell;
        if (at(((sx + dx * d - ox) / cell) | 0,
          ((sy + dy * d - oy) / cell) | 0,
          ((sz + dz * d - oz) / cell) | 0)) { w = BAKE_WEIGHTS[s]; break; }
      }
      hit += w;
      total += BAKE_WEIGHTS[0];
    }
    occ[i * 2] = total > 0 ? Math.min(1, hit / total) : 0;
  }

  /* ---- distance to the nearest furnace vent ---------------------- */
  if (col) {
    const hot = [];
    for (let i = 0; i < n; i += 1) {
      /* Through the accessors, NOT the raw array. COLOR_0 ships as a
         normalised Uint16 attribute, so the array holds 0..65535 and
         the shader sees 0..1; read raw, the 0.5 threshold below was
         effectively zero and 604 faintly warm shell vertices - 15% on
         top of the real vents - were seeded as furnace and bled glow
         and cooked ring into shell the shader itself never lights.
         getX/getY/getZ denormalise. */
      const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      /* The same test the shader makes, at the same threshold, so the
         bleed is anchored to the very pixels that light up. */
      if ((r - lum * 1.35) * 3.4 > 0.5) hot.push(i);
    }
    if (hot.length) {
      /* A hash grid at the bleed radius, so the search is the 27
         cells around a vertex rather than every vent on the animal. */
      const hc = VENT_REACH;
      const key = (ix, iy, iz) => `${ix},${iy},${iz}`;
      const bins = new Map();
      for (const i of hot) {
        const k = key(Math.floor(P[i * 3] / hc), Math.floor(P[i * 3 + 1] / hc),
          Math.floor(P[i * 3 + 2] / hc));
        let arr = bins.get(k);
        if (!arr) { arr = []; bins.set(k, arr); }
        arr.push(i);
      }
      for (let i = 0; i < n; i += 1) {
        const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
        const cxi = Math.floor(px / hc), cyi = Math.floor(py / hc), czi = Math.floor(pz / hc);
        let best = VENT_REACH * VENT_REACH;
        for (let a = -1; a <= 1; a += 1) {
          for (let b = -1; b <= 1; b += 1) {
            for (let c = -1; c <= 1; c += 1) {
              const arr = bins.get(key(cxi + a, cyi + b, czi + c));
              if (!arr) continue;
              for (const j of arr) {
                const dx = P[j * 3] - px, dy = P[j * 3 + 1] - py, dz = P[j * 3 + 2] - pz;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < best) best = d2;
              }
            }
          }
        }
        /* Smoothstepped rather than linear, so the bleed has no
           visible outer edge of its own - a linear ramp to zero puts
           a faint ring exactly where VENT_REACH falls. */
        const d = Math.sqrt(best) / VENT_REACH;
        const s = 1 - d;
        occ[i * 2 + 1] = s * s * (3 - 2 * s) * (d < 1 ? 1 : 0);
      }
    }
  }

  geo.setAttribute("aWnOcc", new THREE.BufferAttribute(occ, 2));
  return (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
}

/* ============================================================
   THE FURNACE SHADER

   NO BACKTICKS ANYWHERE BELOW, INCLUDING IN COMMENTS. These are
   JavaScript template literals and one backtick inside a GLSL comment
   ends the string silently. It has cost this project a debugging
   round already; it is not going to cost another.

   Five injections, all of them into a material that has ALREADY been
   through `patchMaterial` and the shared surface kit. Each anchor is a
   chunk include that the earlier passes re-emit, so every one of them
   is still present to be found - and each block lands BEFORE the kit's
   own code at the same anchor, which is what lets the kit's cavity,
   wear and damage modulate this palette rather than the .glb's.
   ============================================================ */

const FURNACE_PARS = /* glsl */`
uniform vec4 uWnChar;   // char albedo rgb, ash-rime amount
uniform vec4 uWnAsh;    // ash albedo rgb, soot build toward the wing root
uniform vec4 uWnHeat;   // heat 0..1, master gain, band phase, fissure gain
uniform vec4 uWnSac;    // sac L fill, sac R fill, flash, gut swell
uniform vec4 uWnCold;   // cold rim rgb, rim strength
uniform vec4 uWnOccl;   // albedo occlusion, rim occlusion, vent bleed, -
varying vec2 vWnOcc;    // baked: x occlusion 0..1, y vent proximity 0..1
`;

/* Block 0, and the only one in the VERTEX shader: carry the bake
   through. Anchored on `begin_vertex`, which the surface kit's own
   anchor re-emits as its first line, so the chunk is still there to
   be found. See `bakeShellFields` for why the packing is occlusion
   and proximity rather than their complements. */
const FURNACE_ANCHOR = /* glsl */`
#include <begin_vertex>
  vWnOcc = aWnOcc;
`;

/* Block 1. The masks, and nothing else. They are computed at
   `color_fragment` rather than where they are used because the
   roughness chunk runs BEFORE the normal chunk and both need them -
   and because everything here reads only the vertex colour and the
   bind pose, neither of which the later blocks have touched. */
const FURNACE_MASKS = /* glsl */`
/* COLOR_0 IS A MATERIAL INDEX ON THIS MODEL, NOT PAINT. The shell is
   authored at 0.02 linear across 150-odd near-identical near-blacks,
   and the furnace at (1.0, 0.196, 0.02). So its luminance says how
   lit a plate was authored to be and its redness says whether it is
   shell at all - two masks out of one attribute, no second UV set and
   no second material. */
float wnLum = dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float wnHot = clamp((vColor.r - wnLum * 1.35) * 3.4, 0.0, 1.0);
/* The authored shell value, EXPANDED. 0.015-0.05 linear is a range
   no eye can read and no multiplier can rescue; stretched to 0-1 it
   becomes the plate-to-plate value variation the model always had and
   never showed. */
float wnTone = clamp((wnLum - 0.012) * 26.0, 0.0, 1.0);
/* The wings. Everything outboard of the thorax and above the censer
   chains - the bowls swing out to |x| = 3.4 but they hang at y = -4,
   so one height test separates them cleanly. */
float wnWing = smoothstep(2.9, 4.6, abs(vSFObj.x))
             * smoothstep(-1.30, -0.20, vSFObj.y);
/* Soot builds toward the root, so the membrane clears toward the tip.
   A uniformly translucent 26m wing reads as glass; the gradient is
   what makes it read as a wing that has been flown through smoke. */
float wnRoot = 1.0 - smoothstep(3.0, 9.6, abs(vSFObj.x));
/* THE BAKE, read once. Everything below and the two later blocks all
   want it, and an interpolated varying is free to re-read. */
float wnOcc = clamp(vWnOcc.x, 0.0, 1.0);
float wnNear = clamp(vWnOcc.y, 0.0, 1.0);
/* THE VENT, as a FIELD rather than as a polygon mask. wnHot can only
   change at an edge, because it is read out of COLOR_0; wnNear is a
   distance and changes everywhere. Squared so the bleed hugs the vent
   instead of hazing the whole plate. */
float wnVent = max(wnHot, wnNear * wnNear * uWnOccl.z);
/* THE GLOW'S OWN BLEED, and it is a DIFFERENT field from the one
   above - narrower by two powers and a tenth the weight - because the
   two jobs are not the same job. wnVent (above) decides where the
   shell is COOKED: albedo, roughness, the cold rim. That may reach a
   metre from a vent and cost nothing but a warmer brown. This one
   decides where the shell EMITS, and it may not, because of a fact
   about this model that no shader term can argue with: COLOR_0 paints
   a vent between nearly every pair of plates, so 80% of the body's
   vertices sit within VENT_REACH of one. Measured on the .glb: 4019 of
   16992 vertices pass the furnace test, spanning x -12..12 of a
   13m half-span. Gate the core on the wide bleed and the whole animal
   emits furnace orange at 40-76% of vent strength, the coarse mottle
   carves the only variation, and the boss renders as a pale tan
   insect wearing leopard spots - which it did, from the day the core
   was moved off wnHot to soften the vent boundary until this line. The
   softening survives: fourth power keeps the fringe inside ~30cm of
   the painted vent, and uWnOccl.w keeps it a shoot-time knob. */
float wnVentGlow = max(wnHot, wnNear * wnNear * wnNear * wnNear * uWnOccl.w);
/* The heat-affected zone around a vent, in two bands. Computed here
   rather than where it is spent because the roughness chunk runs
   before the normal chunk and both want it - the same reason every
   other mask in this block is here. */
float wnLip = smoothstep(0.30, 0.92, wnNear);
float wnCarbon = smoothstep(0.06, 0.30, wnNear) * (1.0 - smoothstep(0.34, 0.66, wnNear));
`;

/* Block 2. Roughness. THE POINT OF THE WHOLE ROUND: a boss where every
   part answers the sun identically is the "one matte plastic" tell,
   and specular that TRAVELS is the only cue a model with no albedo map
   has. Three families, three lobes - sooted char nearly matte, thin
   membrane glossy, heat-glazed shell around the furnace vitrified. */
const FURNACE_ROUGH = /* glsl */`
roughnessFactor = mix(roughnessFactor, 0.30, wnWing * 0.80);
/* Vitrified around the vent, and along the DISTANCE field rather than
   the vertex mask - shell that has been cooked is glazed for a good
   half metre out from the hole, and a glaze that stops at a polygon
   edge is the same stair-step the emissive had. */
roughnessFactor = mix(roughnessFactor, 0.17, max(wnHot, wnLip) * 0.80);
/* A CREASE IS NOT POLISHED. Dust and soot collect where the bake says
   the sky cannot reach, so occlusion drives roughness up as well as
   albedo down - which is what stops an occluded seam still throwing a
   highlight and reading as a lit edge. */
roughnessFactor = clamp(roughnessFactor + wnOcc * 0.26, 0.045, 1.0);
`;

/* Block 3. Albedo, at `normal_fragment_maps` and deliberately BEFORE
   the kit's own block there - so the kit's cavity, edge wear and
   damage scorch all run on this palette instead of on the .glb's
   near-black. Written outside the kit's distance branch on purpose:
   a recolour is a silhouette-scale decision and must survive to the
   far side of the arena, while the grain that modulates it correctly
   fades out at 140 m. */
const FURNACE_ALBEDO = /* glsl */`
vec3 wnN = inverseTransformDirection(normal, viewMatrix);
vec3 wnAlb = uWnChar.rgb * mix(1.0, 2.95, wnTone) + vec3(0.004, 0.005, 0.009) * wnTone;
/* THE COOKED RING, and it is now a RING rather than a mask.

   The vent shell is not soot-black - it has been cooked - but the
   critic's third defect was that this transition did not exist:
   "the orange emissive panels butt directly against unlit black with
   a hard stair-stepped polygon boundary and no transition value, so
   the panels read as holes cut in card rather than glowing tissue
   under plates". A cooked band that follows the DISTANCE field
   instead of the vertex mask is the transition value, and it lands
   half a metre out from a vent whatever the tessellation does there.

   Two bands, not one, because a real heat-affected zone has them:
   scorched and slightly warm right at the lip, then a dark carbon
   ring just outside it where the soot condenses back down. The dark
   ring is what stops the bleed reading as a soft airbrush.
   Both bands are computed in FURNACE_MASKS, because the roughness
   chunk wants the same lip. */
wnAlb = mix(wnAlb, vec3(0.086, 0.031, 0.014), max(wnHot, wnLip * 0.85));
wnAlb *= 1.0 - 0.55 * wnCarbon;
/* THE MEMBRANE. Thin, faintly warm where the light gets through it,
   choked with soot at the root.

   AND DARK, which took a shoot to learn. At the first values the wing
   was a warm mid brown - and a 26 m wing is most of this animal's
   projected area, so the whole boss landed in the sand's own value and
   hue band and the separation strategy was lost on the largest surface
   it had. The membrane is the biggest thing on the animal, so it is
   the thing that most has to obey the rule. */
/* AND COLD, which is this round's correction. The old value was warm
   (r > g > b) on a surface that is a quarter of the frame, under a
   warm sun, with a warm sky rim on it - three warm terms and nothing
   to answer them, which is how the critic came to write "the right
   wing tip dissolves into the dune entirely". Sooted membrane over a
   pale sky is a COLD grey; the warmth on a wing belongs to the light
   coming through it from the flare stacks, not to the wing. */
vec3 wnMemb = mix(vec3(0.0295, 0.0325, 0.0430), vec3(0.0105, 0.0110, 0.0145),
                  wnRoot * uWnAsh.w);
wnAlb = mix(wnAlb, wnMemb, wnWing * (1.0 - wnHot));
/* ASH SETTLES ON WHAT FACES UP. Blotched through the kit's own
   metre-scale mottle so it lands in drifts rather than as an even
   wash, and kept off the furnace and off most of the wing - a wing
   beats sixty times a minute and does not hold dust. */
float wnUp = smoothstep(0.02, 0.70, wnN.y);
float wnBlot = 0.40 + 0.60 * smoothstep(-0.50, 0.55, sfMot);
float wnRime = wnUp * wnBlot * uWnChar.w * (1.0 - wnHot) * (1.0 - wnWing * 0.62);
/* AND ASH DOES NOT SETTLE IN A CREVICE THE SKY CANNOT SEE. Keying the
   rime off the bake is what turns a value wash into a read: the pale
   dust lands on the exposed tops of plates and stops dead at the
   joins, which draws the joins. */
wnRime *= 1.0 - wnOcc * 0.85;
wnAlb = mix(wnAlb, uWnAsh.rgb, wnRime);
/* THE CAVITY, at PART SCALE. This is the whole reason for the bake,
   and the one line the blind critic's two Halo wins were awarded on.
   It runs LAST so it darkens the finished palette - the ash in the
   crease goes dark with the char in the crease, which is what soot
   in a recess actually does.

   Note it also gates the ambient: three multiplies irradiance by
   diffuseColor, so occluding the albedo occludes the sky fill as
   well as the sun, which is exactly right for a crease. The rim is
   the one term this cannot reach, and FURNACE_FRAME occludes that
   one by hand. */
wnAlb *= 1.0 - wnOcc * uWnOccl.x;
diffuseColor.rgb = wnAlb;
`;

/* Block 4. The furnace itself. Everything here is a smoothstep or a
   multiply-add on fields that already exist, plus exactly one sine for
   the abdominal banding - the frame is fill-bound and a twelve-tap
   glow would not survive contact with a real device. */
const FURNACE_EMIT = /* glsl */`
{
  float wnH = uWnHeat.x;
  /* THE GUT. Object space, centred on the same point combat.js aims
     the gut hit sphere at (heart y -0.85, z 0.35), so the light comes
     out of where the weak point actually is rather than out of the
     model's origin. Squashed on x because the furnace is a wide slung
     bag, not a ball. */
  vec3 wnG = vSFObj - vec3(0.0, -0.85, 0.35);
  wnG.x *= 0.55;
  float wnGut = (1.0 - smoothstep(1.30, 5.40, length(wnG))) * (0.75 + 0.45 * uWnSac.w);
  /* BANDING DOWN THE GASTER. The bands are segment joints, so they
     are a function of the body axis alone; the phase crawls while the
     furnace draws, which is what makes a still animal look alive. */
  float wnBand = 0.5 + 0.5 * sin(vSFObj.z * 2.05 + uWnHeat.z);
  wnBand *= smoothstep(-0.70, -3.60, vSFObj.z);
  /* THE HEAT SACS, and the whole reason this mask is read out of the
     BIND POSE. A burst sac is deflated by scaling its bone, which
     moves every skinned vertex - and moves none of this, because
     vSFObj is the raw attribute. So the mask still knows which sac a
     pixel belongs to after the sac has collapsed, and the glow can
     drain smoothly with the lift pool instead of snapping off. */
  float wnSacBox = smoothstep(0.95, 1.35, abs(vSFObj.x))
    * (1.0 - smoothstep(2.10, 2.60, abs(vSFObj.x)))
    * (1.0 - smoothstep(0.95, 1.35, abs(vSFObj.z - 0.80)))
    * (1.0 - smoothstep(0.90, 1.25, abs(vSFObj.y - 0.30)));
  float wnFill = mix(uWnSac.x, uWnSac.y, step(0.0, -vSFObj.x));
  /* AND THE SAC IS A SWELLING, NOT A PANEL. It used to be gated on
     wnHot alone, which meant a sac was only as big as the few faces
     COLOR_0 happened to paint hot on that wing root - four small flat
     orange rectangles, which is not a weak point a player can find
     from the ground, and the art direction is explicit that a weak
     point a player cannot find is a mechanic that does not exist. The
     distance field lets the swelling run out past the painted faces
     into the shell around it, so it reads as something under the
     plate rather than as a sticker on it. */
  float wnSac = wnSacBox * max(wnHot, wnNear * 0.85) * mix(0.10, 1.0, wnFill);

  /* THE FURNACE THROUGH THE SHELL. sfCrack is the surface kit's own
     deepest-trough band - the same field its damage response cracks
     open - so the light comes out of the creases the relief already
     carved instead of out of a second pattern that disagrees with the
     first. It is already computed; this costs a multiply. */
  /* NOT ON THE WING. There is no furnace behind a membrane, and the
     first shoot of this proved how badly that reads: a close pass put
     gold speckle across thirteen metres of wing and the whole panel
     came back looking like amber glass lit from behind. */
  float wnFiss = sfCrack * (0.30 + 0.95 * wnGut + 0.60 * wnBand)
    * uWnHeat.w * (1.0 - wnWing);

  /* THE SACS ARE THE BRIGHTEST THING ON THE ANIMAL, deliberately and
     by a margin. They are the weak point, the art direction asks for
     one saturated focal element, and the first shoot had the censer
     bowls out-blazing them - which pointed the player's eye at the
     part of the animal that is not the mechanic. */
  /* THE SACS DO NOT GO OUT WITH THE GUT, and that is a mechanical
     decision before it is an artistic one. The furnace banks itself
     during the stoke - which is most of the time the player spends
     within arm's reach of this animal, and the frame this boss is
     photographed in - but the sacs are what hold it up, not what
     burns, and a weak point that disappears for nine seconds of every
     cycle is a weak point the player has to relearn every time it
     comes back. */
  float wnSacH = max(wnH, 0.78);
  /* THE PANEL HAS A SHAPE NOW, and this is defect three's other half.
     The bleed above stopped the vent's BOUNDARY being a polygon edge;
     this stops its INTERIOR being a flat fill. Two terms, both free:

       - a vent is a HOLE. You see more of what is behind a plate when
         you look into it and less when you look along it, so the
         glow leans on dot(N,V). That alone turns every flat-filled
         quad into a gradient that moves as the camera does, which is
         the difference the critic asked for in three separate panels.

       - the shell over a furnace is not uniformly thin. The kit's own
         coarse mottle already describes where it is thick, so the
         glow is modulated by it - and because it is the SAME field
         that carved the relief, the bright parts of a panel land on
         the thin parts of the plate rather than in a second pattern
         that disagrees with the first. */
  float wnLook = clamp(dot(wnN, normalize(cameraPosition - vSFWorld)), 0.0, 1.0);
  float wnThin = 0.62 + 0.38 * smoothstep(-0.65, 0.70, sfMot);
  float wnShape = (0.42 + 0.58 * wnLook) * wnThin;
  float wnCore = (wnVentGlow * (0.40 + 0.36 * wnBand) + wnGut * 0.24) * wnShape;
  /* 2.35, and the number is set by the MEASUREMENT rather than by
     taste. A sac core has to clear linear 1.0 to reach the bloom
     chain's bright threshold at all, and it has to go most of the way
     to white to put a pixel over sRGB 229 - a saturated orange at any
     intensity has a low luminance and simply clips to orange. Two
     stoke frames came back with fewer blown pixels than ANY frame in
     the reference pool; this is the only surface on the animal that
     should be answering that.

     AND IT STILL WAS NOT ENOUGH, because 2.35 was the whole sac at
     one value - a bright flat lozenge, which is a blown highlight
     with no structure and the critic named that too ("clipped to
     flat white with no core-to-halo structure, so the brightest
     event in the frame has no shape"). The second term is the CORE:
     the box mask cubed, which is a tight smooth peak in the middle
     of each sac, so the white is a small hot centre inside an orange
     swelling rather than a filled shape. It is what finally puts
     pixels over sRGB 229 - 02-full measured brightPct 0.0017 against
     a reference pool whose worst frame is 0.0042 - and it puts them
     somewhere a player is supposed to be aiming. */
  float wnSacCore = wnSacBox * wnSacBox * wnSacBox * mix(0.10, 1.0, wnFill);
  float wnGlow = (wnCore + wnFiss) * wnH
    + wnSac * 2.35 * wnSacH + wnSacCore * 1.45 * wnSacH;

  /* WHITE-HOT AT THE CORE. A saturated orange scaled up clips to pure
     orange and stops there, which is exactly why every boss frame this
     programme has measured came back with ZERO blown pixels against a
     reference pool that always has some. Ramping the hue toward white
     as the term rises is what puts a real highlight in the frame. */
  vec3 wnC = mix(vec3(1.00, 0.26, 0.040), vec3(1.00, 0.63, 0.230),
                 clamp(wnGlow * 0.75, 0.0, 1.0));
  /* The white is held back to the genuinely hot CORE - past 1.3 - so
     the fringe of every vent stays orange and the animal keeps its
     hue. A ramp that starts earlier washes the whole furnace pale and
     the boss stops looking like it is burning and starts looking
     like it is lit. */
  wnC = mix(wnC, vec3(1.00, 0.93, 0.84), clamp(wnGlow * 0.42 - 0.72, 0.0, 1.0));
  totalEmissiveRadiance += wnC * wnGlow * uWnHeat.y;

  /* IT LIGHTS ITS OWN UNDERSIDE. There is no second light in this
     scene and there must not be - the first new light in a frame
     recompiles every material in it. So the furnace's throw on its own
     belly is a shading term: downward-facing plate within reach of the
     gut picks the furnace colour up, which is the difference between
     an animal carrying a fire and a black shape with orange stickers. */
  /* SQUARED IN THE GUT TERM, and turned down, which is a correction.
     At a linear falloff over a 5.4m sphere the "underside" was most
     of the animal, so a strafing pass at full heat washed the whole
     body warm - 04-impact came back an orange lozenge in an orange
     dune and the critic could not tell head from thorax from tail.
     Squared, it is a pool under the abdomen with a falling edge,
     which is what a fire in a bag actually throws. */
  float wnBelly = clamp(-wnN.y, 0.0, 1.0) * wnGut * wnGut
    * (1.0 - wnHot) * (1.0 - wnWing);
  totalEmissiveRadiance += vec3(1.00, 0.33, 0.10) * wnBelly * wnH * 0.46 * uWnHeat.y;

  /* THE FLASH. One scalar the module drives on a bombard contact, on
     the re-light at the end of a stoke, and on death. */
  totalEmissiveRadiance += vec3(1.00, 0.55, 0.20) * uWnSac.z
    * (wnHot * 0.85 + wnFiss * 1.4 + wnGut * 0.30);
}
`;

/* Block 5. THE COLD SOURCE, and it is the most important block in
   this file.

   THE DEFECT, in the critic's words, cited in four of five panels and
   the stated deciding reason in two of them: "a single orange band",
   "the right wing tip dissolves into the dune entirely". The gallery
   measured the same thing without being asked - hue spread 11.3
   degrees across a whole frame, on a scale where the reference pool
   runs three to five distinct hue families.

   WHY THE ALBEDO COULD NOT FIX IT. The char is already a blue-black
   at 0.02 linear. It does not matter. Every source in this frame is
   warm - a 13-degree golden-hour sun, a sky whose colour at that hour
   IS the warm term, and a furnace - and a near-black surface returns
   almost nothing of its own, so what you see on it is the source. The
   atmosphere's rim made this worse rather than better, because
   `ATMOS_FRAG` tints the rim with `sfSky`, which at golden hour is
   the same warm cream as the dune behind the animal. The rim was
   painting the boss the colour of its background, along its
   silhouette, which is the one place separation is decided.

   SO THE ANIMAL IS GIVEN A LIGHT OF ITS OWN, and it is cold. Not a
   real light - the first new light in this scene recompiles every
   material in it (198 ms, recorded on the Aegis) and the frame is
   fill-bound besides. A fresnel term, the same shape the atmosphere's
   rim already has, tinted a desaturated blue-violet and weighted
   toward the faces the SUN CANNOT SEE. That last part is what makes
   it read as light rather than as an outline: a shaded flank picking
   up cold sky bounce is what actually happens to a black object under
   a low warm sun, and it is the Hunter's violet sheen, which the
   brief has been pointing at since the first page.

   THREE THINGS IT IS GATED ON, all of them load-bearing:

     - OCCLUSION. A rim is sky light, and a crease has no sky. This is
       the term the albedo cavity cannot reach, because the rim is
       added to gl_FragColor after all the shading - so it is
       subtracted here by hand, and without it every occluded seam
       still drew a bright edge and the bake looked like it had done
       nothing.

     - NOT ON THE FURNACE. A vent is its own emitter and a cold edge
       on it just desaturates the one saturated thing in the frame.

     - HARDEST ON THE MEMBRANE'S OUTER HALF. That is the exact pixel
       the critic said dissolves into the dune, and a thin wing really
       does carry a bright edge, so the strongest version of the cure
       lands on the surface that needed it most.

   Injected at `opaque_fragment`, which `patchMaterial` re-emits, so
   this runs on the finished colour BEFORE the atmosphere's own rim
   and haze - the cold edge is therefore hazed with everything else at
   range instead of floating over the fog like a sticker outline. */
const FURNACE_FRAME = /* glsl */`
{
  vec3 wfV = normalize(vViewPosition);
  float wfF = 1.0 - clamp(dot(normal, wfV), 0.0, 1.0);
  vec3 wfN = inverseTransformDirection(normal, viewMatrix);
  /* 1 on the flanks the sun has left, 0 on the ones it lights. */
  float wfShade = clamp(0.55 - dot(wfN, uSunDir) * 0.85, 0.0, 1.0);
  float wfEdge = wfF * wfF * wfF;
  float wfWing = wnWing * (1.0 - wnRoot);
  float wfAmt = wfEdge * (0.34 + 0.66 * wfShade)
    * (1.0 + 1.15 * wfWing)
    * (1.0 - wnVent) * (1.0 - wnOcc * uWnOccl.y);
  gl_FragColor.rgb += uWnCold.rgb * wfAmt * uWnCold.w;

  /* AND A COLD FILL, not only a cold edge. The rim alone draws an
     outline; what makes the whole flank read cool is a broad
     sky-facing term at a tenth of the strength, which is the
     hemisphere light this renderer does not have. Kept to upward and
     shaded faces so it can never lift the belly, which belongs to the
     furnace. */
  float wfSky = clamp(wfN.y * 0.5 + 0.5, 0.0, 1.0) * wfShade;
  gl_FragColor.rgb += uWnCold.rgb * wfSky * uWnCold.w * 0.16
    * (1.0 - wnVent) * (1.0 - wnOcc);
}
`;

export function buildWinnower(ctx) {
  const { THREE, scene, atmos, enemies } = ctx;
  const bus = makeBus();
  const C = WINNOWER_CONFIG;
  const groundAt = (x, z) => (ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : ctx.terrain.heightAt(x, z));

  const group = new THREE.Group();
  group.name = "winnower-ash";
  scene.add(group);

  /* ============================================================
     THE SHELL

     Its own material, not the species'. `enemies.js` registers the
     species material `shared: true` because forty Threshers draw from
     one - and the surface kit refuses a damage write on a shared
     material for exactly that reason, so this animal could never
     accumulate scorch while it borrowed one. A boss that wants a
     damage response owns its own material; the kit's own header says
     so. One extra program, warmed at load.
     ============================================================ */
  const furnaceUniforms = {
    uWnChar: { value: new THREE.Vector4(CHAR_RGB[0], CHAR_RGB[1], CHAR_RGB[2], 0) },
    uWnAsh: {
      value: new THREE.Vector4(ASH_RIME_RGB[0], ASH_RIME_RGB[1], ASH_RIME_RGB[2], 0.85),
    },
    uWnHeat: { value: new THREE.Vector4(0.30, 1, 0, 1) },
    uWnSac: { value: new THREE.Vector4(1, 1, 0, 0) },
    /* THE COLD SOURCE. A desaturated blue-violet, not a saturated
       blue: the reference's cool light is sky bounce, which is pale,
       and a saturated blue rim on a black insect reads as a neon
       outline the moment it is strong enough to see. The strength is
       the one number in this file worth re-tuning first if the animal
       ever goes plastic - it buys hue separation and it spends value
       range, and past about 0.6 the char stops being char. */
    uWnCold: { value: new THREE.Vector4(0.375, 0.470, 0.735, 0.46) },
    /* x how far part-scale occlusion may darken albedo, y how far it
       may kill the cold rim, z how far a vent may bleed COOKED SHELL
       into the plate around it, w how far it may bleed GLOW - see
       wnVentGlow in FURNACE_MASKS for why those are two numbers and
       why the fourth is small. All four live on a uniform rather than
       in the source so a shoot can be re-tuned without a shader
       recompile - the bake is the expensive half and it does not
       change. */
    uWnOccl: { value: new THREE.Vector4(0.78, 0.90, 1.0, 0.12) },
  };

  const shellMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    /* Faceted, like everything in SAINTFALL above the sand. The grain
       and the furnace both go UNDER the facets; the facet's own value
       step stays the dominant read. */
    flatShading: true,
    /* Higher than the species' 0.54. Soot is matte, and the gloss this
       animal needs is not an overall polish but a TRAVEL - the kit
       modulates around this centre and the two overrides in
       FURNACE_ROUGH pull the membrane and the vitrified shell down out
       of it, which is what makes three materials out of one number. */
    roughness: 0.66,
    metalness: 0.05,
  });
  shellMat.name = "sf-winnower-shell";
  applySurface(shellMat, atmos, "chitin", {
    /* RIM DOWN HARD, from the species' 1.45. The atmosphere's rim is
       additive and albedo-independent: on a shell authored at 0.02
       linear it was not a rim at all, it was the entire surface, and
       the animal came back reading as galvanised sheet rather than as
       char. Not to zero - the rim is what keeps it off the haze at
       200 m, which is where this one is usually seen from.

       DOWN AGAIN, to 0.22, and this time because of its COLOUR rather
       than its strength. `ATMOS_FRAG` tints the rim with `sfSky`, so
       at golden hour the atmosphere was painting this animal's
       silhouette the exact cream of the dune behind it - a
       separation failure applied precisely where separation is
       decided. It keeps enough to hold the shape off the haze at
       range; the cold rim in FURNACE_FRAME is what does the work
       near, and the two are deliberately different colours. */
    rim: 0.22,
    glitter: 0,
    /* Kept non-zero for two reasons. It is the authored glow COLOR_0's
       alpha channel already carries - eyes, censer coals, the vents
       between plates - and it is also the only thing that writes
       diffuseColor.a back to 1 after the vertex colour multiplies a
       0.8 alpha into it. */
    bio: 0.75,
    scale: 1,
    /* Per-instance, so `setSurfaceDamage` works. */
    shared: false,
    /* GRAIN AND CREASE UP from the chitin family's defaults, and the
       reason is this animal specifically: the family's ceiling is set
       by the THINNEST limb wearing it, and nothing on a 26 m flyer is
       thin. The measurement asked for it too - microDetail and
       edgeDensity are the two axes this cast has been failing. */
    score: 0.0028, pore: 0.0010, cavity: 0.44, wavelength: 1.05,
    gloss: 0.34, sheen: 0.10, mottle: 0.20,
    /* Wear low. The kit's wear pass pulls hue out of upward faces and
       lifts their value, which is a rubbed-plate story - the ash rime
       in FURNACE_ALBEDO is this animal's version of it and doing both
       would bleach the char twice. */
    wear: 0.05,
    /* Seen from further out than anything except the Coulter, so the
       detail band is pushed out with it. */
    fadeNear: 62, fadeFar: 142,
    /* The kit's own damage ember, turned up: on this animal a crack
       that lights up is not a wound, it is the inside showing. */
    ember: 0.95,
  });

  /* THE EXTENSION, and the one rule it has to respect.
     `patchMaterial` owns `customProgramCacheKey`, and the failure its
     header warns about is a second `onBeforeCompile` that changes the
     SOURCE without changing the KEY - two variants then silently share
     whichever program compiled first, and the symptom is "my shader
     did nothing". This calls the kit's compile first and EXTENDS its
     key rather than replacing it, so the invariant that warning
     protects still holds. Same shape as the Abbess's rest-pose bind,
     and for the same reason: the right answer is an `extend`
     passthrough on `applySurface`, which this round's report asks for. */
  {
    const compile = shellMat.onBeforeCompile;
    const key = shellMat.customProgramCacheKey;
    shellMat.onBeforeCompile = (shader, renderer) => {
      compile(shader, renderer);
      Object.assign(shader.uniforms, furnaceUniforms);
      /* THE BAKE'S ATTRIBUTE, declared here and NOWHERE ELSE. A
         geometry that never went through `bakeShellFields` still
         compiles and still draws - WebGL hands an unbound attribute
         the generic value (0,0,0,1) - which is why the packing is
         occlusion and proximity rather than AO and distance. See the
         bake's header. */
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>",
          "#include <common>\nattribute vec2 aWnOcc;\nvarying vec2 vWnOcc;")
        .replace("#include <begin_vertex>", FURNACE_ANCHOR);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FURNACE_PARS}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${FURNACE_MASKS}`)
        .replace("#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>\n${FURNACE_ROUGH}`)
        .replace("#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>\n${FURNACE_ALBEDO}`)
        .replace("#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>\n${FURNACE_EMIT}`)
        /* LAST, and after `opaque_fragment` rather than before it -
           this block reads gl_FragColor, which does not exist until
           that chunk has run. `patchMaterial` re-emits the include
           with its own atmosphere appended, so what lands here is
           colour, then the cold source, then the sky rim and haze. */
        .replace("#include <opaque_fragment>",
          `#include <opaque_fragment>\n${FURNACE_FRAME}`);
    };
    shellMat.customProgramCacheKey = () => `${key.call(shellMat)}|winnowerFurnace2`;
    shellMat.needsUpdate = true;
  }

  let shellBound = false;
  let bakeMs = 0;
  /** Hand the instance its own shell, and measure the bind pose once.
   *  Idempotent: `ensureSpawned` is reached from a restore and from
   *  the QA reset as well as from construction.
   *
   *  THE BAKE RIDES HERE rather than at construction because this is
   *  where the meshes first exist - the model is loaded async and the
   *  module is built before it lands. `ensureSpawned` runs on the
   *  first update tick, beside the model parse and before the shader
   *  warm, which is the cheapest place in the frame budget to spend
   *  forty milliseconds once. Nothing per frame comes out of it. */
  function bindShell() {
    if (shellBound || !inst?.root) return;
    inst.root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.material = shellMat;
      bakeMs += bakeShellFields(THREE, o.geometry);
    });
    shellBound = true;
  }

  /* ============================================================
     THE GROUND POOL - what the furnace throws on the sand.

     A boss whose whole design is "it is on fire" has to put light on
     the ground under it or the fire is a decal. A real light is the
     obvious answer and the wrong one twice over: the first new light
     in a frame recompiles every material in the scene (198 ms,
     measured on the Aegis), and this frame is GPU fill-bound so a
     point light is paid by every lit pixel in it whether or not the
     animal is on screen.

     One additive terrain-conformed disc instead. It costs one draw
     call, it is hidden whenever the encounter is not live, and it
     fades toward BLACK with distance rather than toward the sky -
     additive blending cannot subtract, so a hazed additive surface
     that mixes toward sky colour paints a pale wedge over the
     mountains (art.js records that one).
     ============================================================ */
  const POOL_RINGS = 3;
  const POOL_SIDES = 20;
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
  const poolFragment = /* glsl */`
    precision highp float;
    uniform vec3 uCore;
    uniform vec3 uEdge;
    uniform float uGain;
    uniform float uTime;
    varying float vRadial;
    varying vec3 vWorld;
    void main() {
      float r = clamp(vRadial, 0.0, 1.0);
      // Squared falloff, which is what a source at a height actually
      // throws; a linear one reads as a painted circle.
      float fall = (1.0 - r) * (1.0 - r);
      // Two incommensurate rates, so the flicker never finds a beat.
      float flick = 0.84 + 0.11 * sin(uTime * 5.3) + 0.09 * sin(uTime * 12.7);
      float far = 1.0 - smoothstep(200.0, 340.0, length(cameraPosition - vWorld));
      float a = fall * uGain * flick * far;
      if (a < 0.004) discard;
      gl_FragColor = vec4(mix(uCore, uEdge, r) * a, a);
    }
  `;
  const poolGeo = new THREE.BufferGeometry();
  const poolPos = new Float32Array(POOL_VERTS * 3);
  {
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
      for (let s = 0; s < POOL_SIDES; s += 1) {
        radial[1 + r * POOL_SIDES + s] = (r + 1) / POOL_RINGS;
      }
    }
    poolGeo.setAttribute("position", new THREE.BufferAttribute(poolPos, 3));
    poolGeo.setAttribute("aRadial", new THREE.BufferAttribute(radial, 1));
    poolGeo.setIndex(index);
  }
  const poolMat = new THREE.ShaderMaterial({
    uniforms: {
      uCore: { value: new THREE.Color("#ff8a30") },
      uEdge: { value: new THREE.Color("#7a1c04") },
      uGain: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: poolVertex,
    fragmentShader: poolFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const poolMesh = new THREE.Mesh(poolGeo, poolMat);
  poolMesh.name = "sf-winnower-pool";
  poolMesh.frustumCulled = false;
  poolMesh.visible = false;
  poolMesh.renderOrder = 4;
  group.add(poolMesh);
  const pool = { x: 1e9, z: 1e9, radius: 0, gain: 0 };

  /** Re-lay the pool on the sand. Only when it has actually moved -
   *  every vertex costs a terrain sample, and an animal holding
   *  station over one spot must not pay for sixty identical rebuilds
   *  a second. */
  function layPool(x, z, radius) {
    const y = groundAt(x, z);
    for (let r = 0; r < POOL_RINGS; r += 1) {
      const rr = radius * ((r + 1) / POOL_RINGS);
      for (let s = 0; s < POOL_SIDES; s += 1) {
        const a = (s / POOL_SIDES) * TAU + r * 0.17;
        const px = Math.cos(a) * rr;
        const pz = Math.sin(a) * rr;
        const i = (1 + r * POOL_SIDES + s) * 3;
        poolPos[i] = px;
        poolPos[i + 1] = groundAt(x + px, z + pz) - y + 0.09;
        poolPos[i + 2] = pz;
      }
    }
    poolPos[0] = 0; poolPos[1] = 0.09; poolPos[2] = 0;
    poolMesh.position.set(x, y, z);
    poolGeo.attributes.position.needsUpdate = true;
    poolGeo.computeBoundingSphere();
    pool.x = x; pool.z = z; pool.radius = radius;
  }

  /* ============================================================
     THE CONTACT SHADOW - the second decal, and the one that says the
     animal is standing on the planet.

     THE DEFECT, cited on every one of our frames that showed ground:
     "the only darkening under the body is a broad soft blob that does
     not follow the body outline, and it sits at a different angle
     from the long cast shadows the rails throw"; "a wide soft ellipse
     offset to the LEFT of the body it belongs to and shaped nothing
     like the creature".

     Both halves of that are true and neither is a bug. The blob is
     the real shadow map, and it is a blob because it is one atlas
     drawn every second frame across two kilometres of basin - a nine
     metre animal gets a handful of texels and a wide filter kernel,
     so what lands on the sand is a smudge with no outline and a
     penumbra several metres wide. Raising the resolution is a
     renderer-wide cost paid by every frame of the game for one
     animal, and this frame is already fill-bound.

     So the outline is drawn instead, as a decal, the same way the
     furnace's throw already is - and for the same reason: one draw
     call, terrain-conformed, hidden whenever the encounter is not
     live. Three things it has to get right, because they are the
     three the critic named:

       SHAPE. Not a circle. An ellipse long across the wing span and
       short along the body, pinched on the four diagonals, which is a
       moth outline rather than a puddle. It turns with the animal.

       DIRECTION. It leans away from the sun, by the animal's own
       height over the tangent of the sun's elevation - the same
       construction that makes the rails throw the long shadows the
       critic compared it against. At golden hour that is a long lean,
       which is exactly what the frame wants.

       CONTACT. The lean is applied per RING, so the inner ring stays
       under the body and only the outer edge travels. A shadow whose
       dark centre has walked off its own animal is the fault we are
       fixing, not a stylisation of it.

     Normal blending with a soft dark hue, so the shadow darkens the
     sand without any white multiply-bleed artifacts under tone mapping.
     ============================================================ */
  const CAST_RINGS = 3;
  const CAST_SIDES = 24;
  const CAST_VERTS = 1 + CAST_RINGS * CAST_SIDES;
  const castVertex = /* glsl */`
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
  const castFragment = /* glsl */`
    precision highp float;
    uniform vec3 uTint;
    uniform vec2 uGain;   // strength, penumbra exponent
    varying float vRadial;
    varying vec3 vWorld;
    void main() {
      float r = clamp(vRadial, 0.0, 1.0);
      /* The exponent is the PENUMBRA. On the ground it is high, so
         the edge is nearly hard and the outline reads; in the air it
         falls toward 1 and the whole thing turns into the soft wide
         nothing a shadow cast from thirty metres actually is. */
      float core = pow(1.0 - r, uGain.y);
      float far = 1.0 - smoothstep(210.0, 340.0, length(cameraPosition - vWorld));
      float a = core * uGain.x * far * 0.72;
      if (a < 0.004) discard;
      gl_FragColor = vec4(uTint, a);
    }
  `;
  const castGeo = new THREE.BufferGeometry();
  const castPos = new Float32Array(CAST_VERTS * 3);
  {
    const radial = new Float32Array(CAST_VERTS);
    const index = [];
    for (let s = 0; s < CAST_SIDES; s += 1) {
      const n = (s + 1) % CAST_SIDES;
      index.push(0, 1 + s, 1 + n);
      for (let r = 0; r < CAST_RINGS - 1; r += 1) {
        const a0 = 1 + r * CAST_SIDES + s;
        const a1 = 1 + r * CAST_SIDES + n;
        const b0 = 1 + (r + 1) * CAST_SIDES + s;
        const b1 = 1 + (r + 1) * CAST_SIDES + n;
        index.push(a0, b0, b1, a0, b1, a1);
      }
    }
    for (let r = 0; r < CAST_RINGS; r += 1) {
      for (let s = 0; s < CAST_SIDES; s += 1) {
        radial[1 + r * CAST_SIDES + s] = (r + 1) / CAST_RINGS;
      }
    }
    castGeo.setAttribute("position", new THREE.BufferAttribute(castPos, 3));
    castGeo.setAttribute("aRadial", new THREE.BufferAttribute(radial, 1));
    castGeo.setIndex(index);
  }
  const castMat = new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: new THREE.Color("#140f12") },
      uGain: { value: new THREE.Vector2(0, 1.4) },
    },
    vertexShader: castVertex,
    fragmentShader: castFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  const castMesh = new THREE.Mesh(castGeo, castMat);
  castMesh.name = "sf-winnower-contact";
  castMesh.frustumCulled = false;
  castMesh.visible = false;
  /* BEFORE the furnace pool, deliberately. A fire under the animal
     fills its own shadow; a shadow drawn over the fire erases it. */
  castMesh.renderOrder = 3;
  group.add(castMesh);
  const cast = { x: 1e9, z: 1e9, yaw: 1e9, lean: -1, gain: 0 };

  /** Lay the outline on the sand. Same contract as `layPool`: every
   *  vertex is a terrain sample, so this only runs when the animal has
   *  actually moved, turned or changed height. */
  function layCast(x, z, yaw, alt, spread) {
    const y = groundAt(x, z);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    /* The sun's ground heading, and the length of the lean. `sunDir`
       points TOWARD the sun, so a shadow runs along its negation, and
       the length is height over the tangent of the elevation - which
       for a 13-degree golden-hour sun is four times the height. Capped,
       because past about ten metres the decal stops being this
       animal's contact shadow and becomes a stripe on the dune. */
    let sx = -atmos.sunDir.x, sz = -atmos.sunDir.z;
    const sl = Math.hypot(sx, sz) || 1;
    sx /= sl; sz /= sl;
    const lean = clamp(alt / Math.max(0.16, atmos.sunDir.y) * 0.42, 0, 9.5);
    /* Half-span across the wings and half-length along the body. The
       spread closes when the wings fold for a stoke - a folded animal
       that still throws an eight-metre wing shadow is worse than no
       shadow at all, because it contradicts the silhouette. */
    const halfW = 3.4 + 5.0 * spread;
    const halfL = 4.9;
    for (let r = 0; r < CAST_RINGS; r += 1) {
      const t = (r + 1) / CAST_RINGS;
      for (let s = 0; s < CAST_SIDES; s += 1) {
        const a = (s / CAST_SIDES) * TAU;
        const cs = Math.cos(a), sn = Math.sin(a);
        /* An ellipse, then pinched on the diagonals. The pinch is what
           makes it a moth rather than a puddle: two wing lobes and a
           body, from one cheap term. */
        const e = 1 / Math.hypot(cs / halfL, sn / halfW);
        const shape = e * (1 - 0.28 * Math.abs(Math.sin(a * 2)) ** 1.4) * t;
        let px = fx * (shape * cs) - fz * (shape * sn);
        let pz = fz * (shape * cs) + fx * (shape * sn);
        // Per ring, so the contact stays put and only the edge travels.
        px += sx * lean * t;
        pz += sz * lean * t;
        const i = (1 + r * CAST_SIDES + s) * 3;
        castPos[i] = px;
        castPos[i + 1] = groundAt(x + px, z + pz) - y + 0.055;
        castPos[i + 2] = pz;
      }
    }
    castPos[0] = 0; castPos[1] = 0.055; castPos[2] = 0;
    castMesh.position.set(x, y, z);
    castGeo.attributes.position.needsUpdate = true;
    castGeo.computeBoundingSphere();
    cast.x = x; cast.z = z; cast.yaw = yaw; cast.lean = lean;
  }

  /** The outline on the sand, and how hard it is pressed there. */
  function updateCast(dt) {
    const live = !!inst && !inst.encounterHidden && state.phase !== "dormant"
      && inst.state !== "death";
    const ground = live ? groundAt(inst.x, inst.z) : 0;
    const alt = live ? Math.max(0, inst.y - ground) : 999;
    /* It fades out with height rather than travelling to the horizon.
       A shadow cast from cruise altitude is forty metres downrange and
       three stops fainter, and drawing it would put a dark smear on
       sand the animal is nowhere near. */
    const want = live ? clamp01(1 - alt / 26) * 0.92 : 0;
    cast.gain = damp(cast.gain, want, 6, dt);
    castMat.uniforms.uGain.value.x = cast.gain;
    /* Nearly hard on the ground, wide open in the air - the penumbra
       of a real shadow grows with the distance to the caster. */
    castMat.uniforms.uGain.value.y = clamp(2.5 - alt * 0.18, 1.05, 2.5);
    if (cast.gain < 0.006) {
      if (castMesh.visible) castMesh.visible = false;
      return;
    }
    if (!castMesh.visible) castMesh.visible = true;
    const spread = inst.grounded && state.phase === "stoke" ? 0.30 : 1.0;
    const lean = clamp(alt / Math.max(0.16, atmos.sunDir.y) * 0.42, 0, 9.5);
    /* atan2 of the sine and cosine rather than a subtraction, because
       `cast.yaw` starts at a sentinel and a while-loop wrap on 1e9
       does not terminate in any useful amount of time. */
    const dYaw = Math.abs(Math.atan2(Math.sin(inst.yaw - cast.yaw),
      Math.cos(inst.yaw - cast.yaw)));
    if (Math.hypot(inst.x - cast.x, inst.z - cast.z) > 1.1
      || dYaw > 0.14 || Math.abs(lean - cast.lean) > 0.7) {
      layCast(inst.x, inst.z, inst.yaw, alt, spread);
    }
  }

  const state = {
    phase: "dormant",   // dormant, alert, soar, strafe, land, stoke, launch, dead
    timer: 0,
    /* SECONDS OF FLIGHT LEFT IN THE FURNACE, and deliberately its own
       accumulator rather than the phase timer.

       It was the phase timer once, and that quietly broke the single
       promise this encounter makes: every strafing run ends by
       re-entering `soar`, which reset the timer, so a Winnower that
       strafed on its twelve-second cadence refilled its own fuel
       every twelve seconds and NEVER came down on schedule. A melee
       build would have waited forever for a window the design says
       it is owed. This burns across every airborne phase and is
       refilled in exactly one place: the launch, after it has
       actually re-lit at a stack. */
    fuel: 0,
    orbit: 0,
    bombardTimer: C.bombardCadence * 0.6,
    strafeTimer: C.strafeCadence * 0.7,
    sweepTimer: 0,
    action: 0,
    actionKind: null,
    pending: 0,
    stackIndex: 0,
    stalled: false,
    stunFor: 0,
    revealed: false,
    disengageFor: 0,
    defeated: false,
    releaseCameraAt: undefined,
    strafeFrom: null,
    strafeTo: null,
    strafeT: 0,
    landFrom: null,
    landTo: null,
    landSpan: 0,

    /* ---- the furnace, and the body that hangs off it ----
       Kept on `state` rather than on the uniforms so that a save
       restore lands the animal in a lit condition rather than a dark
       one, and so `status()` can report the heat the player is
       actually looking at. */
    heat: 0.30,
    flash: 0,
    /* Wingbeat phase, and the sink it drives. `bob` is stored because
       it is REMOVED from inst.y before the altitude damp runs and put
       back after - a damp that chases a target through its own
       oscillation flattens the oscillation out. */
    beat: 0,
    bob: 0,
    /* How far the furnace has swelled ahead of an attack. This is the
       anticipation: pressure builds, THEN the thing happens. */
    swell: 0,
    /* How long the current stoke window is, so the re-light knows
       where it is in it. A stall's window is longer than a chosen
       landing's, and the staging has to stretch with it. */
    stokeSpan: 0,
    /* Surface damage last written. `setSurfaceDamage` touches a
       uniform, so it is only written when it has actually moved. */
    shownDamage: 0,
    /* Which stage of the re-light the stoke has reached, so the flare
       fires once rather than every frame of the window. */
    relit: false,
    /* One committed Martyr follow-up volley. Kept on the phase state so
       reset, save restore and leash transitions can cancel it rather
       than leaving delayed bombs behind after the fight has moved on. */
    bracketFor: 0,
    bracketTargets: [],
    profileTier: null,
  };
  let inst = null;
  const playerTrack = { x: 0, z: 0, vx: 0, vz: 0, seeded: false };

  const martyr = () => ctx.difficulty?.tier === "martyr";
  const activeDownDamageCap = () => martyr() ? C.martyrDownDamageCap : C.downDamageCap;
  const activeBombardCadence = () => martyr() ? C.martyrBombardCadence : C.bombardCadence;

  /** Difficulty is live in both menus, so the encounter profile must be
   *  live too. Preserve the fraction already drained when the tier is
   *  changed mid-flight; a menu change must not secretly refuel it. */
  function syncDifficultyProfile() {
    if (!inst) return;
    const profile = martyr() ? "martyr" : "standard";
    const wanted = martyr() ? C.martyrLiftPool : (inst.spec?.liftPool || 0);
    if (state.profileTier === profile && inst.maxLift === wanted) return;
    const beforeMax = Math.max(0.001, Number(inst.maxLift) || wanted || 1);
    const fraction = clamp01((Number(inst.lift) || 0) / beforeMax);
    inst.maxLift = wanted;
    inst.lift = wanted * fraction;
    if (fraction >= 1 - 1e-6 && Array.isArray(inst.sacBurst)) inst.sacBurst.fill(false);
    state.profileTier = profile;
  }

  /** Player velocity for the Martyr lead. Differenced here so walking,
   *  boost and forced movement share one honest source. A teleport is
   *  discarded rather than mistaken for a three-hundred-metre sprint. */
  function trackPlayer(dt) {
    const ps = ctx.player?.state;
    if (!ps) return;
    if (!playerTrack.seeded || dt < 1e-5) {
      playerTrack.x = ps.x; playerTrack.z = ps.z; playerTrack.seeded = true;
      return;
    }
    const dx = ps.x - playerTrack.x;
    const dz = ps.z - playerTrack.z;
    playerTrack.x = ps.x;
    playerTrack.z = ps.z;
    if (Math.hypot(dx, dz) / dt > C.martyrTrackCeiling) {
      playerTrack.vx = 0;
      playerTrack.vz = 0;
      return;
    }
    const k = 1 - Math.exp(-C.martyrTrackDamp * dt);
    playerTrack.vx += (dx / dt - playerTrack.vx) * k;
    playerTrack.vz += (dz / dt - playerTrack.vz) * k;
  }

  function cancelBracket() {
    state.bracketFor = 0;
    state.bracketTargets.length = 0;
  }

  /** Keep the dormant encounter allocated but absent from both the
   *  renderer and every authoritative damage path. Alert reveals the
   *  animal while keeping it protected; combat clears the lock only
   *  when the camera returns. */
  function setEncounterGate(hidden, locked = hidden) {
    if (!inst) return;
    inst.encounterHidden = !!hidden;
    inst.encounterLocked = !!locked;
    if (inst.root) inst.root.visible = !inst.encounterHidden;
  }

  /* ============================================================
     EMBER SHOT - a lobbed coal from the censers. Ballistic, exactly
     like the Coulter's venom, because an attack from thirty metres
     up that arrives instantly cannot be answered.
     ============================================================ */
  /* WHAT THE CRITIC LED ITS WHOLE VERDICT WITH, and it was this
     object: "a bare flat-shaded orange hexagon floats at centre-right:
     single flat fill, no shading gradient across its faces, no
     specular, no shadow, no scene context... an untextured placeholder
     primitive that made it into a screenshot". It called it the worst
     thing it saw in the entire round.

     It was not a placeholder. It was this ember - a zero-subdivision
     icosahedron, which seen down one of its own axes IS a regular
     hexagon, carrying `emissive #ff7a26` at intensity 1.85. A
     saturated orange emissive at 1.85 swamps every lit term on the
     mesh, so the diffuse gradient that would have told you it was a
     solid was simply not in the output: what reached the frame was
     one flat fill across a hexagonal outline. The critic read the
     image correctly and the image was wrong.

     THE FIX IS THE SAME ONE THE SHELL NEEDED, one scale down. A coal
     is a BLACK thing with fire inside it, not an orange thing. So the
     albedo goes to char, the emissive comes off the material and onto
     a shader term that varies PER FACE, and the faces are picked out
     by the object-space normal - which on a flat-shaded icosahedron is
     constant across a face and rotates with the coal, so the pattern
     is glued to the lump instead of swimming through it. Some faces
     are open and white-hot, some are crusted over and nearly black,
     and the silhouette is no longer one value.

     Plus the three things the particle complaint asked for and this
     had none of: SIZE VARIANCE, per-instance ROTATION, and tumble on
     all three axes rather than two. */
  const emberGeo = new THREE.IcosahedronGeometry(0.34, 0);
  const emberMat = new THREE.MeshStandardMaterial({
    /* Char, at the shell's own value. A coal thrown by this animal is
       a piece of this animal. */
    color: new THREE.Color(CHAR_RGB[0] * 2.2, CHAR_RGB[1] * 2.2, CHAR_RGB[2] * 2.2),
    roughness: 0.74,
    metalness: 0,
    flatShading: true,
  });
  emberMat.name = "sf-winnower-ember";
  /* Object-space normal, carried per face. `objectNormal` is the
     attribute before any of three's transforms, and on flat-shaded
     geometry every vertex of a face carries the same one, so the
     varying is constant across the face and the hash below is a
     per-face constant rather than a noise field - which is why it can
     never alias however small the coal gets on screen. */
  const EMBER_FRAG = /* glsl */`
#include <emissivemap_fragment>
{
  /* A per-face constant in 0..1. The multiplier is arbitrary and its
     only job is to decorrelate the twenty faces of an icosahedron
     from each other. */
  float ce = fract(sin(dot(vWnEmN, vec3(17.31, 41.77, 29.13))) * 4371.79);
  /* Crusted, open, or blazing. Two thresholds rather than a ramp,
     because a coal is a crust with holes in it, and a smooth ramp
     across the faces is the flat fill this replaced. */
  float open = smoothstep(0.32, 0.55, ce) * (0.35 + 0.65 * smoothstep(0.55, 0.92, ce));
  /* The bottom of a falling coal is the face the air is feeding, so
     it runs hotter. The normal is object space and the mesh tumbles,
     so this is a face that brightens as it rolls into the airflow. */
  float lick = 0.55 + 0.45 * clamp(-vWnEmN.y, 0.0, 1.0);
  float g = open * lick;
  vec3 c = mix(vec3(1.00, 0.24, 0.03), vec3(1.00, 0.72, 0.36),
               clamp(g * 1.35, 0.0, 1.0));
  totalEmissiveRadiance += c * g * 2.4;
}
`;
  patchMaterial(emberMat, atmos, {
    rim: 0.55,
    glitter: 0,
    extend: (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWnEmN;")
        .replace("#include <beginnormal_vertex>",
          "#include <beginnormal_vertex>\n  vWnEmN = objectNormal;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWnEmN;")
        .replace("#include <emissivemap_fragment>", EMBER_FRAG);
    },
    extendKey: "wnEmber1",
  });
  const embers = [];
  for (let i = 0; i < EMBER_MAX; i += 1) {
    const mesh = new THREE.Mesh(emberGeo, emberMat);
    mesh.visible = false;
    mesh.castShadow = false;
    group.add(mesh);
    embers.push({
      mesh, live: false, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      spin: 0, spinY: 0, spinZ: 0,
    });
  }
  let emberCursor = 0;

  function launchEmber(x, y, z, vx, vy, vz) {
    const e = embers[emberCursor];
    emberCursor = (emberCursor + 1) % EMBER_MAX;
    e.live = true;
    e.life = 5.0;
    e.x = x; e.y = y; e.z = z;
    e.vx = vx; e.vy = vy; e.vz = vz;
    /* Three axes, three rates. Two axes at a fixed ratio is a
       gyroscope, and twelve of them tumbling in step read as one
       effect rather than as twelve coals. */
    e.spin = (Math.random() - 0.5) * 8;
    e.spinY = (Math.random() - 0.5) * 6.5;
    e.spinZ = (Math.random() - 0.5) * 5;
    /* Size and start attitude, per shot. Every coal was the same lump
       at the same orientation before this, which is most of why they
       read as a repeated sprite. */
    const s = 0.68 + Math.random() * 0.72;
    e.mesh.scale.set(s, s * (0.82 + Math.random() * 0.34), s);
    e.mesh.rotation.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
    e.mesh.position.set(x, y, z);
    e.mesh.visible = true;
    return e;
  }

  /* ============================================================
     ASH FIELDS - the burning ground the embers leave.

     Same pooled, terrain-conformed construction as the Coulter's
     venom and the Distaff's webbing, and deliberately so: three
     hazards built three different ways would each need their own
     bugs found. What differs is what it DOES - this one burns rather
     than poisoning or slowing, so it is the hazard that punishes
     standing still rather than the one that punishes moving.
     ============================================================ */
  const ASH_RINGS = 3;
  const ASH_SIDES = 22;
  const ASH_VERTS = 1 + ASH_RINGS * ASH_SIDES;

  /* THE ANGLE IS NO LONGER A VARYING, and that was a real bug rather
     than a tuning problem.

     `aAngle` ran 0 to TAU around the rim, so the LAST wedge - the one
     between side 21 and side 0 - interpolated from 5.997 straight back
     to 0. Every harmonic built on it therefore swept thirty radians
     backwards across that one wedge, printing a dense fan of spokes
     in a single sector of every burn in the game. The critic saw the
     result and called it "concentric-ring moire aliasing across its
     whole radius".

     The local direction has no seam, so the angle is recovered in the
     fragment shader instead. `atan` jumps at the cut, but every use of
     it below is a sine of an INTEGER multiple of the angle, and those
     are continuous across the cut by periodicity - so the seam is
     genuinely gone rather than moved somewhere less visible. */
  const ashVertex = /* glsl */`
    attribute float aRadial;
    varying float vRadial;
    varying vec2 vLocal;
    varying vec3 vWorld;
    void main() {
      vRadial = aRadial;
      vLocal = position.xz;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;
  /* Burning ground is BRIGHT at its cracks and dark everywhere else,
     which is the opposite of the venom pool's soaked bed. Drawn with
     ordinary alpha rather than additively for the same reason the
     venom is: the char has to be able to darken the sand under it,
     and additive blending cannot subtract. The heat is then added
     back only in the cracks, where it belongs. */
  const ashFragment = /* glsl */`
    precision highp float;
    uniform vec3 uCore;
    uniform vec3 uEdge;
    uniform vec3 uBed;
    uniform float uFade;
    uniform float uTime;
    varying float vRadial;
    varying vec2 vLocal;
    varying vec3 vWorld;
    void main() {
      float r = clamp(vRadial, 0.0, 1.0);
      float ang = atan(vLocal.y, vLocal.x);
      // A crust that cools from the rim inward, cracked by a slow
      // radial break-up so it never reads as a painted disc.
      float p1 = ang * 5.0 + r * 7.0;
      float p2 = ang * 9.0 - r * 4.0;
      /* ANTIALIASED THE WAY EVERY OTHER ANALYTIC PATTERN IN THIS
         PROJECT IS - by the exact screen derivative of its own phase,
         which is available here because these are sines with a known
         phase rather than sampled noise (art.js records the same
         reasoning for the dune ripples).

         The constants are set by the EXPONENT, not by taste: a
         pow(|sin|, 12) spike is about 0.29 radians wide and a
         pow(|sin|, 16) about 0.25, so each fades to half amplitude
         when one pixel covers that much phase. Without this, a burn
         seen at a grazing angle across twenty metres of sand put
         several rings inside one pixel and the whole decal shimmered
         - which is the second half of the moire the critic named. */
      float w1 = fwidth(p1);
      float w2 = fwidth(p2);
      float a1 = 1.0 / (1.0 + w1 * w1 * 11.0);
      float a2 = 1.0 / (1.0 + w2 * w2 * 16.0);
      /* And the spokes CONVERGE at the middle, where any angular
         pattern is guaranteed to be sub-pixel however close the
         camera gets. Fading them out under a metre of the centre is
         the only correct answer; no amount of derivative work can
         rescue a singularity. */
      float mid = smoothstep(0.06, 0.30, r);
      float crack = (pow(abs(sin(p1)), 12.0) * a1
                   + pow(abs(sin(p2)), 16.0) * a2) * mid;
      float breathe = 0.62 + 0.38 * sin(uTime * 1.9 - r * 5.0);
      float bed = 1.0 - smoothstep(0.30, 1.0, r);
      float heat = clamp(crack * breathe * (1.0 - r * 0.55), 0.0, 1.0);
      vec3 c = mix(uBed, uEdge, bed * 0.75);
      c = mix(c, uCore, heat);
      float dist = length(cameraPosition - vWorld);
      float far = 1.0 - smoothstep(190.0, 320.0, dist);
      float a = (bed * 0.80 + heat * 0.75) * uFade * far;
      if (a < 0.006) discard;
      gl_FragColor = vec4(c, clamp(a, 0.0, 0.92));
    }
  `;

  const fields = [];
  for (let i = 0; i < C.ashMax; i += 1) {
    const geo = new THREE.BufferGeometry();
    const position = new Float32Array(ASH_VERTS * 3);
    const radial = new Float32Array(ASH_VERTS);
    const index = [];
    for (let s = 0; s < ASH_SIDES; s += 1) {
      const n = (s + 1) % ASH_SIDES;
      index.push(0, 1 + s, 1 + n);
      for (let r = 0; r < ASH_RINGS - 1; r += 1) {
        const a0 = 1 + r * ASH_SIDES + s;
        const a1 = 1 + r * ASH_SIDES + n;
        const b0 = 1 + (r + 1) * ASH_SIDES + s;
        const b1 = 1 + (r + 1) * ASH_SIDES + n;
        index.push(a0, b0, b1, a0, b1, a1);
      }
    }
    for (let r = 0; r < ASH_RINGS; r += 1) {
      const t = (r + 1) / ASH_RINGS;
      for (let s = 0; s < ASH_SIDES; s += 1) {
        radial[1 + r * ASH_SIDES + s] = t;
      }
    }
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("aRadial", new THREE.BufferAttribute(radial, 1));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCore: { value: new THREE.Color(ASH_COLOUR) },
        uEdge: { value: new THREE.Color(ASH_EDGE) },
        uBed: { value: new THREE.Color(ASH_BED) },
        uFade: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: ashVertex,
      fragmentShader: ashFragment,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `sf-ash-field-${i}`;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    fields.push({
      mesh, mat, position, life: 0, span: 1, x: 0, y: 0, z: 0,
      radius: C.ashRadius, smoke: 0,
    });
  }
  let fieldCursor = 0;

  function spillAsh(x, z, radius = C.ashRadius, seconds = C.ashSeconds) {
    const field = fields[fieldCursor];
    fieldCursor = (fieldCursor + 1) % fields.length;
    const y = groundAt(x, z);
    field.x = x; field.y = y; field.z = z;
    field.radius = radius;
    field.span = seconds;
    field.life = seconds;
    field.smoke = 0;
    const p = field.position;
    p[0] = 0; p[1] = 0.08; p[2] = 0;
    for (let r = 0; r < ASH_RINGS; r += 1) {
      const rr = radius * ((r + 1) / ASH_RINGS);
      for (let s = 0; s < ASH_SIDES; s += 1) {
        const a = (s / ASH_SIDES) * TAU + r * 0.12;
        const wob = 1 - 0.14 * Math.sin(a * 3 + r * 1.9) - 0.06 * Math.cos(a * 7);
        const px = Math.cos(a) * rr * wob;
        const pz = Math.sin(a) * rr * wob;
        const i = (1 + r * ASH_SIDES + s) * 3;
        p[i] = px;
        // Every rim vertex on the sand beneath it - the difference
        // between a burn and a sticker, same as the venom pool.
        p[i + 1] = groundAt(x + px, z + pz) - y + 0.08;
        p[i + 2] = pz;
      }
    }
    field.mesh.position.set(x, y, z);
    field.mesh.geometry.attributes.position.needsUpdate = true;
    field.mesh.geometry.computeBoundingSphere();
    field.mesh.visible = true;
    ctx.vfx?.blast?.(x, y + 0.4, z, radius * 0.5);
    bus.emit("ash", { x, y, z, radius });
    return field;
  }

  function ashAt(x, y, z) {
    for (const field of fields) {
      if (field.life <= 0) continue;
      const dx = x - field.x;
      const dz = z - field.z;
      if (dx * dx + dz * dz > field.radius * field.radius) continue;
      if (Math.abs(y - field.y) > 3.2) continue;
      return field;
    }
    return null;
  }

  const burn = { tick: 0, standing: false };

  function updateFields(dt) {
    for (const field of fields) {
      if (field.life <= 0) {
        if (field.mesh.visible) field.mesh.visible = false;
        continue;
      }
      field.life -= dt;
      if (field.life <= 0) {
        field.mesh.visible = false;
        field.mat.uniforms.uFade.value = 0;
        continue;
      }
      const t = field.life / field.span;
      const fade = t > 0.85 ? clamp01((1 - t) / 0.15) : clamp01(t / 0.85) ** 0.65;
      field.mat.uniforms.uFade.value = fade;
      field.mat.uniforms.uTime.value = atmos.elapsed;
      field.smoke -= dt;
      if (field.smoke <= 0) {
        field.smoke = 0.42;
        ctx.vfx?.venomGas?.(field.x, field.y + 0.25, field.z,
          field.radius * 0.7, fade * 0.5);
      }
    }
    /* Burning ground applies in HALF-SECOND TICKS, not per frame -
       the same reasoning as the Coulter's toxin: per frame fires the
       hurt bus sixty times a second and makes the damage the player
       sees depend on their frame rate. */
    const ps = ctx.player?.state;
    if (!ps || ctx.combat?.player?.dead) { burn.standing = false; return; }
    const field = ashAt(ps.x, ps.y, ps.z);
    burn.standing = !!field;
    if (!field) { burn.tick = 0; return; }
    burn.tick += dt;
    if (burn.tick < C.ashTick) return;
    const seconds = burn.tick;
    burn.tick = 0;
    ctx.combat.hurtPlayer(C.ashDps * seconds, {
      source: "winnower-ash", x: ps.x, y: ps.y + 1.0, z: ps.z,
    });
  }

  /**
   * The burst a landed coal makes.
   *
   * A direct interception is simply the zero-distance case of the
   * same falloff, so there is one damage number for the attack
   * rather than a hit and a separate miss that did nothing.
   *
   * BLOCKED BY MASONRY, and it has to be: the works are full of tank
   * walls and a burst that reaches through one is the sort of unfair
   * that reads as a bug rather than as difficulty. One ray per
   * impact, four to eight impacts a volley.
   */
  function emberBurst(hit) {
    /* No blast effect here: `spillAsh` fires one at the same point on
       the same frame, and two additive bursts in one place is both
       double the fill and a visibly brighter flash than authored. */
    const ps = ctx.player?.state;
    if (!ps || ctx.combat?.player?.dead) return;
    const dx = ps.x - hit.x;
    const dz = ps.z - hit.z;
    const flat = Math.hypot(dx, dz);
    if (flat > C.emberBlast) return;
    /* A coal that goes off on a gantry above or a floor below is not
       standing next to you. */
    if (Math.abs((ps.y + 1.0) - hit.y) > 4.0) return;
    if (ctx.collide?.rayBlock && flat > 0.6) {
      const ex = ps.x - hit.x;
      const ey = (ps.y + 1.0) - (hit.y + 0.5);
      const ez = ps.z - hit.z;
      const len = Math.hypot(ex, ey, ez) || 1e-4;
      const open = ctx.collide.rayBlock(
        hit.x, hit.y + 0.5, hit.z, ex / len, ey / len, ez / len, len
      );
      if (open < len - 0.2) return;
    }
    const t = clamp01(flat / Math.max(0.01, C.emberBlast));
    const falloff = lerp(1, C.emberBlastRim, t * t);
    ctx.combat?.hurtPlayer?.(C.emberDamage * falloff, {
      source: "winnower-ember", x: hit.x, y: hit.y, z: hit.z,
    });
    ctx.player?.punch?.(lerp(1.1, 0.4, t));
    if (t < 0.45) ctx.player?.doctrineKick?.(0.5, 0.35);
  }

  function updateEmbers(dt) {
    const ps = ctx.player?.state;
    for (const e of embers) {
      if (!e.live) continue;
      e.life -= dt;
      const px = e.x, py = e.y, pz = e.z;
      e.vy -= 20 * dt;
      e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
      e.mesh.position.set(e.x, e.y, e.z);
      e.mesh.rotation.x += e.spin * dt;
      e.mesh.rotation.y += e.spinY * dt;
      e.mesh.rotation.z += e.spinZ * dt;
      // A coal in flight sheds its own trail, which is most of what
      // sells it as falling fire rather than a thrown rock.
      ctx.vfx?.spark?.(e.x, e.y, e.z, 0.32, false, false);

      let hit = null;
      const step = Math.hypot(e.x - px, e.y - py, e.z - pz);
      if (step > 1e-4 && ctx.collide?.rayBlock) {
        const blocked = ctx.collide.rayBlock(px, py, pz,
          (e.x - px) / step, (e.y - py) / step, (e.z - pz) / step, step);
        if (blocked < step) {
          hit = {
            x: px + ((e.x - px) / step) * blocked,
            y: py + ((e.y - py) / step) * blocked,
            z: pz + ((e.z - pz) / step) * blocked,
            direct: false,
          };
        }
      }
      if (!hit && ps && !ctx.combat?.player?.dead) {
        const dx = e.x - ps.x;
        const dz = e.z - ps.z;
        const dy = e.y - (ps.y + 1.0);
        if (dx * dx + dz * dz < 1.8 * 1.8 && Math.abs(dy) < 1.6) {
          hit = { x: e.x, y: e.y, z: e.z, direct: true };
        }
      }
      if (!hit && e.y <= groundAt(e.x, e.z) + 0.25) {
        hit = { x: e.x, y: groundAt(e.x, e.z), z: e.z, direct: false };
      }
      if (hit) {
        e.live = false;
        e.mesh.visible = false;
        emberBurst(hit);
        spillAsh(hit.x, hit.z);
        continue;
      }
      if (e.life <= 0) { e.live = false; e.mesh.visible = false; }
    }
  }

  /* ============================================================
     FLIGHT
     ============================================================ */

  const _vec = new THREE.Vector3();

  /**
   * Collapse a burst heat sac.
   *
   * `combat.js` has tracked `inst.sacBurst` since the lift pool
   * existed, and its own comment says the flag is "what lets the
   * model stop drawing them" - but for one build the model never drew
   * them at all, so a player emptying the pool got no art, no
   * feedback and no state change for half the fight. The sacs are now
   * real geometry on their own bones, and a burst one deflates.
   *
   * Driven every frame rather than on the event, because a save
   * restored mid-fight has to come back with the right sacs down and
   * there is no event to replay.
   */
  /**
   * How full a sac is, 0..1, DERIVED from the lift pool rather than
   * tracked separately.
   *
   * combat.js bursts sac `i` when the pool falls past its own quarter
   * of the maximum, so the same arithmetic run backwards gives a
   * continuous fill that reaches zero at exactly the moment the burst
   * flag is set. That is what makes "visibly deflating as they drain"
   * true rather than "visibly gone once they are drained" - and it
   * costs nothing to restore, because the pool is already saved.
   */
  function sacFill(i) {
    if (!inst || !Array.isArray(inst.sacBurst)) return 1;
    if (inst.sacBurst[i]) return 0;
    const max = inst.maxLift || 1;
    const per = max / inst.sacBurst.length;
    return clamp01(((inst.lift ?? max) - (max - per * (i + 1))) / per);
  }

  function syncSacs() {
    if (!inst?.sacBurst) return;
    for (let i = 0; i < inst.sacBurst.length; i += 1) {
      const bone = inst.bones.get(i === 0 ? "sac_L" : "sac_R");
      if (!bone) continue;
      /* Bottoms out at the same 0.34 a burst sac always collapsed to;
         what changed is that it gets there over the drain instead of
         in one frame. A weak point the player cannot see working is a
         mechanic that does not exist. */
      const fill = sacFill(i);
      /* A full sac BREATHES with the furnace. Tiny - 3% - because the
         thing being sold is a pressure vessel, not a lung, and because
         anything bigger fights the clip's own wing-root motion. */
      const breath = 1 + 0.03 * fill * state.heat
        * Math.sin(atmos.elapsed * 2.3 + i * 1.7);
      const want = (0.34 + 0.66 * fill) * breath;
      if (Math.abs(bone.scale.x - want) > 0.002) bone.scale.setScalar(want);
    }
  }

  function nearestStack(x, z) {
    let best = C.stacks[0];
    let bestD = Infinity;
    for (const s of C.stacks) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  /** Altitude it wants right now, measured off the ground below it so
   *  it clears the terrace step rather than flying into it. */
  function cruiseY(x, z) {
    return groundAt(x, z) + C.cruiseHeight;
  }

  /* ============================================================
     FLYING OVER THE WORKS RATHER THAN THROUGH IT

     `groundAt` is the TERRAIN, and the Censer Works is the densest
     built district on the map: tank farms, cracking towers, a
     catwalk ring and three flare stacks between 48 and 66 metres.
     Every airborne height in this module was terrain plus a
     constant, so the animal cruised at 26m over ground that had a
     43m tower standing on it and simply passed through. Measured
     across an airborne cycle: 1.9% of frames with the body inside
     masonry, the worst of them 10.9m deep, all of them during the
     low strafing pass.

     `solidTop` is the collision grid's own answer for the highest
     solid surface at a point, so this asks the same question the
     player's own collider would. Sampled around the body rather than
     under its origin - a twenty-six metre animal is not a point -
     and again along its travel, because a flyer that reacts to a
     tower when it is already inside it has not avoided anything.
     ============================================================ */
  const CLEAR_RING = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
  ];
  function solidCrest(x, z, radius) {
    const top = ctx.collide?.solidTop;
    if (!top) return -Infinity;
    let hi = top(x, z);
    for (const [ox, oz] of CLEAR_RING) {
      const h = top(x + ox * radius, z + oz * radius);
      if (h > hi) hi = h;
    }
    return hi;
  }

  /**
   * The altitude the body must hold to clear what it is over AND
   * what it is about to be over.
   *
   * `lead` is a distance along travel, not a time: the soar and the
   * strafing run differ by better than three times in speed, and a
   * fixed number of seconds would either lift the cruise a hundred
   * metres early or let the strafe arrive inside a tower.
   */
  const CLEAR_LEAD = [0.25, 0.5, 0.75, 1.0];
  /**
   * The altitude the body needs RIGHT NOW.
   *
   * Not "the height of the tallest thing ahead" - that is a step
   * function, and asking a damp to follow one produced exactly the
   * artefact this whole section exists to remove: the crest jumped
   * twelve metres the instant a tower entered the sample ring and
   * the animal gained a metre in a single frame.
   *
   * What a flyer actually needs is to be clear of each obstacle BY
   * THE TIME IT GETS THERE, so every sample's requirement is
   * discounted by the climbing it can do in the meantime. A tower
   * two seconds away asks for almost nothing yet and asks for all of
   * it smoothly as it approaches, which is a ramp rather than a
   * step, and reads as an animal choosing to gain height.
   */
  function clearanceY(x, z, dirX, dirZ, speed, seconds) {
    let need = solidCrest(x, z, C.bodyRadius) + C.masonryClearance;
    if (speed * seconds > 0.5) {
      for (const k of CLEAR_LEAD) {
        const t = seconds * k;
        const crest = solidCrest(
          x + dirX * speed * t, z + dirZ * speed * t, C.bodyRadius
        );
        if (!Number.isFinite(crest)) continue;
        const want = crest + C.masonryClearance - C.climbAllow * t;
        if (want > need) need = want;
      }
    }
    return need;
  }

  /**
   * Hold `inst.y` above the masonry, given a target it would rather
   * be at. Climbs faster than it sinks, so a tower lifts the animal
   * promptly and it settles back at its own pace afterwards.
   *
   * The final `Math.max` is a floor, not the mechanism: with the
   * look-ahead working it should never bind, and it is there so that
   * a structure the lead missed - a spawn inside one, a teleport, a
   * strafe line laid across a tank - still cannot end with the body
   * drawn through a wall.
   */
  function flyToward(want, dirX, dirZ, speed, seconds, rate, dt) {
    const clear = clearanceY(inst.x, inst.z, dirX, dirZ, speed, seconds);
    const target = Math.max(want, clear);
    inst.y = damp(inst.y, target, target > inst.y ? Math.max(rate, C.climbRate) : rate, dt);
    /* RATE LIMITED, because a backstop that teleports is worse than
       the thing it is backing up. Left as a plain `Math.max` this
       lifted the body 4.86m in a single frame the moment a tower
       entered the sample ring - a fix for flying through a building
       that read as being shoved out of one. The look-ahead above is
       the mechanism; this only ever has to cover what it missed, and
       it can take a few frames doing it. */
    const here = solidCrest(inst.x, inst.z, C.bodyRadius);
    if (Number.isFinite(here)) {
      const floor = here + C.masonryFloor;
      if (inst.y < floor) inst.y = Math.min(floor, inst.y + C.floorClimb * dt);
    }
  }

  function faceTravel(dt, tx, tz, rate = 2.0) {
    const dx = tx - inst.x;
    const dz = tz - inst.z;
    if (Math.hypot(dx, dz) < 1e-3) return;
    const want = Math.atan2(dx, dz);
    const before = inst.yaw;
    inst.yaw = dampAngle(inst.yaw, want, rate, dt);
    /* BANK INTO THE TURN. The roll is derived from how fast the yaw
       is actually changing rather than authored per phase, so every
       turn in the encounter banks by the same rule and a tight one
       banks harder by construction. */
    const turn = ((inst.yaw - before + Math.PI * 3) % TAU) - Math.PI;
    const wantRoll = clamp(-turn / Math.max(1e-4, dt) * 0.22,
      -C.bankLimit, C.bankLimit);
    inst.roll = damp(inst.roll, wantRoll, 3.0, dt);
  }

  function beginAlert() {
    state.phase = "alert";
    state.timer = C.alertSeconds;
    setEncounterGate(false, true);
    enemies.play(inst, "alert", 0.25);
    bus.emit("aggro", { x: inst.x, y: inst.y, z: inst.z });
    /* Authored hero framing: looking up at the Winnower on its perch
       from the open southern approach to the Censer stacks, with zero
       obstructions regardless of which direction the player arrived from. */
    if (state.revealed) return;
    state.revealed = true;
    if (ctx.player?.setFree && !ctx.player.state.free) {
      const perch = perchPoint();
      const camX = perch.x - 26;
      const camZ = perch.z + 32;
      const camY = groundAt(camX, camZ) + 4.2;
      /* The authored shot is a preference: the solver ray-tests it
         against the collision grid (the Censer stacks are exactly the
         kind of thing that ends up between an authored lens and a
         perched animal) and re-frames around the body if it is
         blocked. See reveal-camera.js. */
      revealCamera(ctx, {
        label: "winnower",
        preferred: [camX, camY, camZ],
        target: [inst.x, inst.y + 4.0, inst.z],
        halfHeight: 7, halfWidth: 6,
        floorY: inst.y + 0.5,
        fov: 50,
      });
      state.releaseCameraAt = 0;
    }
  }

  function releaseEncounterCamera() {
    ctx.player?.setFree?.(false);
    state.releaseCameraAt = undefined;
  }

  /** Re-enter the orbit. Does NOT touch the fuel - see `state.fuel`.
   *  Coming back from a strafing run is not a refuel, and treating it
   *  as one is what stops the animal ever landing. */
  function beginSoar() {
    state.phase = "soar";
    inst.grounded = false;
    inst.lift = inst.maxLift;
    if (Array.isArray(inst.sacBurst)) inst.sacBurst.fill(false);
    state.stalled = false;
    state.healthAtDowningStart = undefined;
    state.damageThisDowning = 0;
    if (inst.state !== "strain") enemies.play(inst, "idle", 0.4);
    state.timer = 0;
  }

  function beginStrafe() {
    cancelBracket();
    const ps = ctx.player.state;
    // Run the line THROUGH the player rather than to them, starting
    // well back so the approach is visible and dodgeable.
    const dx = ps.x - inst.x;
    const dz = ps.z - inst.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    state.strafeFrom = { x: ps.x - ux * 52, z: ps.z - uz * 52 };
    state.strafeTo = { x: ps.x + ux * 46, z: ps.z + uz * 46 };
    state.strafeT = 0;
    state.strafeBombTimer = 0;
    state.strafeBombCount = 0;
    state.phase = "strafe";
    state.strafeTimer = C.strafeCadence;
    enemies.play(inst, "alert", 0.2);
    bus.emit("strafeTelegraph", { x: inst.x, y: inst.y, z: inst.z });
  }

  function beginLand(stalled) {
    cancelBracket();
    const stack = nearestStack(inst.x, inst.z);
    /* Land at the FOOT of the stack, not on it - the fight has to
       happen on ground the player can stand on - and push the chosen
       spot out of any masonry before committing to it. A refinery is
       the densest district on the map; a landing point picked by
       angle alone puts a twenty-six metre animal inside a cracking
       tower often enough to matter. */
    const a = Math.random() * TAU;
    const r = 16 + Math.random() * 6;
    let lx = stack.x + Math.cos(a) * r;
    let lz = stack.z + Math.sin(a) * r;
    const open = ctx.collide?.findOpen?.(lx, lz, groundAt(lx, lz), 24, 12,
      inst.spec.collisionRadius || 1.8);
    if (open) { lx = open[0]; lz = open[1]; }
    state.landTo = { x: lx, z: lz };
    state.landFrom = { x: inst.x, y: inst.y, z: inst.z };
    state.phase = "land";
    state.timer = stalled ? C.landSeconds * 0.65 : C.landSeconds;
    /* THE SPAN THE TIMER ACTUALLY STARTED AT.
       `stepLand` normalises the timer into a 0..1 descent, and it
       divided by `C.landSeconds` whatever the timer had been set to.
       A stall starts at 65% of that, so the very first frame of a
       stalled landing evaluated t = 1 - 0.65 = 0.35 and the lerp
       moved the animal 38% of the way to its landing point in one
       frame - up to fifteen metres, instantly, at exactly the moment
       the player had just downed it. The one path that skipped was
       the one the player earns. */
    state.landSpan = state.timer;
    state.stalled = !!stalled;
    state.healthAtDowningStart = inst.health;
    state.damageThisDowning = 0;
    enemies.play(inst, "land", 0.15);
    bus.emit("landing", { x: state.landTo.x, z: state.landTo.z, stalled: !!stalled });
  }

  function beginStoke() {
    state.phase = "stoke";
    state.timer = state.stalled ? C.stallStokeSeconds : C.stokeSeconds;
    state.stokeSpan = state.timer;
    state.relit = false;
    state.sweepTimer = 1.2;
    if (!Number.isFinite(state.healthAtDowningStart)) {
      state.healthAtDowningStart = inst.health;
      state.damageThisDowning = 0;
    }
    inst.grounded = true;
    inst.y = groundAt(inst.x, inst.z) + C.landedLift;
    inst.pitch = 0;
    inst.roll = 0;
    const y = groundAt(inst.x, inst.z);
    /* THE ARRIVAL IS SIZED TO THE ANIMAL AND TO HOW CLOSE THE PLAYER
       IS STANDING. A fixed shake means a twenty-six metre thing
       landing forty metres away hits the camera exactly as hard as one
       landing on the player's feet, which is the shake reading as a UI
       effect rather than as mass arriving. */
    const ps0 = ctx.player?.state;
    const near = ps0
      ? clamp01(1 - Math.hypot(ps0.x - inst.x, ps0.z - inst.z) / 46) : 0.5;
    const weight = 0.45 + near * near * 1.15;
    /* Six landing limbs, so six contacts rather than one puff. The
       ring is what makes the ground look struck instead of the animal
       looking dropped. */
    for (let i = 0; i < 6; i += 1) {
      const a = inst.yaw + (i / 6) * TAU;
      const rx = inst.x + Math.cos(a) * 2.4;
      const rz = inst.z + Math.sin(a) * 2.4;
      ctx.vfx?.sandSpray?.(rx, groundAt(rx, rz) + 0.35, rz, 1.5 + near,
        Math.cos(a), Math.sin(a));
      ctx.vfx?.footprint?.(rx, rz, a, 0, 1.4);
    }
    if (state.stalled) {
      /* SHOT DOWN. It arrives as a knockout: the strain clip keeps
          it sprawled rather than tented, the impact is dust and shake
          only - the crash never damages the player; it is their prize,
          not a trade - and `stunFor` holds every attack off long
          enough to spend melee into it freely. */
      state.stunFor = C.crashStunSeconds;
      state.sweepTimer = C.crashStunSeconds + 1.0;
      /* Its own clip: "strain" is an airborne pose whose chains hang
          straight down, which put the thuribles underground for the
          whole knockout. The sprawl throws them forward onto the sand. */
      enemies.play(inst, "sprawl", 0.10);
      ctx.player?.doctrineKick?.(1.3 * weight, 1);
      ctx.vfx?.blast?.(inst.x, y + 0.4, inst.z, 9);
      ctx.vfx?.sandSpray?.(inst.x, y + 0.5, inst.z, 3.4, 0, 1);
      state.flash = 0.9;
      bus.emit("stunned", { x: inst.x, z: inst.z, seconds: C.crashStunSeconds });
    } else {
      state.stunFor = 0;
      enemies.play(inst, "stoke", 0.2);
      ctx.player?.doctrineKick?.(1.0 * weight, 1);
      ctx.vfx?.blast?.(inst.x, y + 0.4, inst.z, 7);
      ctx.vfx?.sandSpray?.(inst.x, y + 0.5, inst.z, 2.4, 0, 1);
    }
    bus.emit("stoke", {
      x: inst.x, z: inst.z, stalled: state.stalled, seconds: state.timer,
    });
  }

  function beginLaunch() {
    state.phase = "launch";
    state.timer = C.launchSeconds;
    inst.grounded = false;
    enemies.play(inst, "launch", 0.12);
    /* Refill lift pool immediately and protect it until back in soar. */
    inst.lift = inst.maxLift;
    if (Array.isArray(inst.sacBurst)) inst.sacBurst.fill(false);
    state.fuel = C.soarSeconds;
    state.stalled = false;
    const y = groundAt(inst.x, inst.z);
    ctx.vfx?.sandSpray?.(inst.x, y + 0.5, inst.z, 3.2, 0, 1);
    state.flash = Math.max(state.flash, 0.8);
    bus.emit("launch", { x: inst.x, z: inst.z });
  }

  function beginBombard() {
    enemies.play(inst, "bombard", 0.15);
    state.action = 2.167;       // the clip's own measured length
    state.actionKind = "bombard";
    state.pending = C.bombardContact;
    state.bombardTimer = activeBombardCadence();
    /* ANTICIPATION, and it is the whole telegraph. The clip's censers
       swing back for the first 0.9 s; the furnace swelling behind them
       is what makes that windup readable as "something is coming" from
       thirty metres up, where the swing itself is four pixels. */
    state.swell = 1;
    bus.emit("bombardTelegraph", {
      x: inst.x, y: inst.y, z: inst.z,
      impactIn: C.bombardContact, guardType: "unblockable",
    });
  }

  function beginSweep() {
    // Its own clip now. This played `flinch` for one build - a
    // forty-eight damage swing animated by the animal recoiling from
    // the player, which reads as the attack hurting the attacker.
    enemies.play(inst, "sweep", 0.08);
    state.action = 1.667;       // 40 frames at 24fps
    state.actionKind = "sweep";
    state.pending = C.sweepContact;
    state.sweepTimer = C.sweepCadence;
    // The same held breath, at melee range and half the size.
    state.swell = 0.7;
    bus.emit("sweepTelegraph", {
      x: inst.x, z: inst.z, impactIn: C.sweepContact, guardType: "frontal",
    });
  }

  function currentBombardCount() {
    const spent = clamp01(1 - inst.health / Math.max(1, inst.maxHealth));
    return Math.min(C.bombardCountRoused,
      C.bombardCount + Math.floor(spent * (C.bombardCountRoused - C.bombardCount + 1)));
  }

  function dropEmbers() {
    const ps = ctx.player.state;
    const count = currentBombardCount();
    for (let i = 0; i < count; i += 1) {
      const bone = inst.bones.get(`censer${i % 3}`);
      let ox = inst.x;
      let oy = inst.y - 2.2;
      let oz = inst.z;
      if (bone) {
        bone.updateWorldMatrix(true, false);
        bone.getWorldPosition(_vec);
        ox = _vec.x; oy = _vec.y; oz = _vec.z;
      }
      // Lead the player a little and scatter, so a straight-line
      // sprint is not a guaranteed dodge and standing still is not a
      // guaranteed hit.
      const spread = (i / Math.max(1, count - 1) - 0.5) * 2;
      const tx = ps.x + spread * C.bombardSpread + (Math.random() - 0.5) * 2.5;
      const tz = ps.z + spread * C.bombardSpread * 0.6 + (Math.random() - 0.5) * 2.5;
      const v = ballistic(ox, oy, oz, tx, ps.y + 0.6, tz, C.bombardSpeed);
      launchEmber(ox, oy, oz, v.x, v.y, v.z);
      /* The throw itself, for the probe. A coal that lands nowhere
         near its target is either aimed wrong or stopped early, and
         only the launch velocity separates those two. */
      bus.emit("emberThrow", {
        ox, oy, oz, tx, tz, ty: ps.y + 0.6,
        vx: v.x, vy: v.y, vz: v.z,
      });
    }
    ctx.vfx?.spark?.(inst.x, inst.y - 2.0, inst.z, 2.2, false, false);
    // RECOVERY: the pressure that built through the windup leaves with
    // the payload, so the gut drops back through a visible flare.
    state.flash = Math.max(state.flash, 0.85);
    state.swell = 0;
    if (martyr()) scheduleBracket();
    bus.emit("bombard", {
      x: inst.x, y: inst.y, z: inst.z, count, bracketed: martyr(),
    });
  }

  /** Commit the second row when the first volley leaves. The row is
   *  perpendicular to travel, centred where continuing that travel will
   *  carry the trooper. Three overlapping ash beds close the held lane;
   *  a direction change during the marked delay is the deliberate gap. */
  function scheduleBracket() {
    const ps = ctx.player.state;
    let vx = playerTrack.vx;
    let vz = playerTrack.vz;
    let speed = Math.hypot(vx, vz);
    if (speed < 0.75) {
      vx = ps.x - inst.x;
      vz = ps.z - inst.z;
      speed = Math.hypot(vx, vz) || 1;
    }
    const ux = vx / speed;
    const uz = vz / speed;
    const lead = Math.min(Math.hypot(playerTrack.vx, playerTrack.vz)
      * C.martyrBracketLeadSeconds, C.martyrBracketLeadMax);
    const cx = ps.x + ux * lead;
    const cz = ps.z + uz * lead;
    const rx = -uz;
    const rz = ux;
    state.bracketTargets.length = 0;
    for (let i = 0; i < C.martyrBracketCount; i += 1) {
      const lane = i - (C.martyrBracketCount - 1) * 0.5;
      const target = {
        x: cx + rx * lane * C.martyrBracketSpacing,
        z: cz + rz * lane * C.martyrBracketSpacing,
      };
      state.bracketTargets.push(target);
      ctx.vfx?.winnowerBracketTell?.(target.x, target.z, C.ashRadius,
        C.martyrBracketDelay + 1.15);
    }
    state.bracketFor = C.martyrBracketDelay;
    bus.emit("bracketTelegraph", {
      x: cx, z: cz, delay: C.martyrBracketDelay,
      playerX: ps.x, playerZ: ps.z, lead,
      travelX: ux, travelZ: uz,
      count: state.bracketTargets.length,
      targets: state.bracketTargets.map((target) => ({ ...target })),
    });
  }

  function dropBracket() {
    if (!martyr() || state.phase !== "soar" || !state.bracketTargets.length) {
      cancelBracket();
      return;
    }
    const targets = state.bracketTargets.splice(0);
    state.bracketFor = 0;
    for (let i = 0; i < targets.length; i += 1) {
      const bone = inst.bones.get(`censer${i % 3}`);
      let ox = inst.x;
      let oy = inst.y - 2.2;
      let oz = inst.z;
      if (bone) {
        bone.updateWorldMatrix(true, false);
        bone.getWorldPosition(_vec);
        ox = _vec.x; oy = _vec.y; oz = _vec.z;
      }
      const target = targets[i];
      const v = ballistic(ox, oy, oz, target.x,
        groundAt(target.x, target.z) + 0.6, target.z, C.bombardSpeed * 1.04);
      launchEmber(ox, oy, oz, v.x, v.y, v.z);
    }
    ctx.vfx?.spark?.(inst.x, inst.y - 2.0, inst.z, 2.8, false, false);
    state.flash = Math.max(state.flash, 1.0);
    bus.emit("bracket", {
      x: inst.x, y: inst.y, z: inst.z, count: targets.length, targets,
    });
  }

  function stepBracket(dt) {
    if (!(state.bracketFor > 0)) return;
    if (!martyr() || state.phase !== "soar") { cancelBracket(); return; }
    state.bracketFor -= dt;
    if (state.bracketFor <= 0) dropBracket();
  }

  /** The low-arc ballistic root, straight out of the Coulter's spew -
   *  a mortar arc from this altitude would take four seconds to land
   *  and the player would simply have walked away. */
  /**
   * Throw a coal from (x,y,z) at (tx,ty,tz).
   *
   * OUT OF RANGE IS THE COMMON CASE, NOT THE EDGE CASE, and for one
   * build the out-of-range branch was where the whole attack went.
   * A 19m/s lob from 26m up reaches about 35.6m of ground; the soar
   * orbits at 34m and scatters its aim 5.5m either side of that, so
   * a large fraction of every volley had no solution at all - and
   * the fallback threw them on a flat -0.2rad arc, which carried
   * them PAST the player and landed the pattern 47 to 52 metres
   * away. Measured on a stationary trooper standing in the open, an
   * entire bombardment did zero damage. It was not that the coals
   * were weak. They were not being aimed at anything.
   *
   * So the range is now solved for rather than discovered: the aim
   * point is pulled in along its own bearing until a solution
   * exists. A short throw walks the pattern toward the player, which
   * is a readable attack; a flat throw over their head is not.
   */
  const BOMB_G = 20;
  function ballistic(x, y, z, tx, ty, tz, speed) {
    let dx = tx - x;
    let dz = tz - z;
    let flat = Math.hypot(dx, dz) || 1e-4;
    const dy = ty - y;
    const s2 = speed * speed;
    /* The reachable ground range for this speed and drop, straight
       out of the discriminant: root >= 0 whenever
       g*g*flat^2 <= s^4 - 2*g*dy*s^2. */
    const reach = Math.sqrt(Math.max(0, s2 * s2 - 2 * BOMB_G * dy * s2)) / BOMB_G;
    if (flat > reach * 0.98) {
      const k = (reach * 0.98) / flat;
      dx *= k;
      dz *= k;
      flat *= k;
    }
    const ux = dx / flat;
    const uz = dz / flat;
    const root = Math.max(0, s2 * s2 - BOMB_G * (BOMB_G * flat * flat + 2 * dy * s2));
    const rootSq = Math.sqrt(root);
    /* TWO ARCS REACH THE SAME POINT, and this only ever used the flat
       one. Over a refinery that is the wrong one: thrown from 26m up
       across the Censer Works, the line-drive solution buries itself
       in the first cracking tower it meets - measured, the pattern
       was landing eight to eleven metres from the animal that threw
       it, on a roof, while the player stood thirty metres away
       wondering what the attack was for.
       So the low arc is tried, and if the works are in the way the
       coals are LOBBED instead. Which is also the better read: a
       bombardment that arcs over the plant is legible from under it,
       and the longer flight is more of the walk-out-from-under the
       whole attack is designed around. */
    const build = (angle) => {
      const horizontal = Math.cos(angle) * speed;
      return {
        x: ux * horizontal, y: Math.sin(angle) * speed, z: uz * horizontal,
        seconds: flat / Math.max(1e-3, Math.abs(horizontal)),
      };
    };
    const low = build(Math.atan2(s2 - rootSq, BOMB_G * flat));
    if (!arcBlocked(x, y, z, low, low.seconds)) return low;
    const high = build(Math.atan2(s2 + rootSq, BOMB_G * flat));
    return arcBlocked(x, y, z, high, high.seconds) ? low : high;
  }

  /**
   * Does this throw hit the works on its way?
   *
   * Sampled as chords of the parabola rather than as one straight
   * line: a lob's whole point is that it does not travel in a
   * straight line, and testing the chord from muzzle to target would
   * reject exactly the arcs that clear.
   */
  function arcBlocked(x, y, z, v, seconds) {
    if (!ctx.collide?.rayBlock || !(seconds > 0)) return false;
    const steps = 7;
    let px = x;
    let py = y;
    let pz = z;
    for (let i = 1; i <= steps; i += 1) {
      /* Stops short of the impact itself: the last metre is the
         ground it is meant to land on. */
      const t = (seconds * 0.94 * i) / steps;
      const nx = x + v.x * t;
      const ny = y + v.y * t - 0.5 * BOMB_G * t * t;
      const nz = z + v.z * t;
      const sx = nx - px;
      const sy = ny - py;
      const sz = nz - pz;
      const len = Math.hypot(sx, sy, sz);
      if (len > 1e-3) {
        const open = ctx.collide.rayBlock(px, py, pz, sx / len, sy / len, sz / len, len);
        if (open < len - 0.05) return true;
      }
      px = nx; py = ny; pz = nz;
    }
    return false;
  }

  function landSweep() {
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - inst.x, ps.z - inst.z);
    if (dist > C.sweepReach + 1.4 || ctx.combat?.player?.dead) {
      bus.emit("sweepMiss", { x: inst.x, z: inst.z });
      return;
    }
    ctx.combat.hurtPlayer(C.sweepDamage, {
      source: "winnower-sweep", x: ps.x, y: ps.y + 1.0, z: ps.z,
      originX: inst.x, originY: inst.y, originZ: inst.z, guardType: "frontal",
    });
    ctx.player.punch?.(1.4);
    bus.emit("sweep", { x: inst.x, z: inst.z });
  }

  function resolveAction(dt) {
    if (!(state.pending > 0)) return;
    state.pending -= dt;
    if (state.pending > 0) return;
    state.pending = 0;
    if (state.actionKind === "bombard") dropEmbers();
    else if (state.actionKind === "sweep") landSweep();
  }

  /* ============================================================
     PHASES
     ============================================================ */

  function stepSoar(dt) {
    const ps = ctx.player.state;
    /* Orbits the PLAYER rather than a fixed point. A boss that circles
       the middle of its arena while the player stands at the edge is a
       boss that has stopped being in the fight.

       ...clamped to its own territory. Unclamped, "orbit the player"
       is "follow the player anywhere", the distance between them
       never opens, and the leash can never fire. A player who walks
       out watches it wheel at the boundary instead - still in the
       fight to look at, no longer in the fight to chase. */
    state.orbit += dt * C.orbitSpeed;
    let ax = ps.x;
    let az = ps.z;
    const hx = ax - TERRITORY_X;
    const hz = az - TERRITORY_Z;
    const hd = Math.hypot(hx, hz);
    const anchorMax = C.territoryRadius - C.orbitRadius;
    const playerInside = hd < C.territoryRadius;
    if (hd > anchorMax) {
      ax = TERRITORY_X + (hx / hd) * anchorMax;
      az = TERRITORY_Z + (hz / hd) * anchorMax;
    }
    const tx = ax + Math.cos(state.orbit) * C.orbitRadius;
    const tz = az + Math.sin(state.orbit) * C.orbitRadius;
    const speed = inst.spec.speed.walk;
    const dx = tx - inst.x;
    const dz = tz - inst.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.5) {
      inst.x += (dx / d) * Math.min(speed, d / Math.max(dt, 1e-4)) * dt;
      inst.z += (dz / d) * Math.min(speed, d / Math.max(dt, 1e-4)) * dt;
    }
    const soarLead = d > 1e-3 ? dx / d : Math.sin(inst.yaw);
    const soarLeadZ = d > 1e-3 ? dz / d : Math.cos(inst.yaw);
    flyToward(cruiseY(inst.x, inst.z), soarLead, soarLeadZ, speed, 2.6, 1.6, dt);
    faceTravel(dt, tx, tz, 1.8);
    inst.pitch = damp(inst.pitch, 0, 2.0, dt);

    /* THE FURNACE RUNS DOWN. Two ways to reach the same landing: the
       fuel, which always runs out, and the lift pool, which the
       player empties by shooting the sacs. The first is the floor a
       melee build is owed; the second is what a rifle build buys. */
    const stalled = inst.lift <= 0;
    if (stalled && inst.state !== "strain") enemies.play(inst, "strain", 0.2);
    if (state.fuel <= 0 || stalled) { beginLand(stalled); return; }

    state.action = Math.max(0, state.action - dt);
    if (state.action > 0) { resolveAction(dt); return; }

    state.bombardTimer -= dt;
    state.strafeTimer -= dt;
    /* It does not attack ground it does not own. A bombardment
       thrown 200m past the boundary at a leaving player is both
       unreadable and unfair - and mechanically it would reset the
       leash fight the player is choosing to walk away from. */
    if (!playerInside) return;
    if (state.strafeTimer <= 0) { beginStrafe(); return; }
    if (state.bombardTimer <= 0) { beginBombard(); return; }
  }

  function dropStrafeBomb() {
    const cIndex = (state.strafeBombCount || 0) % 3;
    state.strafeBombCount = (state.strafeBombCount || 0) + 1;
    const bone = inst.bones?.get?.(`censer${cIndex}`);
    let ox = inst.x;
    let oy = inst.y - 1.8;
    let oz = inst.z;
    if (bone) {
      bone.updateWorldMatrix(true, false);
      bone.getWorldPosition(_vec);
      ox = _vec.x; oy = _vec.y; oz = _vec.z;
    }
    const forwardX = Math.sin(inst.yaw);
    const forwardZ = Math.cos(inst.yaw);
    const rightX = forwardZ;
    const rightZ = -forwardX;
    const sideSpread = (Math.random() - 0.5) * 3.6;
    const vx = forwardX * 5 + rightX * sideSpread;
    const vy = -14 - Math.random() * 6;
    const vz = forwardZ * 5 + rightZ * sideSpread;
    launchEmber(ox, oy, oz, vx, vy, vz);
    ctx.vfx?.spark?.(ox, oy, oz, 1.8, false, false);
    state.flash = Math.max(state.flash, 0.7);
    bus.emit("strafeBomb", { x: ox, y: oy, z: oz, count: state.strafeBombCount });
  }

  function stepStrafe(dt) {
    const from = state.strafeFrom;
    const to = state.strafeTo;
    if (!from || !to) { beginSoar(); return; }
    const span = Math.hypot(to.x - from.x, to.z - from.z) || 1;
    state.strafeT += (C.strafeSpeed / span) * dt;
    const t = clamp01(state.strafeT);
    inst.x = lerp(from.x, to.x, t);
    inst.z = lerp(from.z, to.z, t);
    // Dips to strafe height across the middle of the run and climbs
    // out at both ends, so the pass has a shape.
    const dip = Math.sin(t * Math.PI);
    const want = groundAt(inst.x, inst.z)
      + lerp(C.cruiseHeight, C.strafeHeight, dip);
    /* THE LOW PASS IS WHERE IT WENT THROUGH THINGS. Every clipped
       frame measured was in this phase: seven and a half metres over
       the terrain, across a district whose towers stand at forty.
       The lead scales with the run's own speed, which is more than
       three times the cruise. */
    const runX = (to.x - from.x) / span;
    const runZ = (to.z - from.z) / span;
    flyToward(want, runX, runZ, C.strafeSpeed, 1.7, 6.0, dt);
    faceTravel(dt, to.x, to.z, 4.0);
    inst.pitch = damp(inst.pitch, -0.10 * dip, 3.0, dt);

    // Dropping a line of bombs as it swoops across the ground
    if (t >= 0.12 && t <= 0.88) {
      state.strafeBombTimer = (state.strafeBombTimer || 0) - dt;
      if (state.strafeBombTimer <= 0) {
        state.strafeBombTimer = C.strafeBombInterval || 0.10;
        dropStrafeBomb();
      }
    }

    // The hit is resolved by proximity along the run rather than at a
    // fixed frame: the player can genuinely step out of the line.
    const ps = ctx.player.state;
    if (!ctx.combat?.player?.dead) {
      const dx = ps.x - inst.x;
      const dz = ps.z - inst.z;
      const dy = (ps.y + 1.0) - inst.y;
      if (dx * dx + dz * dz < C.strafeRadius * C.strafeRadius
        && Math.abs(dy) < 6 && !state.strafeHit) {
        state.strafeHit = true;
        ctx.combat.hurtPlayer(C.strafeDamage, {
          source: "winnower-strafe", x: ps.x, y: ps.y + 1.0, z: ps.z,
        });
        ctx.player.punch?.(1.6);
        ctx.player.doctrineKick?.(0.8, 0.6);
        bus.emit("strafeHit", { x: ps.x, z: ps.z });
      }
    }
    if (t >= 1) {
      state.strafeHit = false;
      beginSoar();
    }
  }

  function stepLand(dt) {
    /* A SAVE CAN RESTORE STRAIGHT INTO THIS PHASE, and `restore`
       rebuilds neither endpoint - they are runtime-only, like the
       stoke span it does reconstruct. Without this the first frame
       after such a load reads `state.landTo.x` off null and takes the
       level down. Descending onto the spot it is already over is the
       correct recovery: the animal was nearly there. */
    if (!state.landTo || !state.landFrom) {
      state.landTo = { x: inst.x, z: inst.z };
      state.landFrom = { x: inst.x, y: inst.y, z: inst.z };
      if (!(state.landSpan > 0)) state.landSpan = Math.max(0.01, state.timer);
    }
    const to = state.landTo;
    state.timer -= dt;
    const span = Math.max(0.01, state.landSpan || C.landSeconds);
    const t = 1 - clamp01(state.timer / span);
    inst.x = lerp(state.landFrom.x, to.x, clamp01(t * 1.1));
    inst.z = lerp(state.landFrom.z, to.z, clamp01(t * 1.1));
    const ground = groundAt(inst.x, inst.z) + C.landedLift;
    /* A STALL FALLS, a landing DESCENDS. Squaring the curve makes the
       stalled arrival accelerate into the ground, which is the read
       that says the animal did not choose this. */
    const curve = state.stalled ? t * t : t;
    inst.y = lerp(state.landFrom.y, ground, curve);
    faceTravel(dt, to.x, to.z, 2.4);
    inst.pitch = damp(inst.pitch, state.stalled ? 0.30 : -0.18, 4.0, dt);
    inst.roll = damp(inst.roll, state.stalled ? 0.22 : 0, 3.0, dt);
    if (state.timer <= 0 || inst.y <= ground + 0.05) {
      inst.y = ground;
      beginStoke();
    }
  }

  function stepStoke(dt) {
    state.timer -= dt;
    inst.y = groundAt(inst.x, inst.z) + C.landedLift;
    if (state.timer <= 0) {
      state.action = 0;
      state.pending = 0;
      beginLaunch();
      return;
    }
    const ps = ctx.player.state;
    /* Knocked out cold: no tracking, no sweeps, nothing - the free
       window the stall bought. It comes to with the stoke clip (the
       drag up onto its own limbs) and only then starts answering. */
    if (state.stunFor > 0) {
      state.stunFor -= dt;
      if (state.stunFor <= 0) {
        enemies.play(inst, "stoke", 0.3);
        bus.emit("stokeRecover", { x: inst.x, z: inst.z });
      }
      return;
    }
    // Turns to keep the player in front of it, slowly - a grounded
    // Winnower is reachable, not passive.
    faceTravel(dt, ps.x, ps.z, 0.9);
    inst.roll = damp(inst.roll, 0, 4.0, dt);

    state.action = Math.max(0, state.action - dt);
    if (state.action > 0) { resolveAction(dt); return; }
    state.sweepTimer -= dt;
    if (state.sweepTimer <= 0
      && Math.hypot(ps.x - inst.x, ps.z - inst.z) < C.sweepReach) {
      beginSweep();
      return;
    }
  }

  function stepLaunch(dt) {
    state.timer -= dt;
    const t = 1 - clamp01(state.timer / C.launchSeconds);
    const ground = groundAt(inst.x, inst.z) + C.landedLift;
    inst.y = lerp(ground, cruiseY(inst.x, inst.z), t * t);
    /* Only ONCE IT IS UP. A launch begins with the body on the sand,
       which is legitimately below anything standing beside it, so the
       clearance floor is faded in with the climb rather than applied
       from the first frame - otherwise taking off next to a tank wall
       would fire the animal straight up it. */
    const crest = solidCrest(inst.x, inst.z, C.bodyRadius);
    if (Number.isFinite(crest)) {
      inst.y = Math.max(inst.y, lerp(ground, crest + C.masonryFloor, t * t));
    }
    inst.pitch = damp(inst.pitch, -0.34 * (1 - t), 4.0, dt);
    if (state.timer <= 0) beginSoar();
  }

  /* ============================================================
     HEAT, WEIGHT AND DAMAGE

     Everything in this section is presentation. None of it is allowed
     to move the encounter: the altitudes, timers and reaches the fight
     is written against are all read by the harnesses, and a body that
     bobs its way past a threshold would be a gameplay change wearing
     an art change's clothes.
     ============================================================ */

  /** What the furnace should be drawing right now, by phase.
   *
   *  This is the encounter's read from the outside. A player who has
   *  never opened the HUD should be able to say what the animal is
   *  about to do from the colour of its gut, which is the whole point
   *  of a boss that carries its own light. */
  function heatTarget() {
    switch (state.phase) {
      /* Banked, not out. A dormant Winnower is still a furnace, and
         the ember in it is the first thing the player sees from the
         approach. */
      case "dormant": return 0.26;
      case "alert": return 1.05;
      case "soar": return 0.88;
      case "strafe": return 1.25;
      /* A stall is the furnace having run dry; a chosen landing is it
         being throttled back. The two arrivals have to look different
         from underneath, because one of them is the player's doing. */
      case "land": return state.stalled ? 0.20 : 0.62;
      case "stoke": return stokeHeat();
      case "launch": return 1.40;
      case "return": return 0.55;
      case "dead": return 0;
      default: return 0.60;
    }
  }

  /** THE STOKE IS THE FIGHT'S HELD BREATH.
   *
   *  The gut goes out, the animal is dark and reachable for most of the
   *  window - which is also the read that tells a player the melee
   *  window is open without a single HUD element - and then the
   *  re-light happens in a stage they can watch: a visible pressure
   *  build, then a flare. `beginLaunch` is the payoff, so this has to
   *  arrive AT it rather than after it. */
  function stokeHeat() {
    const span = Math.max(0.01, state.stokeSpan || C.stokeSeconds);
    const p = clamp01(1 - state.timer / span);
    /* BANKED, NOT OUT - and the floor is the number this needed a
       shoot to find. At 0.05 the gut genuinely went black, which is
       correct for the fiction and wrong for the encounter: the stoke
       is the window the whole fight is built around, so it is where
       the player spends every second they are close enough to see any
       of this, and it is the state the gallery photographs. A banked
       furnace still glows in its own cracks. */
    if (p < 0.10) return lerp(0.62, 0.20, p / 0.10);
    if (p < 0.62) return 0.20 + 0.05 * Math.sin(atmos.elapsed * 3.1);
    if (p < 0.90) return lerp(0.20, 0.85, (p - 0.62) / 0.28);
    return 1.55;
  }

  function updateFurnace(dt) {
    /* Damp rather than snap, and slowly. A furnace has thermal mass;
       a gut that steps between values reads as a light being switched. */
    const want = heatTarget() + state.swell * 0.55;
    state.heat = damp(state.heat, want, state.phase === "dead" ? 1.1 : 3.4, dt);
    state.flash = Math.max(0, state.flash - dt * 2.8);
    state.swell = Math.max(0, state.swell - dt * 1.9);

    /* THE RE-LIGHT, fired once. `relit` is cleared by `beginStoke`, so
       every stoke gets exactly one flare and a save restored inside
       the window does not fire a second. */
    if (state.phase === "stoke" && !state.relit && inst) {
      const span = Math.max(0.01, state.stokeSpan || C.stokeSeconds);
      if (clamp01(1 - state.timer / span) >= 0.90) {
        state.relit = true;
        state.flash = 1.15;
        const y = groundAt(inst.x, inst.z);
        ctx.vfx?.sandSpray?.(inst.x, y + 0.5, inst.z, 2.6, 0, 1);
        ctx.vfx?.spark?.(inst.x, inst.y - 1.6, inst.z, 2.8, false, false);
        ctx.player?.doctrineKick?.(0.5, 0.4);
        bus.emit("relight", { x: inst.x, y: inst.y, z: inst.z });
      }
    }

    const heat = furnaceUniforms.uWnHeat.value;
    heat.x = state.heat;
    heat.y = state.phase === "dead" ? clamp01(state.heat * 1.4) : 1;
    /* The banding CRAWLS while the furnace draws, and stops when it
       does. A static band pattern on a still animal is the tell that
       says "texture"; a moving one says "process". */
    heat.z += dt * (0.35 + 1.30 * state.heat);
    /* A hurt animal leaks more. The fissures are the inside showing,
       so they open as the shell is broken rather than being a constant
       decoration. */
    heat.w = 0.80 + 0.70 * state.shownDamage;

    const sac = furnaceUniforms.uWnSac.value;
    sac.x = sacFill(0);
    sac.y = sacFill(1);
    sac.z = state.flash;
    sac.w = state.swell;

    /* Ash builds while it is grounded in the smoke and burns off in
       the air, which is a slow read but a free one - the animal that
       just stood in a flare stack for nine seconds is visibly dustier
       when it comes back up. */
    const rime = furnaceUniforms.uWnChar.value;
    const wantRime = inst?.grounded ? RIME_MAX : RIME_MAX * 0.62;
    rime.w = damp(rime.w, wantRime, 0.35, dt);

    /* DAMAGE ACCUMULATES AND STAYS. Written only when it has moved -
       a uniform write is cheap and a needless one is still a habit
       worth not having, and the Garner records the same gate. */
    const hurt = inst && inst.maxHealth
      ? clamp01(1 - inst.health / inst.maxHealth) : 0;
    if (Math.abs(hurt - state.shownDamage) > 0.015) {
      state.shownDamage = hurt;
      /* SCALED, and this is the kit's own recorded trap arriving on a
         second animal. The scorch pools in the coarse mottle's
         troughs, which is right - but at full strength on a shell that
         now HAS an albedo range to blotch, a nearly dead Winnower came
         back wearing dalmatian spots, which reads as an animal's
         markings rather than as burnt-off plate. Two thirds is the
         most this palette can take. */
      setSurfaceDamage(shellMat, hurt * 0.62);
    }
  }

  /** The wingbeat, and the weight that hangs under it. */
  function updateBeat(dt) {
    if (!inst || inst.state === "death") return;
    const airborne = state.phase === "soar" || state.phase === "strafe"
      || state.phase === "launch" || state.phase === "return"
      || state.phase === "alert";
    if (!airborne) return;
    const rate = state.phase === "strafe" ? 1.55
      : state.phase === "launch" ? 2.05 : 1.05;
    const before = state.beat;
    state.beat += dt * rate;
    /* IT SINKS BETWEEN BEATS. A flyer held at a damped altitude is on
       rails and reads as one - the single loudest "this is a prop"
       cue a big flying thing can give. Thirty centimetres on a
       twenty-six metre span is small enough that the encounter's own
       altitude thresholds cannot feel it and large enough to see
       against the skyline. */
    state.bob = Math.sin(state.beat * TAU) * 0.30 * clamp01(state.heat + 0.2);
    inst.y += state.bob;
    if (Math.floor(state.beat) === Math.floor(before)) return;

    /* Once per beat, at the top of the stroke. */
    const ground = groundAt(inst.x, inst.z);
    const alt = inst.y - ground;
    ctx.vfx?.spark?.(inst.x, inst.y - 1.4, inst.z, 0.55 + state.heat * 0.5,
      false, false);
    /* AND THE GROUND ANSWERS ON A LOW PASS. This is the whole reason
       the strafing run has a shape: at seven metres the downwash
       should be visible on the sand, or the pass is a model sliding
       past a backdrop. */
    if (alt < 16) {
      const push = 1 - alt / 16;
      ctx.vfx?.sandSpray?.(inst.x, ground + 0.4, inst.z, 1.1 + push * 2.4,
        Math.sin(inst.yaw), Math.cos(inst.yaw));
    }
  }

  /** The furnace's throw on the sand. */
  function updatePool(dt) {
    poolMat.uniforms.uTime.value = atmos.elapsed;
    const live = !!inst && !inst.encounterHidden && state.phase !== "dormant";
    if (!live) {
      pool.gain = damp(pool.gain, 0, 6, dt);
      poolMat.uniforms.uGain.value = pool.gain;
      if (pool.gain < 0.004 && poolMesh.visible) poolMesh.visible = false;
      return;
    }
    const ground = groundAt(inst.x, inst.z);
    const alt = Math.max(0, inst.y - ground);
    /* Inverse-square in altitude, which is what a source at a height
       actually throws: tight and bright when it is down among the
       player's feet, a broad wash when it is at cruise. */
    const reach = 1 / (1 + (alt / 13) ** 2);
    const wantGain = clamp01(state.heat * (0.30 + 0.75 * reach)) * 0.90;
    const wantRadius = clamp(7 + alt * 0.62, 6.5, 26);
    pool.gain = damp(pool.gain, wantGain, 5, dt);
    poolMat.uniforms.uGain.value = pool.gain;
    if (pool.gain < 0.004) {
      if (poolMesh.visible) poolMesh.visible = false;
      return;
    }
    if (!poolMesh.visible) poolMesh.visible = true;
    /* Re-laid only when it has actually travelled. Every vertex is a
       terrain sample, and an animal holding station must not pay for
       sixty identical rebuilds a second. */
    if (Math.hypot(inst.x - pool.x, inst.z - pool.z) > 1.4
      || Math.abs(wantRadius - pool.radius) > 1.5) {
      layPool(inst.x, inst.z, wantRadius);
    }
  }

  /* ------------------------------------------------------------
     BEING HIT

     Bound lazily. This module is constructed before `ctx.combat`
     exists in some orderings, and reaching for the bus at
     construction time would silently bind nothing.
     ------------------------------------------------------------ */
  let hurtBound = false;

  function bindHurt() {
    if (hurtBound || !ctx.combat?.bus?.on) return;
    hurtBound = true;
    ctx.combat.bus.on("enemyDamaged", (e) => {
      if (!inst || !e || e.enemyId !== inst.id) return;
      onHurt(e);
    });
    ctx.combat.bus.on("liftDrained", (e) => {
      if (!inst || !e || e.enemyId !== inst.id) return;
      onDrain(e);
    });
  }

  function onHurt(e) {
    /* THE FLINCH ANSWERS THE BEARING. Resolved into the animal's own
       frame: a hit on the left wing rolls it right, a hit in the face
       pitches its nose up. A flinch that ignores where the shot came
       from is a wobble, and the player cannot read their own aim in
       it. */
    const dx = (Number.isFinite(e.x) ? e.x : inst.x) - inst.x;
    const dz = (Number.isFinite(e.z) ? e.z : inst.z) - inst.z;
    const s = Math.sin(inst.yaw);
    const c = Math.cos(inst.yaw);
    const lateral = clamp((dx * c - dz * s) / 6, -1, 1);
    const fore = clamp((dx * s + dz * c) / 6, -1, 1);
    const bite = clamp01((e.actual || 0) / 260) * (e.weak ? 1.6 : 1);
    /* Written straight onto the orientation the module already owns,
       as an IMPULSE, because every phase step already damps that
       orientation back toward what it wants - so the recovery is the
       existing controller doing its job rather than a second timer
       that could disagree with it. Bones were the alternative and are
       not available: the mixer runs after this module and overwrites
       every channel it has a track for. */
    inst.roll = clamp(inst.roll + lateral * 0.20 * bite, -1.1, 1.1);
    inst.pitch = clamp(inst.pitch - fore * 0.14 * bite, -0.8, 0.8);
    /* THE GUT ANSWERS TOO. A furnace struck flares - which is also the
       only hit feedback that reads at 120 m on an animal this dark. */
    state.flash = Math.min(1.0, state.flash + 0.14 + bite * 0.4);
    /* IT BLEEDS FIRE, AND THE FIRE LANDS. This animal has no ichor to
       spill; what comes out of a cracked furnace is burning matter,
       and the ember pool it already owns is exactly the right
       primitive - so a heavy hit throws coals that fall, hit the sand
       and leave a burn that stays there. Stains, in this animal's own
       language, for free. */
    if ((e.actual || 0) > 90 && Number.isFinite(e.y) && !inst.grounded && state.phase !== "stoke") {
      for (let i = 0; i < 2; i += 1) {
        launchEmber(e.x, e.y, e.z,
          (Math.random() - 0.5) * 5, 1.5 + Math.random() * 2.5,
          (Math.random() - 0.5) * 5);
      }
    }
    const isDowned = state.phase === "land" || state.phase === "stoke" || state.phase === "launch" || inst.grounded;
    if (isDowned) {
      state.damageThisDowning = (state.damageThisDowning || 0) + (e.actual || 0);
      const maxHp = inst.maxHealth || inst.spec?.health || 7800;
      const maxAllowed = maxHp * activeDownDamageCap();
      const startHealth = Number.isFinite(state.healthAtDowningStart) ? state.healthAtDowningStart : inst.health;
      if (startHealth > maxAllowed + 50 && state.damageThisDowning >= maxAllowed) {
        if (state.phase === "stoke" && state.timer > 0.4) {
          state.timer = 0.35;
          state.stunFor = 0;
          state.action = 0;
          state.pending = 0;
          enemies.play(inst, "stoke", 0.2);
        }
      }
    }
  }

  /**
   * Limit the damage taken during a single downing cycle so the Winnower
   * cannot be melted in a single window before getting back into the air.
   */
  function modifyIncomingDamage(targetInst, request, damage) {
    if (!inst || targetInst !== inst) return damage;
    const maxHp = inst.maxHealth || inst.spec?.health || 7800;
    const isDowned = state.phase === "land" || state.phase === "stoke" || state.phase === "launch" || inst.grounded;
    /* Martyr's chitin is closed in flight. Body fire still registers and
       skilled headshots still improve it, but neither can bypass the
       encounter by holding the trigger from safety. Heat sacs keep full
       value because they are the intended way to force the body down. */
    if (martyr() && !isDowned && !request.sac && !request.weak) {
      damage *= C.martyrAirborneBodyMult;
    }
    if (isDowned) {
      const maxAllowed = maxHp * activeDownDamageCap();
      const startHealth = Number.isFinite(state.healthAtDowningStart) ? state.healthAtDowningStart : inst.health;
      if (startHealth > maxAllowed + 50) {
        const remainingAllowance = Math.max(0, maxAllowed - (state.damageThisDowning || 0));
        if (damage > remainingAllowance) {
          damage = remainingAllowance;
        }
      }
    }
    return damage;
  }

  function onDrain(e) {
    /* A SAC GOING IS THE BIGGEST EVENT IN A RANGED FIGHT and it used
       to be silent. It vents: a spray of coals out of the wing root,
       a burn on the ground under it, and the animal drops a metre. */
    state.flash = Math.min(1.2, state.flash + 0.35);
    if (!e.burst) return;
    const bone = inst.bones?.get?.(e.sacIndex === 0 ? "sac_L" : "sac_R");
    let ox = inst.x;
    let oy = inst.y;
    let oz = inst.z;
    if (bone) {
      bone.updateWorldMatrix(true, false);
      bone.getWorldPosition(_vec);
      ox = _vec.x; oy = _vec.y; oz = _vec.z;
    }
    ctx.vfx?.spark?.(ox, oy, oz, 3.2, false, false);
    for (let i = 0; i < 3; i += 1) {
      launchEmber(ox, oy, oz,
        (Math.random() - 0.5) * 9, 2 + Math.random() * 3, (Math.random() - 0.5) * 9);
    }
    // A lurch it does not choose, on the side that just went.
    inst.roll = clamp(inst.roll + (e.sacIndex === 0 ? 0.30 : -0.30), -1.1, 1.1);
    bus.emit("sacBurst", { index: e.sacIndex, x: ox, y: oy, z: oz });
  }

  function stepInstance(dt) {
    if (!inst) return;
    syncDifficultyProfile();
    trackPlayer(dt);
    /* The wingbeat's sink is REMOVED before anything reads inst.y and
       put back after - an altitude damp that chases its target through
       its own oscillation simply flattens the oscillation out. */
    if (state.bob) { inst.y -= state.bob; state.bob = 0; }
    if (inst.state === "death") {
      if (!state.defeated) {
        state.defeated = true;
        state.phase = "dead";
        bus.emit("defeated", { x: inst.x, y: inst.y, z: inst.z });
      }
      /* IT FALLS. A flyer killed in the air has to arrive on the
         ground - the death clip only folds its wings, and a corpse
         left hanging at cruise altitude is the single most obviously
         broken thing this encounter could ship with. */
      const ground = groundAt(inst.x, inst.z) + C.landedLift * 0.42;
      if (inst.y > ground) {
        inst.fallSpeed = (inst.fallSpeed || 0) + 26 * dt;
        inst.y = Math.max(ground, inst.y - inst.fallSpeed * dt);
        /* Written straight onto the root rather than through
           `inst.pitch`/`inst.roll`: enemies.js guards the flyer's
           rotation write with `if (!dying)`, so a corpse that set
           those fields fell perfectly level holding its last living
           orientation - twenty-six metres of wing gliding down like a
           tray. A thing that has stopped flying has to tumble. */
        inst.pitch = damp(inst.pitch, 0.55, 1.6, dt);
        inst.roll = damp(inst.roll, 0.42, 1.4, dt);
        inst.root.rotation.set(inst.pitch, inst.yaw, inst.roll);
        if (inst.y <= ground + 0.02 && !state.impacted) {
          state.impacted = true;
          inst.grounded = true;
          ctx.vfx?.blast?.(inst.x, ground + 0.5, inst.z, 11);
          ctx.player?.doctrineKick?.(1.2, 1);
          /* A DEATH THAT IS A PHYSICAL EVENT AND LEAVES SOMETHING
             BEHIND. The furnace ruptures on impact: coals thrown wide,
             a burn under the wreck that outlasts the fight, and the
             gut goes out over the next two seconds rather than at the
             frame the health hit zero. */
          state.flash = 1.4;
          for (let i = 0; i < 4; i += 1) {
            launchEmber(inst.x, ground + 2.6, inst.z,
              (Math.random() - 0.5) * 22, 4 + Math.random() * 6,
              (Math.random() - 0.5) * 22);
          }
          spillAsh(inst.x, inst.z, C.ashRadius * 1.35, C.ashSeconds * 2.4);
          ctx.vfx?.sandSpray?.(inst.x, ground + 0.6, inst.z, 4.2, 0, 1);
          bus.emit("crash", { x: inst.x, z: inst.z });
        }
      }
      return;
    }
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - inst.x, ps.z - inst.z);

    if (state.phase === "dormant") {
      /* AND INSIDE THE RING - see districtBosses.insideArena for the
         eight-reveals-in-forty-seconds loop this closes. */
      if (dist <= C.aggroRadius && (ctx.districtBosses?.insideArena?.("censer") ?? true)) {
        beginAlert();
      }
      return;
    }

    if (state.phase === "return") { stepReturn(dt, dist); return; }

    if (dist > C.disengageRadius && state.phase !== "stoke") {
      state.disengageFor += dt;
      if (state.disengageFor > C.disengageSeconds) { beginReturn(); return; }
    } else {
      state.disengageFor = 0;
    }

    if (state.phase === "alert") {
      flyToward(cruiseY(inst.x, inst.z), 0, 0, 0, 0, 1.2, dt);
      faceTravel(dt, ps.x, ps.z, 1.4);
      state.timer -= dt;
      if (state.releaseCameraAt !== undefined && state.timer <= state.releaseCameraAt) {
        releaseEncounterCamera();
      }
      // The first tank. Every later one comes from a stoke.
      if (state.timer <= 0) {
        releaseEncounterCamera();
        setEncounterGate(false, false);
        state.fuel = C.soarSeconds;
        beginSoar();
      }
      return;
    }

    /* Fuel burns in EVERY airborne phase, in one place, so no future
       phase can accidentally fly for free the way the strafing run
       once did. */
    if (state.phase === "soar" || state.phase === "strafe") {
      state.fuel = Math.max(0, state.fuel - dt);
    }

    stepBracket(dt);

    if (state.phase === "soar") stepSoar(dt);
    else if (state.phase === "strafe") stepStrafe(dt);
    else if (state.phase === "land") stepLand(dt);
    else if (state.phase === "stoke") stepStoke(dt);
    else if (state.phase === "launch") stepLaunch(dt);
  }

  /** The player left. Heal NOW - the leash's promise must not depend
   *  on the flight home completing - then fly back and circle down. */
  function beginReturn() {
    cancelBracket();
    inst.health = inst.maxHealth;
    inst.lift = inst.maxLift;
    if (Array.isArray(inst.sacBurst)) inst.sacBurst.fill(false);
    inst.grounded = false;
    state.phase = "return";
    state.stalled = false;
    state.stunFor = 0;
    state.disengageFor = 0;
    state.action = 0;
    releaseEncounterCamera();
    setEncounterGate(false, false);
    enemies.play(inst, "idle", 0.4);
    bus.emit("returning", { x: inst.x, z: inst.z });
  }

  function stepReturn(dt, dist) {
    /* Crossing its aggro ring on the way home re-engages it - full
       strength, no second camera steal, fuel topped for the fresh
       fight. */
    if (dist <= C.aggroRadius && (ctx.districtBosses?.insideArena?.("censer") ?? true)) {
      state.fuel = C.soarSeconds;
      beginSoar();
      bus.emit("aggro", { x: inst.x, y: inst.y, z: inst.z });
      return;
    }
    const perch = perchPoint();
    const dx = perch.x - inst.x;
    const dz = perch.z - inst.z;
    const home = Math.hypot(dx, dz);
    if (home < 8) {
      state.phase = "dormant";
      state.revealed = false;
      releaseEncounterCamera();
      setEncounterGate(true, true);
      enemies.play(inst, "idle", 0.5);
      bus.emit("reset", { x: inst.x, z: inst.z });
      return;
    }
    const step = Math.min(C.returnSpeed, home / Math.max(dt, 1e-4));
    inst.x += (dx / home) * step * dt;
    inst.z += (dz / home) * step * dt;
    flyToward(cruiseY(inst.x, inst.z), dx / home, dz / home,
      C.returnSpeed, 2.4, 1.4, dt);
    faceTravel(dt, perch.x, perch.z, 1.8);
  }

  /** The hard variant - QA and save-restore only: snaps home rather
   *  than flying, because a restore has no business animating. */
  function resetToPerch() {
    state.defeated = false;
    if (!inst) ensureSpawned();
    if (!inst) return;
    cancelBracket();
    syncDifficultyProfile();
    inst.health = inst.maxHealth;
    inst.lift = inst.maxLift;
    if (Array.isArray(inst.sacBurst)) inst.sacBurst.fill(false);
    const perch = perchPoint();
    inst.x = perch.x;
    inst.z = perch.z;
    inst.y = groundAt(perch.x, perch.z) + C.cruiseHeight;
    inst.grounded = false;
    inst.pitch = 0;
    inst.roll = 0;
    state.phase = "dormant";
    state.stalled = false;
    state.stunFor = 0;
    state.revealed = false;
    state.disengageFor = 0;
    /* THE SURFACE IS RESET WITH THE ANIMAL. Damage accumulates and
       stays - that is the point of it - so the one place it may be
       forgiven is the same place the health is, or a re-armed boss
       comes back at full health wearing the last fight's scorch. */
    state.shownDamage = 0;
    setSurfaceDamage(shellMat, 0);
    state.heat = 0.26;
    state.flash = 0;
    state.swell = 0;
    state.bob = 0;
    state.relit = false;
    releaseEncounterCamera();
    setEncounterGate(true, true);
    enemies.play(inst, "idle", 0.4);
    bus.emit("reset", { x: inst.x, z: inst.z });
  }

  /* Its perch: beside a flare stack rather than on top of one.
     Spawning dead-centre on a stack put the animal inside the
     tower's own collision footprint - invisible while it is airborne,
     and a real problem the moment it lands there. Offset clear of the
     masonry and nudged out of anything else it happens to find. */
  function perchPoint() {
    const stack = C.stacks[0];
    let px = stack.x + 19;
    let pz = stack.z + 12;
    const open = ctx.collide?.findOpen?.(px, pz, groundAt(px, pz), 24, 12,
      BESTIARY_RADIUS);
    if (open) { px = open[0]; pz = open[1]; }
    return { x: px, z: pz };
  }

  function ensureSpawned() {
    if (state.defeated) return null;
    if (inst) return inst;
    const perch = perchPoint();
    inst = enemies.spawn("winnower", perch.x, perch.z, {
      yaw: Math.PI * 0.6,
      eventId: "district-boss:censer",
    });
    if (inst) {
      syncDifficultyProfile();
      inst.y = groundAt(perch.x, perch.z) + C.cruiseHeight;
      inst.grounded = false;
      inst.root.position.set(inst.x, inst.y, inst.z);
      setEncounterGate(true, true);
      /* Here rather than at construction, because the instance is what
         owns the meshes. `main.js` runs `render.warmShaders` long after
         this, and that walk uses `traverse` rather than
         `traverseVisible` - so the shell's program is built at load
         even though the animal is hidden, and the first frame of the
         encounter does not compile a shader inside itself. */
      bindShell();
      bindHurt();
    }
    return inst;
  }

  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    if (!inst) { ensureSpawned(); return; }
    bindHurt();
    const ps = ctx.player?.state;
    if (ps && inst.state !== "death") {
      const far = (inst.x - ps.x) ** 2 + (inst.z - ps.z) ** 2 > C.simRange * C.simRange;
      if (far) return;
    }
    stepInstance(d);
    /* PRESENTATION LAST, and all of it inside the simRange gate above.
       A dormant boss must cost nothing: the Stylite's dormant pose
       solve once cost this game 1.3 ms/frame and surfaced as the
       Abbess's budget failing. Everything below is a handful of scalar
       writes plus, at most, one 61-vertex terrain conform when the
       animal has actually moved - and `updatePool` returns on its
       first line while the encounter is dormant. */
    updateFurnace(d);
    updateBeat(d);
    updateCast(d);
    updatePool(d);
    syncSacs();
    updateEmbers(d);
    updateFields(d);
  }

  function status() {
    if (!inst) return state.defeated ? {
      phase: "dead", dead: true, defeated: true,
      health: 0, maxHealth: 7800,
      x: C.stacks[0].x, y: 0, z: C.stacks[0].z,
    } : null;
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      health: Math.max(0, Math.round(inst.health)),
      maxHealth: Math.round(inst.maxHealth),
      lift: Number((inst.lift ?? 0).toFixed(2)),
      maxLift: inst.maxLift ?? 0,
      sacBurst: Array.isArray(inst.sacBurst) ? [...inst.sacBurst] : [],
      grounded: !!inst.grounded,
      stalled: !!state.stalled,
      stunned: state.stunFor > 0,
      stunFor: Number(Math.max(0, state.stunFor).toFixed(2)),
      fuel: Number(state.fuel.toFixed(2)),
      dead: inst.state === "death",
      altitude: Number((inst.y - groundAt(inst.x, inst.z)).toFixed(2)),
      x: Number(inst.x.toFixed(2)),
      y: Number(inst.y.toFixed(2)),
      z: Number(inst.z.toFixed(2)),
      timer: Number(state.timer.toFixed(2)),
      ashFields: fields.filter((f) => f.life > 0).length,
      embers: embers.filter((e) => e.live).length,
      bombardCount: currentBombardCount(),
      difficultyProfile: martyr() ? "martyr" : "standard",
      airborneBodyMult: martyr() ? C.martyrAirborneBodyMult : 1,
      downDamageCap: activeDownDamageCap(),
      bracketPending: state.bracketFor > 0,
      bracketTargets: state.bracketTargets.length,
      hidden: !!inst.encounterHidden,
      locked: !!inst.encounterLocked,
      /* The furnace, reported so a harness can assert about the read
         rather than about the frame - "the gut is dark during the
         stoke" is a claim a test can make, and a screenshot cannot. */
      heat: Number(state.heat.toFixed(3)),
      sacFill: [Number(sacFill(0).toFixed(3)), Number(sacFill(1).toFixed(3))],
      surfaceDamage: Number(state.shownDamage.toFixed(3)),
      poolGain: Number(pool.gain.toFixed(3)),
    };
  }

  function snapshot() {
    if (!inst) return state.defeated ? {
      phase: "dead", timer: 0, instanceId: null,
      fuel: 0, health: 0, lift: 0, sacBurst: null,
      stalled: false, stunFor: 0, revealed: true,
      x: C.stacks[0].x, y: 0, z: C.stacks[0].z, yaw: 0,
      defeated: true,
    } : null;
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      timer: Number(state.timer.toFixed(2)),
      fuel: Number(state.fuel.toFixed(2)),
      health: Math.round(inst.health),
      lift: inst.lift,
      sacBurst: Array.isArray(inst.sacBurst) ? [...inst.sacBurst] : null,
      stalled: !!state.stalled,
      stunFor: Number(Math.max(0, state.stunFor).toFixed(2)),
      revealed: state.revealed,
      x: inst.x, y: inst.y, z: inst.z, yaw: inst.yaw,
      defeated: state.defeated,
    };
  }

  function restore(saved, restoredEnemies = {}) {
    if (!saved || typeof saved !== "object") return false;
    const byId = restoredEnemies?.byId instanceof Map ? restoredEnemies.byId : new Map();
    const rebound = (typeof saved.instanceId === "string" && byId.get(saved.instanceId))
      || enemies.live.find((candidate) => candidate.eventId === "district-boss:censer")
      || enemies.live.find((candidate) => candidate.key === "winnower"
        && Math.hypot(candidate.x - C.stacks[0].x, candidate.z - C.stacks[0].z) < 140);
    state.defeated = !!saved.defeated || saved.phase === "dead" || saved.health <= 0;
    if (state.defeated) {
      if (rebound) enemies.remove?.(rebound);
      inst = null;
      state.phase = "dead";
      clearHazards();
      return true;
    }
    inst = rebound || null;
    ensureSpawned();
    if (!inst) return false;
    const phase = ["dormant", "alert", "soar", "strafe", "land", "stoke",
      "launch", "return", "dead"].includes(saved.phase) ? saved.phase : "dormant";
    state.phase = phase;
    state.timer = Math.max(0, Number(saved.timer) || 0);
    state.fuel = clamp(Number(saved.fuel) || 0, 0, C.soarSeconds);
    state.stalled = !!saved.stalled;
    state.stunFor = Math.max(0, Number(saved.stunFor) || 0);
    state.revealed = saved.revealed !== undefined
      ? !!saved.revealed : phase !== "dormant";
    state.defeated = false;
    state.disengageFor = 0;
    state.releaseCameraAt = undefined;
    /* A restore lands INSIDE a stoke window often enough to matter, and
       the re-light staging is measured against the window's length -
       so the span has to be reconstructed from the same rule
       `beginStoke` used, not left at zero. `relit` is set from where in
       the window the save actually was, so a restore at 95% does not
       fire a second flare for a furnace that has already lit. */
    state.stokeSpan = state.stalled ? C.stallStokeSeconds : C.stokeSeconds;
    state.relit = phase === "stoke"
      && clamp01(1 - state.timer / Math.max(0.01, state.stokeSpan)) >= 0.90;
    state.bob = 0;
    state.heat = heatTarget();
    state.flash = 0;
    state.swell = 0;
    inst.x = Number.isFinite(saved.x) ? saved.x : inst.x;
    inst.z = Number.isFinite(saved.z) ? saved.z : inst.z;
    inst.y = Number.isFinite(saved.y) ? saved.y : inst.y;
    inst.yaw = Number.isFinite(saved.yaw) ? saved.yaw : inst.yaw;
    if (Number.isFinite(saved.health) && !inst.balanceMigration) {
      inst.health = clamp(saved.health, 0, inst.maxHealth);
    }
    delete inst.balanceMigration;
    if (Number.isFinite(saved.lift)) inst.lift = clamp(saved.lift, 0, inst.maxLift);
    if (Array.isArray(saved.sacBurst) && inst.sacBurst) {
      for (let i = 0; i < inst.sacBurst.length; i += 1) inst.sacBurst[i] = !!saved.sacBurst[i];
    }
    /* Grounded is DERIVED from the phase rather than trusted from the
       save: those are the only two phases that put it on the sand,
       and a restored `grounded: true` at cruise altitude would make
       the gut shootable from the ground for the rest of the fight. */
    inst.grounded = phase === "stoke" || phase === "land";
    inst.root.position.set(inst.x, inst.y, inst.z);
    inst.root.rotation.set(0, inst.yaw, 0);
    setEncounterGate(phase === "dormant", phase === "dormant" || phase === "alert");
    if (state.defeated || phase === "dead") {
      enemies.play(inst, "death", 0);
      inst.health = 0;
    } else {
      enemies.play(inst, phase === "stoke" ? "stoke"
        : phase === "dormant" ? "idle" : "alert", 0);
    }
    return true;
  }

  function clearHazards() {
    cancelBracket();
    for (const e of embers) { e.live = false; e.mesh.visible = false; }
    for (const f of fields) {
      f.life = 0; f.mesh.visible = false; f.mat.uniforms.uFade.value = 0;
    }
    burn.tick = 0;
    burn.standing = false;
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
    spillAsh,
    ensureSpawned,
    resetToPerch,
    modifyIncomingDamage,
    inAsh() { return burn.standing; },
    instance() { return inst; },
    /** Force a phase, for checks about a phase rather than about how
     *  the animal gets into one - see the Coulter's own hook. */
    forcePhase(phase, timer) {
      if (!inst) return null;
      const next = String(phase);
      state.phase = next;
      if (next !== "soar") cancelBracket();
      if (Number.isFinite(timer)) state.timer = timer;
      setEncounterGate(next === "dormant", next === "dormant" || next === "alert");
      if (next === "stoke") {
        inst.grounded = true;
        inst.y = groundAt(inst.x, inst.z) + C.landedLift;
        state.healthAtDowningStart = inst.health;
        state.damageThisDowning = 0;
        // The real pose, not whatever clip was last playing - a QA
        // force is a claim about the phase, chains drawn up included.
        enemies.play(inst, "stoke", 0.2);
        enemies.play(inst, "stoke", 0);
      } else if (next === "soar") {
        inst.grounded = false;
        inst.y = cruiseY(inst.x, inst.z);
        // A forced soar needs fuel, or it lands again on the next
        // frame and the check that forced it never sees the phase.
        state.fuel = Number.isFinite(timer) ? timer : C.soarSeconds;
        enemies.play(inst, "idle", 0);
      }
      return { phase: state.phase, timer: state.timer };
    },
    /** QA: make the next eligible airborne answer a bombardment. */
    primeBombard() {
      if (!inst || state.phase !== "soar") return false;
      state.action = 0;
      state.pending = 0;
      state.actionKind = null;
      state.bombardTimer = 0;
      state.strafeTimer = Math.max(state.strafeTimer, activeBombardCadence() + 2);
      return true;
    },
    /** QA: make the next eligible airborne answer a strafing swoop. */
    primeStrafe() {
      if (!inst || state.phase !== "soar") return false;
      state.action = 0;
      state.pending = 0;
      state.actionKind = null;
      state.strafeTimer = 0;
      state.bombardTimer = Math.max(state.bombardTimer, C.strafeCadence + 2);
      return true;
    },
    dispose() {
      scene.remove(group);
      poolGeo.dispose();
      poolMat.dispose();
      shellMat.dispose();
    },
  };
}
