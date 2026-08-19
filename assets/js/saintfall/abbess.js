/* ============================================================
   SAINTFALL - the Abbess

   The Bloom's queen, and everything about her that is not geometry:
   what she lays, what it costs you to let it live, and the one second
   in her cycle where the safest place to be and the only place worth
   being are opposite sides of the same animal.

   WHAT SHE IS

   A physogastric termite queen. Her head and thorax are the size of a
   Harrow and armoured like one; behind them is twenty metres of pale
   swollen egg sac that cannot move, cannot be moved, and is most of
   what the player is looking at. She has not walked in years. She does
   not need to.

   The Matriarch stood here before her and was a WALKER with a brooding
   habit - a big Thresher that laid. This one inverts that: the brood is
   not a habit, it is the entire animal, and she is a building with a
   mouth on the front.

   WHY THIS IS ITS OWN MODULE, AND WHY IT HAS NO MODEL

   `procedural: true`, for the same two reasons the Garner has it. A
   twenty-metre abdomen that BREATHES, runs a peristaltic wave down
   itself every time it lays, and heaves bodily off the ground to slam
   is per-vertex motion on a surface, not a rotation of a skeleton. And
   her clutches land where the fight put them - on terrain, around
   whatever the player was standing behind - rather than where an
   exporter decided.

   THE FIGHT

     DORMANT   Seated in the Throat, folded down, dark. She ignores
               everything until the player crosses AGGRO_RADIUS.
     ROUSE     4.6s. The sac lights from inside and the head comes
               round. It does not GROW: she is revealed at the size she
               is fought at, because an egg sac inflating under a
               reveal camera reads as a balloon rather than as an
               animal waking. See `poseAbdomen`.
     SEATED    THE FIGHT. Four things on four clocks, and the player
               chooses which of them they are playing against purely
               by where they stand:

               THE CLUTCH is the encounter. She lays eggs in an arc
               behind her; each swells for a few seconds and splits
               open. An egg is a target - shoot it and what was inside
               never exists - so "she spawns a lot" is a problem with
               an answer rather than a tax. Four rifle rounds each, or
               one swing of the lance whatever those two numbers drift
               to: the cost of a clutch is written for the player who
               is not going to walk into it.

               ...AND SOME OF IT SHOOTS BACK. A share of every clutch
               hatches the ranged caste instead, and the share is a
               function of how far off the player was standing when she
               laid it. Everything else she has reaches about twenty
               metres; this is the part of her that reaches fifty, and
               it exists because it is the only pressure that lands on
               a distant player without landing twice as hard on a
               close one.

               TROPHALLAXIS is why that answer matters. Her brood comes
               BACK to her, and every one that reaches her head feeds
               her. Ignore the swarm and it does not merely crowd you,
               it undoes the fight: a dozen Threshers walking home is
               most of a health bar returned.

               THE SLAM is what she does about anything out on the
               floor beside her. She heaves twenty metres of abdomen up
               and drops it, and everything in a twenty-eight metre
               ring is knocked flat - a real stun, not a slow: no
               moving and no attacking for a second and a half, in a
               room full of her children. It is a shock through the
               FLOOR, so the answer to it is to not be on the floor:
               jump on the tell and it passes underneath.

               THE BITE is what she does about anything at her jaws,
               and it is the reason her armoured front is worth
               facing. Four metres of plate with a mouth on it used to
               be the safest ground on the map, because the slam is
               centred ten metres behind her head. It is now the most
               expensive: two bites kill. Resolved at the strike frame
               against where the player actually is, with her heading
               committed a third of the way into the rear-back, so
               stepping out of the cone beats it outright.

               And the slam is the fight's one real decision, because
               the raised abdomen exposes its UNDERSIDE - the one part
               of her that is sac rather than plate. The window in
               which she is about to hurt you most is the window in
               which she can be hurt most, and both of them are in the
               same two metres of ground.

     ROYAL     Once, under a third health. She lays a single royal cell
               and a MATRIARCH comes out of it. The district's previous
               guardian is now something this one produces.
     RETIRE    The leash. She folds back down at full health.

   Her brood's own pool is `inst.health` on ordinary Threshers and
   Gleaners, so nothing here is a special case for combat.js: they are
   spawned, they are killed, and this module only ever watches.

   ============================================================
   HOW SHE IS LIT AND SURFACED, and the four traps in it

   She is the best subsurface subject in the game and she used to be
   the flattest thing in it: twenty metres of ivory sac at the same
   value and the same warm hue as the dune behind her, on three
   materials that all read as one matte plastic. Four things fixed
   that, and each of them had a trap.

   1. THE KIT'S GRAIN IS GLUED TO `position`, AND HER `position`
      MOVES. `applySurface` samples its noise field from the raw
      `position` attribute precisely because on a skinned .glb that
      attribute is the bind pose and never moves. Every other boss in
      the programme gets that for free. This one does not: the sac and
      the eggs are procedural meshes whose `position` IS the animation
      - rewritten every frame by `poseAbdomen` in WORLD space - so the
      kit's field would swim across the shell on every breath and slide
      nine metres down her body on every slam, which is the exact
      failure the kit's own header says it exists to avoid.

      So both meshes carry a second, STATIC attribute, `sfObj`: the
      rest pose as a straight cylinder in metres, written once at
      build. `bindSurfaceToRestPose` re-points the kit's one vertex
      line at it and folds a suffix into the program cache key, so the
      variant stays distinct. It is a rewrite of the kit's own
      generated source and it is only correct because it also extends
      the key - see the note on the function itself. The proper fix is
      one line in `boss-surface.js` and it is in this round's report.

   2. TWO MATERIALS, UNMISTAKABLY DIFFERENT. `membrane` on the sac and
      the eggs, `chitin` on the head, thorax, collar and tergites. The
      chitin also took a real METALNESS - a violet dielectric throws a
      white highlight, a violet metal throws a violet one, and that
      hue-shifted sheen rolling across plate as the camera moves is
      most of what a 2001 Hunter has that we did not.

   3. THE LAMP IS THE ANIMAL. She does not get a light: a light
      appearing recompiles every material in the scene, and this
      district already pays that once. The brood glow is vertex alpha
      through the atmosphere patch's `bio` channel - repainted every
      frame, so the light can travel down her, sicken as she dies, and
      flare on the ventral weak point exactly when the fight opens it -
      plus two additive shells that cost two draw calls between them
      and give her something the emissive channel cannot: spill. One
      hugs the belly, one lies on the chamber floor underneath it.

   4. A DORMANT QUEEN NOW COSTS NOTHING. `poseAbdomen` and
      `updateEggs` used to rewrite and re-upload every vertex of a
      hidden mesh on every frame of the whole game. Both are gated on
      there being something to see; both take a `force` so the spawn,
      reset and restore paths still get a spine written for combat.js
      to read.
   ============================================================ */

import {
  TAU, clamp, clamp01, damp, dampAngle, lerp, makeBus, makeRng, smoothstep,
  sstep,
} from "saintfall/core.js";
import { patchBasicMaterial } from "saintfall/art.js";
import { revealCamera } from "saintfall/reveal-camera.js";
import { applySurface, setSurfaceDamage } from "saintfall/boss-surface.js";
import { DISTRICTS } from "saintfall/terrain.js";
import { SURVIVAL_CONFIG } from "saintfall/combat.js";

/* The Throat: the clearing at the Bloom's centre, ringed by sixteen
   chitin spires leaning inward over it - see world.js, which keeps
   every other spire and membrane sac out of a 74m circle here.

   Repeated rather than exported because world.js builds asynchronously
   and this module needs the number at construction time. It is the one
   authored space in the district big enough to fight in and enclosed
   enough to read as a room, which is exactly what a royal chamber is. */
const THROAT_X = DISTRICTS.bloom.x - 40;
const THROAT_Z = DISTRICTS.bloom.z - 50;

export const ABBESS_CONFIG = Object.freeze({
  lairX: THROAT_X,
  lairZ: THROAT_Z,
  /* Facing out of the chamber's mouth, so a player walking in from the
     district arrives at her head rather than behind her - and her
     abdomen, which is the thing worth shooting, is the far half. */
  yaw: Math.PI * 0.28,

  /* Inside the spire ring, which stands at 34m. She is a place you
     walk into. */
  aggroRadius: 58,
  rouseSeconds: 4.6,
  // The site ring (district-bosses reads this). Enlarged m101; stays
  // inside disengageRadius so the ring fires before the leash.
  arenaRadius: 148,
  disengageRadius: 210,
  disengageSeconds: 14,
  retireSeconds: 5.0,

  /* ------------------------------------------------------------
     THE BODY
     ------------------------------------------------------------ */
  /* Twenty metres of abdomen on a four-metre thorax. The ratio is the
     whole silhouette: anything closer to even reads as a big beetle,
     and a queen has to read as a body that outgrew its own animal. */
  abdomenLength: 20,
  abdomenRadius: 4.6,
  abdomenSegments: 13,
  /* How far the sac's belly sits off the chamber floor when she is
     seated. Small: she rests on it. */
  abdomenClearance: 1.1,

  /* ------------------------------------------------------------
     THE CLUTCH
     ------------------------------------------------------------ */
  clutchCadence: 7.5,
  clutchWindup: 1.15,
  /* Eggs per clutch at full health and at none. Starts gentle (2 eggs)
     and scales up slowly over active fight time and health loss, giving
     the player ample opportunity to kill the boss before clutches grow. */
  clutchEggs: [2, 7],
  /* Time scaling: seconds of active combat per +1 egg in clutch */
  clutchTimeScaleSeconds: 32,
  eggHatchSeconds: 5.2,
  /* An egg is a real target with a real pool, and the pool is written
     for the RANGED player - because they are the ones who have to
     spend it. Four rifle rounds, and one swing of the lance whatever
     the number says (see `hitEggs`, which treats a melee connection as
     lethal rather than as 90 damage that has to beat 90 health).

     That asymmetry is the whole point of the value. At two rounds an
     egg the answer to a clutch was a second of trigger from wherever
     the player happened to be standing; at four it is most of a
     magazine and a vent, which is a real choice against shooting HER -
     while a player who walks into the clutch still clears it at one
     egg per swing. The fight's ranged tax and its melee reward are the
     same number read from two sides. */
  eggHealth: 90,
  eggMax: 26,
  /* ------------------------------------------------------------
     WHAT COMES OUT OF THEM

     Most of a clutch is Threshers - the swarm is the fight - but some
     fraction of every clutch hatches the RANGED caste instead, and
     that fraction is a function of where the player is standing.

     This is the answer to the one way her fight could be sat out. Her
     whole moveset reaches about twenty metres: the slam is a ring
     around her own body, the bite is at her head, and the brood has to
     WALK. A player at fifty metres with a rifle was fighting a
     shooting gallery, and every number that could have punished them -
     more health, more eggs, a faster clutch - punishes the player
     stood in the room even harder. A Gleaner reaches 52m. It costs a
     close-range player nothing they were not already paying, and it
     costs a distant one the thing they were buying with the distance.

     Ramped rather than switched, so it reads as pressure rather than
     as a rule: at her body it is roughly one in eight, and past
     `rangedTo` half the clutch comes out shooting. */
  rangedShare: [0.12, 0.5],
  rangedFrom: 24,
  rangedTo: 62,
  /* Live brood she will tolerate. Past this she still lays - the
     animation and the tell are unchanged - but the eggs come out
     spent, which is far better than a queen that visibly stops
     working because an off-screen counter is full. */
  broodCap: 18,

  /* ------------------------------------------------------------
     TROPHALLAXIS
     ------------------------------------------------------------ */
  /* How near her head a child has to get to feed her, and what it is
     worth. Tuned against her pool: a full cap of eighteen walking home
     unopposed is about a third of her health, so ignoring the swarm
     is survivable exactly once. */
  feedRadius: 7.0,
  feedHeal: 145,
  /* How long a newborn hunts the player before it thinks about going
     home. Without this the whole brood turns round immediately and the
     fight becomes a queue rather than a swarm. */
  feedAfterSeconds: 11,

  /* ------------------------------------------------------------
     THE SLAM
     ------------------------------------------------------------ */
  slamCadence: 9.5,
  /* The heave. Long, and deliberately the longest telegraph in the
     game: it is also the vulnerability window, so every frame of it is
     something the player is being offered rather than something they
     are waiting through. */
  slamRise: 1.45,
  slamHold: 0.35,
  slamFall: 0.22,
  /* THE RING, and it is most of the arena now.

     At 17m the slam covered a third of the ground between her head and
     the far end of her own abdomen, which meant "stand anywhere else"
     was a complete answer to it - and the fight's one decision is
     supposed to be whether to be UNDER her when it lands. An attack
     you can walk out of is not a decision, it is a tax on
     inattention. Twenty-eight covers the whole of her body's footprint
     and a good margin past it, so the answer is now the one the attack
     is telegraphing: get off the floor. */
  slamRadius: 28,
  slamDamage: 52,
  /* AND YOU ARE ACTUALLY ON THE FLOOR.

     This used to be a slow, with a comment explaining that the slow
     WAS the stun because the player had no stun state. They do now -
     `player.applyStun`, which takes the feet and the hands both - so
     the attack says what it always meant: for `slamStunSeconds` you
     cannot move, jump, boost, fly, shoot or swing, in a ring full of
     her children.

     The slow is kept as the TAIL. Getting up is not instant, and
     stun-into-nothing reads as a bug the moment control returns at
     full sprint; a second and a half of staggering out of the ring is
     the recovery the stun is worth. */
  slamStunSeconds: 1.5,
  slamSlowFactor: 0.28,
  slamSlowSeconds: 2.0,
  /* HOW FAR OFF THE FLOOR IS OFF THE FLOOR.

     The one out, and it is deliberately a jump rather than a dodge:
     the trooper's jump peaks at 1.05m and is airborne for 0.65s, and
     the slam telegraphs for 1.8s before a 0.22s drop. Half a metre of
     clearance means the timing window is most of the jump - roughly
     0.47s of the 0.65 - so it is answerable on the tell without being
     free. A pack or a boosted leap clears it outright, which is what
     those are for. */
  slamAirClear: 0.55,
  /* And what it does to her OWN brood, which is most of why a good
     player learns to bait it: she does not distinguish. */
  slamBroodDamage: 90,
  /* Only thrown at something close enough to be worth twenty metres of
     abdomen. Further out and she lays instead. Kept a good deal
     tighter than the ring itself: the slam should reach further than
     the range that provokes it, so a player who backs off on the tell
     is running out of a blast they had already earned rather than
     stepping over a line she is watching. */
  slamRange: 21,

  /* ------------------------------------------------------------
     THE BITE

     The thing her whole silhouette has been promising and could not
     deliver. She is built armour-first - the player walks into a
     chamber and meets four metres of plate with a face on it - and
     until now the correct play against that face was to stand in it:
     the slam is centred under her ABDOMEN, more than ten metres
     behind her head, so the safest ground on the map was directly in
     front of her jaws. An immobile boss whose front is both her only
     armour and her only safe ground has no reason to be facing you.

     Pale mandibles against dark plate were modelled in from the first
     pass, with a comment saying they are "the one cue that says this
     animal can still bite". They now are.

     Short, frontal, and hard enough to be a mistake rather than a
     tax: two of these kill a full-health trooper. The out is the same
     one every melee caste in the game offers and the slam does not -
     it is resolved at the STRIKE frame against where the player
     actually is, so stepping out of the cone during the rear-back
     beats it outright.
     ------------------------------------------------------------ */
  biteCadence: 6.2,
  /* Reach from her seat, not from her jaws: the head's own geometry
     puts the mandible tips about eleven metres out in front of the
     origin, and the lunge carries them past that. Comfortably shorter
     than `slamRange`, so the two attacks divide the ground between
     them rather than competing for it. */
  biteRange: 15.5,
  /* Half-angle of the cone she can reach. Wider than it sounds,
     because `clampToSeat` already holds her heading to +/-0.8rad of
     her seat - past that she physically cannot look at you. */
  biteArc: 0.85,
  /* The rear-back, the snap and the recovery. The wind-up is a third
     again the longest ordinary caste tell (the Matriarch's 0.75) and
     the snap is faster than any of them: a boss's bite has to be
     readable from further away and less survivable once it is
     committed. */
  biteWindup: 0.78,
  biteStrike: 0.15,
  biteRecover: 0.66,
  biteDamage: 84,
  /* Thrown clear rather than merely hurt. Metres, applied along the
     bite's own axis through `player.drag`, so masonry stops the throw
     the same way it stops a step. */
  biteThrow: 7.5,

  /* THE UNDERSIDE. Multiplier and the aperture it needs - see
     HITBOX.abbess, which reads `inst.raised` to decide whether the
     ventral capsule exists at all. */
  raisedWeak: 0.55,

  /* ------------------------------------------------------------
     THE ROYAL CELL
     ------------------------------------------------------------ */
  royalAtHealth: 0.34,
  royalSeconds: 6.5,

  simRange: 620,
});

/* TWENTY-TWO, up from twelve, and it is a detail budget rather than a
   silhouette one. The sac is smooth-shaded, so extra sides do almost
   nothing to its outline - what they buy is somewhere to PAINT. At
   twelve sides one vertex spans thirty degrees, which on a nine-metre
   body is two and a half metres: nothing finer than "belly, flank,
   back" can be written into the colour attribute at all, and the
   membrane's own veining had nowhere to live. Doubling it costs 130
   vertices, no draw calls, and a per-frame repaint that was already
   negligible. */
const SAC_SIDES = 22;
const EGG_SIDES = 7;
const EGG_RINGS = 4;

/* ============================================================
   THE PALETTE, AND THE ONE RULE IT ANSWERS

   "A boss may not wear its district's sand." The first pass did,
   exactly: SAC_PALE was [0.335, 0.280, 0.262] - a warm ivory, and the
   Bloom's ground photographs as a warm brown-maroon at almost that
   value, so twenty metres of animal read as a dune with segments on
   it. The separation strategy the art direction assigns her is
   SATURATION AND GLOW, and neither of those is a paler cream.

   So the sac is no longer pale at all. It is TRANSLUCENT: a hot,
   saturated brood light seen through a stretched membrane, which is
   what backlit flesh actually looks like and what nothing else in the
   district is. Three families, deliberately unequal in area, the way
   the Halo 2 Scarab is built:

     - a LOT of near-black violet chitin (head, thorax, collar,
       tergites, the sac's back) - value separation, hard down
       against a mid-value ground;
     - a LITTLE hot rose brood light on the sac's belly - chroma
       separation, the only saturated thing in frame;
     - ONE spot of the saturated: the ventral weak point, which is
       hotter and wetter than everything around it and gets brighter
       in the two seconds the fight lets you shoot it.

   The glow colours are stored NORMALISED - peak channel at 1.0 - and
   scaled by a separate gain at use. An additive shell built from a
   saturated colour whose channels are not normalised clips its bright
   channel long before the others and the whole effect turns white,
   which this project has already paid for once in the doctrine rites.
   ============================================================ */
/* The brood light itself. Hot rose rather than amber: amber is the
   district's own dust and would give the frame one hue family again,
   and a queen's clutch lit from behind goes red long before it goes
   yellow. */
/* ROLLED OFF THE SAND, TWICE. The first pass here was [1.00,0.30,0.30] -
   a hot RED, hue about 0 degrees - and the measurement said the frame's
   mean hue was landing at 27-31 degrees, which is Vesper-IX's own dust.
   A red lamp in a warm brown chamber is one hue family wearing two
   exposures. Pulled round past red into rose-magenta (blue channel now
   ABOVE green, so the hue is negative - roughly -20 degrees), which is
   the one direction nothing else in the Bloom occupies: the district's
   spires are violet, its ground is orange-brown, and this sits between
   them and belongs to neither. */
const SAC_GLOW = [1.00, 0.26, 0.42];
/* ...and what it becomes as she dies. Not merely dimmer - SICK. Hue
   rolls off the red toward a bilious ochre and the chroma drops, so a
   player reads her health off the light rather than off the bar. */
const SAC_SICK = [0.42, 0.62, 0.26];
/* Lit membrane, where the brood light comes through the thinnest
   stretch of her. BRIGHT, and measurably so: the first repaint of this
   round put her at meanLuma 23.2 against a Halo pool band of 31.4-91.6
   with 73% of the frame crushed under luma 26, and the honest reading
   of that is not "the grade is wrong" - the district is dark on
   purpose and art.js is not this module's to touch - but "the one
   thing in the frame that is supposed to be a light source is not
   bright enough to be one". */
const SAC_PALE = [1.00, 0.36, 0.47];
/* ...and the same membrane where it does not: her flanks and back,
   violet, the value floor of the animal. Not black: a back at 0.075
   made the top half of a twenty-metre animal read as a hole punched in
   the chamber, which is a silhouette rather than a body. */
/* ...AND THESE ARE LINEAR, which is the whole reason this number had
   to move. Vertex colours are handed to three in working space and are
   NOT converted, so 0.105 linear is sRGB 0.36 - a mid mauve, not the
   near-black the number reads as on the page. Under the grade's warm
   shadow tint that mid mauve photographed as TAN, and the dorsal third
   of a twenty-metre animal came back wearing the district's sand while
   the constant sitting here said "violet". Taken down to a value that
   is dark AFTER the encode, and pushed further into blue so the warm
   split-tone has further to drag it. The old note that a dark back
   "reads as a hole punched in the chamber" was written when the whole
   animal was dark and there was nothing for a hole to be punched IN;
   with the belly now a lamp, a dark dorsal is the animal's own
   silhouette against its own light, which is form rather than absence. */
/* ...and then put BACK UP in chroma, which is the opposite of what the
   paragraph above concluded and is worth recording as a correction
   rather than quietly editing away.

   A colour probe settled it: the abdomen was repainted [0,0,1] blue and
   [0,1,0] green to find out which region was which, and the tan cap
   turned out to sit exactly on this constant. Taking the constant DOWN
   to 0.052 did not make the cap violet - it made it tanner. The reason
   is that the warm terms on this surface are ADDITIVE and albedo-blind:
   the sky rim and the sun's Fresnel specular are the same number of
   photons whatever is underneath them, so the darker the paint the more
   completely they own the pixel. A near-black dorsal is not a violet
   dorsal, it is a canvas for whatever the sky is doing.

   So the dorsal has to be dark AND saturated enough to still be the
   loudest thing in its own pixel: value roughly where it was, chroma
   nearly doubled, and the blue channel now 2.7x the red. The warm
   specular then reads as a highlight ON violet rather than as the
   colour of the animal. */
const SAC_DEEP = [0.095, 0.042, 0.255];
const SAC_VEIN = [1.00, 0.24, 0.44];
/* The tergites: the hard plates between the swollen segments, and they
   are the same chitin as her head rather than a darker shade of sac.
   Painting them as "dimmer cream" was the first pass and it made twenty
   metres of faint ring lines - the bands have to be a different
   MATERIAL to the eye, not a different exposure of the same one. */
/* ...and the tergites keep their CHROMA even at this value, for the
   reason the SAC_DEEP note above spells out: on a near-neutral dark
   paint the sun's Fresnel specular owns the pixel and the plate reads
   cream. These sit at a tenth of the sac's value with two and a half
   times the blue of the red, so the highlight lands ON violet. */
const SAC_BAND = [0.052, 0.021, 0.132];
const CHITIN_DARK = [0.034, 0.024, 0.056];
/* The plate's lit face. Pushed toward violet and away from the brown
   it used to carry, because the chitin's own metalness now tints its
   specular with this colour: a violet metal throws a violet highlight
   and a brown one throws a muddy sand highlight, which is the district
   again. */
const CHITIN_LIT = [0.205, 0.118, 0.315];
const EGG_PALE = [0.92, 0.34, 0.46];
/* A SHELL WITH A GLEANER IN IT. Acid green against her whole palette,
   which is pink membrane over near-black chitin - the one hue on the
   animal that is not on the animal. A player has five seconds between
   a clutch landing and it hatching, and the only useful thing they can
   do with that information is decide which eggs to burn first; a tint
   they have to squint at is the same as no tint.

   AND IT IS DARK, which is the whole trick. The egg's emissive is
   `albedo * vColor.a * 2.6` (see `bindEmissiveToGrain` and the kit's
   `bio` gain), so a ripe shell is being multiplied by better than two
   - and a saturated green at (0.44, 1.00, 0.58) comes out of that with
   every channel past 1.0, which is WHITE. Photographed beside a
   Thresher egg the difference read as "one of them is blown out", not
   as "one of them is green". Painted dark enough that only the green
   channel clips, the hue survives the gain - the same lesson the
   doctrine rites learned: divide by the peak channel, or the colour is
   not a colour, it is an exposure. */
const EGG_RANGED = [0.10, 0.66, 0.24];
/* THE WEAK POINT'S CORE, and it is the one place on her that is allowed
   to leave the hue behind entirely. Everything else on the animal is
   rose; this is rose taken to the top of the value scale, so the focal
   element separates from the lamp it sits in by VALUE rather than by
   another colour - which is what the Scarab's cyan core does against
   its orange panels, one axis over. */
const WEAK_CORE = [1.00, 0.66, 0.62];
/* The eyes, and they are the only part of her that is allowed to blow
   out. A frame with no blown pixel anywhere has no wet, no polish and
   no metal in it - the whole cast measured brightPct at or near zero
   against a pool that always carries some - and two lit lozenges on a
   dark head is the cheapest honest place to spend it. */
const EYE_HOT = [1.00, 0.46, 0.42];

export function buildAbbess(ctx) {
  const { THREE, scene, atmos, enemies } = ctx;
  const bus = makeBus();
  const C = ABBESS_CONFIG;
  const rng = makeRng(0xab8e55);
  const groundAt = (x, z) => (ctx.collide
    ? ctx.collide.groundHeight(x, z)
    : ctx.terrain.heightAt(x, z));

  const group = new THREE.Group();
  group.name = "abbess";
  group.visible = false;
  scene.add(group);

  /* ============================================================
     EVERYTHING OF HERS THAT IS NOT HER BODY

     The spill shells and the clutch go in their own group, and this
     is a silhouette fix rather than tidiness.

     `saintfall-boss-gallery.mjs` photographs a boss's outline by
     naming its body meshes as roots, walking the scene, and hiding
     everything that is not on a path to one of them. That is a
     correct design and it did not work here, because the things it
     hides RE-SHOW THEMSELVES: `poseGlow` and `updateEggs` set
     `mesh.visible = true` every frame, and the harness's step runs
     after its walk. So the Abbess's silhouette came back as a
     twenty-two metre jagged white DISC with an animal somewhere in
     the middle of it - the glow pool, painted flat white, read as
     part of her shape - plus two lozenges out on the floor that were
     a clutch of eggs.

     Nothing in this module needs to know about the harness for that
     to be fixed. Parent them to one group that the module never
     touches the visibility of: the walk hides the GROUP, the per-mesh
     flags underneath go on flipping harmlessly, and nothing draws.
     Anything added here later inherits the fix.

     `group.traverse` still reaches all of it, so the fight harness's
     winding audit keeps its coverage. */
  const decor = new THREE.Group();
  decor.name = "sf-abbess-decor";
  group.add(decor);


  const floorY = groundAt(C.lairX, C.lairZ);

  let inst = null;

  const state = {
    phase: "dormant",     // dormant, rouse, seated, royal, retire, dead
    timer: 0,
    fightTime: 0,
    /* 0 is folded and dark, 1 is lit and up. Everything about her that
       is not an attack is a function of it, which is what makes the
       reveal and the leash the same animation run in two directions. */
    woken: 0,
    /* How far the abdomen is off the floor, 0..1. Owned by the slam,
       read by combat.js through `inst.raised` - it is the aperture on
       her one weak point. */
    raised: 0,
    /* A peristaltic bulge travelling the sac, 0..1, or -1 for none. */
    wave: -1,
    clutchTimer: C.clutchCadence * 0.45,
    clutchWind: 0,
    slamTimer: C.slamCadence * 0.7,
    slamPhase: null,      // rise, hold, fall
    slamTime: 0,
    /* The bite, on the same shape as the slam: one clock counting down
       to the next one, one phase string while it runs, one timer
       inside the phase. */
    biteTimer: C.biteCadence * 0.55,
    bitePhase: null,      // wind, strike, recover
    biteTime: 0,
    bites: 0,
    bitesLanded: 0,
    royalDone: false,
    disengageFor: 0,
    defeated: false,
    revealed: false,
    releaseCameraAt: undefined,
    fed: 0,
    laid: 0,
    breathTick: 0,
    dustTick: 0,

    /* ---- weight, and the things that carry it -------------------
       NONE of these are saved. `snapshot` writes six numbers and a
       phase and that is deliberate: a settling spring or a half-flinch
       persisted into a save file is a physical state with no meaning
       on the other side of a load, and this module already carries one
       hard-won lesson about what a boss is allowed to put in a save
       (see the FLOORED note in `stepInstance`). Everything below is
       reset by `resetToSeat`, `clearHazards` and `restore`. */
    /* The abdomen's own heading, which LAGS the thorax's. Twenty
       metres of egg sac does not arrive when the head does. */
    sacYaw: C.yaw,
    /* One damped spring, driven by every impact she takes or makes,
       read per-ring with a delay so the wobble travels down her rather
       than bobbing the whole body as a unit. */
    jigY: 0,
    jigV: 0,
    /* WHERE she was last hit, as a ring index, and how much of that
       flinch is left. A boss that flinches identically wherever it is
       shot is a health bar with a model attached. */
    hitRing: -1,
    hitAmt: 0,
    /* Rate limit on ichor stains: the scorch pool is shared and small,
       and a full-auto magazine into her belly would evict every other
       mark on the map inside two seconds. */
    ichorAt: -99,
    /* The death, as a physical event with a clock on it: the abdomen
       deflates, the brood light goes out, and she settles. */
    deathT: -1,
  };

  /* Her living children, and how long each has been alive. combat.js
     drives their walking; this module only ever decides where they are
     walking TO - see `updateBrood`. */
  const brood = [];

  /* ============================================================
     MATERIALS

     Three. The sac, which is the animal; chitin, which is her armour
     and her chamber's own material; and the eggs, which need to read
     as lit from inside at any hour because the player has to be able
     to tell a live one from a spent one across a dark room.
     ============================================================ */
  /**
   * Re-point the shared surface kit at a STATIC rest pose.
   *
   * THE TRAP, stated once so nobody re-derives it. `applySurface`
   * samples its object-space grain from the `position` attribute, on
   * the reasoning - correct for every .glb boss - that `position` is
   * the bind pose and therefore never moves. Both of this module's
   * animated meshes violate that: the sac's and the eggs' positions
   * are rewritten in WORLD space every frame, so the kit's field would
   * slide across the shell on every breath, travel with the laying
   * wave, and drop nine metres down her body every time she slammed.
   * A projected pattern is the one thing the kit exists to not be.
   *
   * The fix is a second attribute, `sfObj`, written once at build and
   * never touched again, and one line of the kit's generated vertex
   * shader re-pointed at it.
   *
   * WHY THIS IS ALLOWED TO REWRITE GENERATED SOURCE. `patchMaterial`
   * owns `customProgramCacheKey`, and the failure it warns about is a
   * second `onBeforeCompile` that changes the SOURCE without changing
   * the KEY - two variants then silently share whichever program
   * compiled first, and the symptom is "my shader did nothing". This
   * wrapper calls the kit's compile first and then extends the kit's
   * own key rather than replacing it, so the invariant the warning
   * protects - one program per distinct source - still holds. It is
   * still a workaround: the right shape is an `objAttribute` option on
   * `applySurface`, which this round's report asks for.
   */
  function bindSurfaceToRestPose(material) {
    const compile = material.onBeforeCompile;
    const key = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      compile(shader, renderer);
      /* Anchored on the kit's own varying declaration and its one
         assignment. Both are literals the kit writes itself, so if it
         ever renames them this stops matching and the grain goes back
         to swimming - which is visible in a screenshot, unlike a
         silent shader failure. */
      shader.vertexShader = shader.vertexShader
        .replace("varying vec3 vSFObj;", "varying vec3 vSFObj;\nattribute vec3 sfObj;")
        .replace("vSFObj = position;", "vSFObj = sfObj;");
    };
    material.customProgramCacheKey = () => `${key.call(material)}|abbessRest`;
    material.needsUpdate = true;
    return material;
  }

  /**
   * Make the brood light carry the surface's own grain.
   *
   * THE TRAP, and it is the one that kept this animal measuring flat
   * however much detail was put on it. `art.js` computes the vertex-
   * alpha emission at `color_fragment`:
   *
   *     vec3 sfBio = diffuseColor.rgb * vColor.a * uBio;
   *
   * which is BEFORE the surface kit touches anything. The kit's cavity,
   * mottle, wear and crack all land at `normal_fragment_maps`, several
   * chunks later. So on any surface whose emission is a large fraction
   * of its final value - which is the whole point of this boss - the
   * pixel is mostly a term that no grain has ever been applied to, and
   * the brighter the lamp is made the FLATTER it gets. She measured
   * microDetail 4.8 against a Halo floor of 6.1 with a fully detailed
   * shader running on her, because the detailed half of the shader was
   * being drowned by the undetailed half.
   *
   * The fix is one substitution and no new maths: emit from the albedo
   * as it stands at emission time rather than from the copy taken
   * eleven chunks earlier. `diffuseColor.rgb` by then carries every
   * modulation the kit applied, so the light coming through her is
   * dimmer in the creases and brighter on the crests - which is also
   * what a backlit membrane of uneven thickness actually does.
   *
   * WHY IT IS SAFE TO CHAIN THIS ONTO `bindSurfaceToRestPose`. The
   * warning `patchMaterial` carries is about a second `onBeforeCompile`
   * that REPLACES `customProgramCacheKey` and so collapses two distinct
   * sources into one program. Both wrappers here capture the previous
   * function and the previous key and extend each, so the invariant -
   * one program per distinct generated source - still holds however
   * many of them are stacked.
   *
   * It is still a rewrite of somebody else's generated string, and it
   * is anchored on a literal `art.js` owns. The right shape is for the
   * bio block to move to `emissivemap_fragment`, where it would pick
   * this up for every boss at once; that patch is in the report.
   */
  function bindEmissiveToGrain(material) {
    const compile = material.onBeforeCompile;
    const key = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      compile(shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        "totalEmissiveRadiance += sfBio;",
        "totalEmissiveRadiance += diffuseColor.rgb * vColor.a * uBio;");
    };
    material.customProgramCacheKey = () => `${key.call(material)}|abbessEmitGrain`;
    material.needsUpdate = true;
    return material;
  }

  const sacMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    /* WET, and lower than the 0.44 this carried before the surface
       kit arrived. What says "membrane" rather than "painted rubber"
       is a specular lobe that TRAVELS as the camera moves, and the
       membrane family's gloss spread is the widest in the table
       precisely so that it can - but it modulates around whatever
       centre the module sets, and a centre at 0.44 kept the whole
       travel inside the matte half. */
    /* AND THEN PUT BACK UP, from 0.33, because 0.33 was buying the
       wrong kind of wet.

       A dielectric's specular is WHITE whatever the surface under it
       is, and a broad lobe on a twenty-metre cylinder concentrates
       that white into a band running the animal's whole length. At
       0.33 that band photographed as a pale warm cream ridge along
       every tergite fold - which is to say the one boss forbidden from
       wearing the district's sand was growing a sand-coloured stripe
       out of its own highlight, and no amount of repainting the albedo
       could touch it because the albedo was not what was being seen.

       0.50 spreads the same energy over roughly twice the solid angle
       and drops the peak below the point where it reads as a colour.
       What replaces it is the kit's `glint` term, which is a NARROW
       lobe confined to the top tenth of the coarse crest: a scatter of
       small blown specks instead of one long cream ridge. Same wet, a
       tenth of the area, and it lands where the grain is rather than
       where the cylinder is. */
    roughness: 0.56,
    /* A LITTLE METAL ON A MEMBRANE, which is a lie the chitin already
       tells for the same reason: past a little metalness the albedo
       tints the specular, so what glints off her is rose rather than
       white. Kept small - the diffuse term is what the brood light is
       escaping through and metalness eats it. */
    metalness: 0.10,
  });
  sacMat.name = "sf-abbess-sac";
  /* Smooth-shaded, like the Garner's limbs and for the same reason:
     everything faceted in this game is made, and a swollen membrane is
     the exception the rule points at. `bio` carries the veining, which
     is the only thing keeping a twenty-metre pale mass from reading as
     a boulder at night. */
  /* RIM LOW, and this is the second time this codebase has learned it.
     The atmosphere patch's sky-tinted rim is additive and independent of
     albedo, and on a twenty-metre SMOOTH surface every facet catches it
     at once - so at the Garner's own 1.35 the sac came back as one flat
     ivory mass with no form in it at all, and halving the paint did
     nothing because the paint was not what was being seen. Turned down,
     the diffuse lighting gets the body back and the segments read. */
  /* `bio` up from 0.9. The emissive the atmosphere patch adds is
     `albedo * vColor.a * bio`, so this number and the alpha this
     module repaints every frame are the two halves of one dial: above
     1 the belly clears the bloom chain's bright threshold and actually
     blooms, which is the difference between a pale surface and a lamp.
     The alpha ramp is written to keep her back near zero, so raising
     the gain lights the belly without lighting the animal. */
  applySurface(sacMat, atmos, "membrane", {
    /* RIM DOWN AGAIN, from 0.28. The atmosphere's rim samples the SKY
       and adds it, and Vesper-IX's sky is pale warm - so on the one
       boss whose separation strategy is "not the district's hue", the
       rim is the district's hue arriving through the back door along
       every silhouette edge. She does not need it: she is a light
       source, and a lamp separates from its background by being
       brighter than it, which is the job a rim is normally hired for.

       AND THEN OFF ENTIRELY, at 0, once the colour probe had run. On
       the dorsal third, where the paint is deliberately dark, the rim
       WAS most of the pixel - so the pixel was the sky's warm colour,
       and the one boss forbidden from wearing the district's sand had
       a sand-coloured back that no amount of repainting could reach.
       She does not need it: a rim exists to separate a silhouette from
       its background, and this silhouette is separated by twenty
       metres of light coming out of the animal's own belly. */
    rim: 0, glitter: 0, bio: 1.85,
    /* WEAR OFF, and it is the one family field this animal must
       override. The kit's wear pass pulls the hue out of upward-facing
       facets and lifts their value - which is right for a rubbed plate
       and exactly wrong here, because a desaturated pale top on a
       twenty-metre abdomen is the district's own sand reappearing on
       the one boss whose whole separation strategy is saturation. The
       first shoot of this round came back with cream ridges along
       every tergite for that reason. */
    wear: 0,
    /* Grain and crease UP from the family's defaults. The membrane
       preset is authored for something merely wet; these numbers are
       still sub-facet (the finest is four centimetres on a body nine
       metres across) and they are what the measurement asked for -
       microDetail 4.0 and edgeDensity 5.1 against pool floors of 6.1
       and 8.6. The family's own ceiling argument is set by the
       THINNEST limb wearing the material, and nothing on this animal
       is thin. */
    /* CAVITY WAS 0.40, MEASURED UP TO 0.48 AND BACK, AND IS NOW 0.52 -
       and the flip is the point rather than an embarrassment.

       The old reading was correct about its own subject: with 72% of
       the frame crushed under luma 26, every extra stop of crease
       shadow moved pixels out of the band where they could hold
       spread and into the floor where they could not. Cavity buys
       contrast only until it runs out of room underneath it.

       She is a light source now. There is room underneath her
       everywhere, so the same term that was destroying contrast is
       making it - and unlike the first time it is landing on the
       largest projected area in the game rather than on a silhouette. */
    /* MOTTLE DOWN HARD, from the family's 0.15. The kit's coarse
       octave is metre-scale, and a metre-scale albedo blotch on a
       nine-metre body is not grain - it is a DISRUPTIVE PATTERN. She
       came back from the first lit shoot with pale patches the size of
       a car scattered over the abdomen, reading exactly as camouflage,
       which is the Stylite's job and the opposite of this one's: a
       lamp wants to be one continuous surface with detail UNDER it. */
    mottle: 0.15,
    /* GRAIN BACK UP, once `bindEmissiveToGrain` gave it somewhere to
       land. While the emission was flat these numbers were fighting
       for the fraction of the pixel that was still diffuse, and taking
       them higher only made the unlit dorsal noisier. With the lamp
       carrying the same modulation, the whole twenty metres is a
       surface again and the finest octave - four centimetres on a body
       nine metres across - is the thing that says it is an animal
       rather than a lampshade. */
    /* WAVELENGTH DOWN FROM THE FAMILY'S 2.4m, and this is the one
       number that was making a detailed shader read as a printed
       pattern.

       The octaves are exactly lambda, lambda/3, lambda/9, lambda/27.
       At 2.4m the third of those is 27cm, which at fighting range
       subtends about twelve pixels - big enough to resolve as a SHAPE
       and small enough to repeat many times across the body, which is
       the exact size band at which a quasi-periodic field stops
       reading as material and starts reading as a motif. Photographed,
       the abdomen came back covered in a legible chevron squiggle at
       one constant scale. Meanwhile the finest octave sat at 9cm,
       under the fade, contributing nothing - so she measured
       microDetail 5.2 against a Halo floor of 6.1 while visibly
       wearing a texture.

       At 1.45m the same four octaves land at 1.45 / 0.48 / 0.16 /
       0.054m: the motif drops to five pixels and dissolves into
       grain, and the pore octave arrives inside the resolvable band
       for the first time. Slope is amplitude times wavenumber so the
       relief steepens by two thirds at the same amplitudes, which is
       four to seven degrees of tilt - still inside the band the kit's
       own family table argues for, and nothing on this animal is thin
       enough to hit the cord failure that ceiling exists for. */
    /* BACK TO THE FAMILY'S OWN 2.4m, and this is a correction with a
       measurement behind it rather than a preference.

       It was taken to 1.45 and then 1.9 and then 2.2 to break up a
       chevron motif that was legible at conversational distance, and
       every step of that made the picture cleaner and the numbers
       worse: microDetail fell 5.2 -> 3.9 and localContrast 15.3 ->
       10.3 as the readable octave shrank past the point where a 32px
       tile could hold it. Which is the whole finding - the motif and
       the detail were the SAME SIGNAL, and shortening the wavelength
       does not separate them, it just moves both under the antialias
       fade.

       What separates them is coverage. The tergites are geometry now,
       so the large flat-ish stretches where a quasi-periodic field
       prints most legibly are under armour, and the membrane that is
       left is strongly curved and strongly lit - which is where grain
       reads as grain. Same field, half the canvas, and the half it
       kept is the half that flatters it. */
    wavelength: 2.4,
    score: 0.0034, pore: 0.0017, cavity: 0.52, gloss: 0.27,
    /* The kit's detail branch switched off NEARER than the
       family default of 40/92. She is twenty-six metres long, so
       at any fighting range the far half of her is past the fade
       and skips six transcendentals and four derivatives per
       pixel - on the largest projected area of any boss in the
       game, which is where this cost actually lands. */
    fadeNear: 42, fadeFar: 96,
    /* EMBER DOWN, hard, from the membrane family's 0.70. The kit
       lights a hot ORANGE glow in the cracks it opens as damage
       accumulates, and orange is Vesper-IX's own sand: at the
       family default a queen at 15% health came back covered in
       glowing leopard spots in the one hue this boss is under
       instruction never to wear. The kit's own header records the
       same failure on the Cantor and narrowed the crack band for
       it; this narrows the GAIN, because on her the cracks are
       correct and their colour is not. */
    ember: 0.26,
  });
  bindSurfaceToRestPose(sacMat);
  bindEmissiveToGrain(sacMat);

  const chitinMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    /* GLOSSY, per the art direction: hard violet-black plate in hard
       contrast to the soft abdomen. Two materials, unmistakably - and
       roughness is most of what makes that legible with the colour
       removed. */
    roughness: 0.31,
    /* THE HUNTER'S VIOLET SHEEN, and the only reason it works. A
       dielectric's specular is white at F0 0.04 whatever colour the
       surface is, so a violet plate under a warm sun threw a warm
       WHITE highlight and read as wet plastic. Past a little metalness
       the albedo becomes the specular colour and the plate throws a
       violet highlight instead. Kept well under 0.3: art.js records
       that past about 0.6 the diffuse term vanishes and the surface
       renders as a blurred reflection of the sky. */
    metalness: 0.16,
  });
  chitinMat.name = "sf-abbess-chitin";
  chitinMat.side = THREE.DoubleSide;
  applySurface(chitinMat, atmos, "chitin", {
    /* RIM DOWN, from 0.85, and it is the third time this file has had
       to learn the same thing from a different surface.

       The atmosphere patch's rim samples the SKY and adds it, and
       Vesper-IX's sky is pale warm. On the sac at 0.28 that put the
       district's sand along the silhouette; here at 0.85 it was doing
       it to every EDGE of every plate at once - the thorax's cylinder
       caps, the collar's rear lip, both pairs of mandibles - and
       photographed as cream-tan trim outlining the fore-body. On the
       one boss whose separation strategy is "not this district's hue",
       her armour was wearing the district's hue as piping, and no
       amount of repainting the albedo could reach it because the term
       is additive and albedo-blind. What replaces it is the plate's
       own metalness, which throws a VIOLET highlight because past a
       little metalness the albedo is the specular colour. */
    rim: 0.42, glitter: 0.08, bio: 1.0,
    /* Deeper cavity and more edge wear than the family's default. Her
       plate is the ONE part of her that is hard, old and rubbed, and
       cavity is the term that puts dark in a crease - which is the
       axis the brief calls "a creature with no dark in its creases is
       a toy", and the one the measurement calls localContrast. */
    /* WAVELENGTH DOWN FROM THE FAMILY'S 1.15m, and it is the mirror
       image of the argument on the sac two hundred lines up.

       The family number is authored for a plate on a nine-metre
       animal. Her fore-body is not that: the skull is five metres end
       to end and the thorax is four, so lambda/3 landed at 38cm - a
       third of the width of the part wearing it - and printed as a
       legible chevron across the head at any range a player ever sees
       it from. Same field, same amplitudes, at 0.75m the readable
       octave is 25cm on the sac's scale and 8cm here, which is grain.

       The rule the two cases share: WAVELENGTH TRACKS THE SIZE OF THE
       THING WEARING IT, not the size of the animal it belongs to. The
       eggs already carried that note; the head needed it too. */
    wavelength: 0.75,
    cavity: 0.48, wear: 0.15, gloss: 0.28, fadeNear: 40, fadeFar: 92,
    score: 0.0030, pore: 0.0013, ember: 0.30,
  });

  const eggMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: 0.30,
    metalness: 0.0,
  });
  eggMat.name = "sf-abbess-egg";
  /* Membrane, like the sac - they are the same tissue - but at a THIRD
     of the family's wavelength. The family's 2.4m is sized for a
     twenty-metre abdomen; on a two-metre egg it puts most of one cell
     on the whole object and the clutch comes out as a row of
     differently-tinted eggs rather than a row of eggs. Wavelength is
     the one number here that has to track the size of the thing
     wearing it. */
  applySurface(eggMat, atmos, "membrane", {
    rim: 1.2, glitter: 0, bio: 2.6, wavelength: 0.80,
  });
  bindSurfaceToRestPose(eggMat);
  bindEmissiveToGrain(eggMat);

  /* ============================================================
     THE SPILL

     Two additive shells, and they exist because the emissive channel
     cannot do the one thing a lamp does: put light on something else.
     A real light would - and would also recompile every material in
     the scene the first frame it appeared, which this game has already
     measured at 198ms of freeze. Additive geometry is the trade: no
     recompile, no shadow pass, two draw calls, and the eye reads the
     spill as light because it is in the right place with the right
     falloff.

     ONE MATERIAL for both, so they share one compiled program, and
     `forceSinglePass` because three's default two-pass DoubleSide
     transparent path would otherwise draw each of them twice for a
     depth ordering that is meaningless under additive blending.
     ============================================================ */
  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1,
    depthWrite: false, blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide, toneMapped: true,
  });
  glowMat.name = "sf-abbess-glow";
  glowMat.forceSinglePass = true;
  /* Additive surfaces fade toward BLACK, not toward the sky - see the
     note on `patchBasicMaterial`. A hazed additive shell that faded
     toward sky colour would stamp a pale wedge over the chamber. */
  patchBasicMaterial(glowMat, atmos, 0.85, true);

  /* ============================================================
     THE ABDOMEN

     Thirteen rings on a curve, rewritten every frame.

     One geometry and one draw call for the largest single object in
     the district, and the alternative was never a rig: what this
     surface does is SWELL. It breathes at rest, it runs a bulge down
     its whole length every time she lays, and it heaves off the floor
     to slam - three superimposed radial and axial deformations that a
     skeleton can only approximate with enough bones to cost more than
     the mesh.
     ============================================================ */
  const segs = C.abdomenSegments;
  const sacVerts = segs * SAC_SIDES + 1;

  /* Per-ring authored profile, measured once. `swell` is the
     physogastric bulge - narrow at the waist, widest a third of the
     way back, tapering to the ovipositor - and `band` marks the rings
     that carry a dark tergite plate, which is what makes twenty metres
     of pale sac read as SEGMENTED rather than as a sausage. */
  const rings = [];
  for (let i = 0; i < segs; i += 1) {
    const t = i / (segs - 1);
    rings.push({
      t,
      /* Fat and forward, and THICK AT THE WAIST.

         Two explicit pieces rather than one sine, because the first
         version's curve started at 0.31 of full radius - a 1.4m stalk
         emerging from a 4.3m collar plate, which read as an abdomen
         somebody had parked behind the animal rather than one growing
         out of it. It has to leave the thorax at roughly the collar's
         own width, swell to full a third of the way back, and only then
         drain away to the ovipositor. */
      swell: t < 0.38
        ? lerp(0.86, 1.0, smoothstep(t / 0.38))
        : lerp(1.0, 0.16, Math.pow(smoothstep((t - 0.38) / 0.62), 0.9)),
      /* A constriction on every second ring. This is cheaper and reads
         better than modelling separate tergites: the eye takes the
         narrow rings as the joints between plates. */
      /* Deep enough to read as a joint at forty metres. At 0.915 the
         constrictions were a suggestion and the animal came out as one
         smooth bag; a queen's segments are separate swellings with hard
         rings cinched between them. */
      /* ...and deeper again, 0.845 -> 0.80, once the membrane between
         the plates became a light source. A constriction is worth
         exactly as much contrast as there is light on either side of
         it: while the whole abdomen was one dark value the groove had
         nothing to be dark against, and edgeDensity measured 5.8
         against a Halo floor of 8.6. Every centimetre taken out of
         these six rings now buys a hard black line across a lit body,
         which is the cheapest edge on the animal. */
      pinch: i % 2 === 1 ? 0.76 : 1,
      band: i % 2 === 1,
      /* Each segment has its own idea of when the breath reaches it,
         so the whole body undulates rather than pumping as one bag. */
      phase: t * 2.4,
    });
  }

  const sac = (() => {
    const position = new Float32Array(sacVerts * 3);
    const normal = new Float32Array(sacVerts * 3);
    const colour = new Float32Array(sacVerts * 4);
    const index = [];
    /* WOUND OUTWARD, and the first build was not.
       Every ring is laid in the frame (n1, n2, tangent), which is
       right-handed - so walking s forward around the ring turns
       POSITIVELY about the tangent, and the naive `a+s, b+s, b+n` order
       puts the face normal on the inside. All three hundred triangles
       faced inward, and with front-face culling that renders as the
       near wall vanishing and the inside of the far wall showing
       through it: the animal was see-through from half the angles in
       the chamber. The vertex normals were analytic and outward the
       whole time, so it lit correctly and only the silhouette betrayed
       it. `saintfall-abbess-fight.mjs` now audits the winding against
       those normals so it cannot come back. */
    for (let i = 0; i < segs - 1; i += 1) {
      for (let s = 0; s < SAC_SIDES; s += 1) {
        const n = (s + 1) % SAC_SIDES;
        const a = i * SAC_SIDES;
        const b = (i + 1) * SAC_SIDES;
        index.push(a + s, b + n, b + s, a + s, a + n, b + n);
      }
    }
    const tip = segs * SAC_SIDES;
    const last = (segs - 1) * SAC_SIDES;
    for (let s = 0; s < SAC_SIDES; s += 1) {
      index.push(last + s, last + ((s + 1) % SAC_SIDES), tip);
    }
    /* MOTTLE, frozen at build. The per-vertex repaint below runs every
       frame and `rng()` is a sequence, not a field - drawing from it in
       there would give every vertex a different value on every frame
       and the animal would boil. Sampled once here, it stays glued. */
    const mottle = new Float32Array(sacVerts);
    for (let i = 0; i < sacVerts; i += 1) mottle[i] = 0.88 + rng() * 0.24;

    /* THE REST POSE, for the surface kit. See `bindSurfaceToRestPose`:
       this is the sac laid out as a straight cylinder along +x in
       metres, which is what the grain is glued to. It never changes,
       which is the entire point of it. */
    const objRest = new Float32Array(sacVerts * 3);
    for (let i = 0; i < segs; i += 1) {
      const ring = rings[i];
      const rr = C.abdomenRadius * ring.swell * ring.pinch;
      for (let s = 0; s < SAC_SIDES; s += 1) {
        const ang = (s / SAC_SIDES) * TAU;
        const k = (i * SAC_SIDES + s) * 3;
        objRest[k] = ring.t * C.abdomenLength;
        objRest[k + 1] = Math.cos(ang) * rr;
        objRest[k + 2] = Math.sin(ang) * rr;
      }
    }
    objRest[tip * 3] = C.abdomenLength + 1.2;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setAttribute("sfObj", new THREE.BufferAttribute(objRest, 3));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(C.lairX, floorY, C.lairZ), C.abdomenLength + 16);
    const mesh = new THREE.Mesh(geo, sacMat);
    mesh.name = "sf-abbess-sac";
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return { mesh, geo, position, normal, colour, mottle };
  })();

  /* The live spine of the abdomen: one point per ring, in world space,
     recomputed each frame. Combat reads a capsule off it - see
     `inst.sacSpine` - so the hit volume is the pose rather than a
     guess about it. */
  const spine = [];
  for (let i = 0; i < segs; i += 1) spine.push(new THREE.Vector3());
  const spineRadius = new Float32Array(segs);

  const _v = new THREE.Vector3();
  const _t = new THREE.Vector3();
  const _n1 = new THREE.Vector3();
  const _n2 = new THREE.Vector3();

  /* ============================================================
     THE TERGITES, AND WHY THEY ARE GEOMETRY NOW

     They were PAINT. Six dark rings on the sac's colour attribute,
     laid on the constricted rings, on the reasoning that a
     constriction plus a dark band reads as a joint between plates.
     It does, at eighty metres. At twenty-five it reads as a stripe:
     one smooth surface with a value change drawn on it, no lip, no
     shadow, no second material anywhere in the silhouette. The
     measurement said the same thing from the other side - edgeDensity
     7.4 against a Halo floor of 8.6, microDetail 5.2 against 6.1 -
     and paint cannot answer either of those, because both of them
     are questions about what happens at an EDGE and a painted band
     has none.

     So the plates are real shells now: six of them, one per band
     ring, arching over the dorsal 58% of the circumference, lapping
     rearward over the fat segment behind them the way a termite's
     tergites actually do. Each one buys four things paint could not:

       - a HARD RIM crossing a lit membrane. The plate comes down past
         the horizontal on both flanks, so its lower edge cuts across
         the brightest part of the lamp. That is the highest-contrast
         edge available anywhere on this animal and there are twelve
         of them.
       - a CAST SHADOW. `castShadow` is on, so each plate darkens the
         membrane under its own overhang - the "self-occlusion where
         plate meets plate" the brief asks every boss for, and the one
         thing a boss with no dark in its creases is missing.
       - TWO MATERIALS IN ONE SILHOUETTE. Hard flat-shaded chitin
         standing off soft smooth-shaded membrane, at different
         roughness, on different grain wavelengths. With the colour
         removed they are still different, which is the test.
       - THE ACCENT LANGUAGE. A hot line of brood light escaping under
         each plate's rear lip: a small saturated mark in a repeating
         designed place, on a minority of the surface. Same
         construction as the Scarab's hazard panels and the same
         reason - a big model with one material on it reads as one
         undifferentiated mass.

     ONE DRAW CALL, 198 vertices, 240 triangles, and its own material
     rather than the head's - because `chitinMat` samples the surface
     kit's grain from `position`, and this mesh's `position` is
     rewritten in world space every frame like the sac's. Same trap,
     same cure: a static `sfObj` rest pose and `bindSurfaceToRestPose`.
     ============================================================ */
  /* Which rings carry a plate. Derived from `band` rather than
     restated, so the plates cannot drift off the constrictions the
     profile actually has if that pattern is ever retuned. */
  const TERGITE_AT = [];
  for (let i = 0; i < segs; i += 1) if (rings[i].band) TERGITE_AT.push(i);
  const TERG_ARC = 15;    // angular samples across the back
  const TERG_ROWS = 4;    // leading edge (tucked), crown, lap, trailing lip
  /* The arc, in `under` terms: 0 is the spine, 1 is the belly. The
     plate runs from one flank at 0.62 over the back to the other, so
     both rims land BELOW the horizon of the body and cross lit
     membrane. A plate that stopped at the flank would have its edge
     exactly where the surface turns away from the camera, which is
     the one place an edge cannot be seen. */
  const TERG_A1 = Math.asin(0.24);              // under 0.62, one flank
  const TERG_A2 = -Math.PI - Math.asin(0.24);   // the same, the other way
  /* How far each row stands off the membrane, in fractions of the
     local radius plus a fixed pad. The leading edge tucks UNDER the
     plate in front of it (no lift at all), the crown carries the
     plate's thickness, and the lip flares - which is what makes the
     rear edge catch light and throw a shadow instead of dying into
     the surface it lies on. */
  const TERG_LIFT = [0.005, 0.045, 0.070, 0.090];
  const TERG_PAD = [0.02, 0.08, 0.13, 0.17];
  /* Axially: from three quarters of a segment in front of the
     constriction to a little past the next ring, so the plate spans
     the pinch and laps the fat segment behind it. */
  const TERG_U0 = -0.55;
  const TERG_U1 = 0.72;

  const tergiteMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    /* HARDER AND GLOSSIER THAN THE HEAD's PLATE. These are the parts
       of her armour the chamber's own light actually reaches, and the
       whole point of them is that they answer light differently from
       the membrane two centimetres underneath. */
    roughness: 0.27,
    metalness: 0.18,
  });
  tergiteMat.name = "sf-abbess-tergite";
  applySurface(tergiteMat, atmos, "chitin", {
    /* Rim low for the same reason the sac's is off - see the note on
       `sacMat`. The atmosphere's rim is the SKY's warm colour added
       along every silhouette edge, and twelve fresh silhouette edges
       is twelve fresh places for the district's sand to arrive. */
    rim: 0.22, glitter: 0.10, bio: 1.0,
    /* Half the sac's wavelength. The two surfaces are two centimetres
       apart and the eye compares them directly, so the cheapest way to
       say "different material" without touching the colour is to make
       the grain a different SIZE. */
    wavelength: 0.72,
    cavity: 0.50, wear: 0.06, gloss: 0.30, mottle: 0.16,
    score: 0.0026, pore: 0.0012, ember: 0.30,
    fadeNear: 44, fadeFar: 100,
  });
  bindSurfaceToRestPose(tergiteMat);

  const tergites = (() => {
    const per = TERG_ARC * TERG_ROWS;
    const count = TERGITE_AT.length * per;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const colour = new Float32Array(count * 4);
    const objRest = new Float32Array(count * 3);
    const index = [];
    /* WOUND OUTWARD, and the derivation matters because the arc runs
       BACKWARD. The ring frame (n1, n2, tangent) is right-handed, so
       d(radial)/d(angle) x tangent = radial - which means the obvious
       order faces outward only while the angle INCREASES with the
       column. This arc sweeps from +0.077pi down to -1.077pi, so the
       column order is reversed and the quad is (a, d, b) / (a, c, d).
       `saintfall-abbess-fight.mjs` audits every named mesh under her
       group against its own vertex normals, so a wrong guess here is
       a failed check rather than a screenshot nobody looks at. */
    for (let p = 0; p < TERGITE_AT.length; p += 1) {
      const base = p * per;
      for (let u = 0; u + 1 < TERG_ROWS; u += 1) {
        for (let v = 0; v + 1 < TERG_ARC; v += 1) {
          const a = base + u * TERG_ARC + v;
          const b = a + 1;
          const c = a + TERG_ARC;
          const d = c + 1;
          index.push(a, d, b, a, c, d);
        }
      }
    }
    /* The rest pose the grain is glued to: the same straight cylinder
       along +x, in metres, that the sac's `sfObj` uses. Both surfaces
       therefore sample ONE field in one frame, so the plate's grain
       and the membrane's grain are two crops of the same material
       rather than two unrelated patterns that happen to be adjacent. */
    for (let p = 0; p < TERGITE_AT.length; p += 1) {
      const i0 = TERGITE_AT[p];
      for (let u = 0; u < TERG_ROWS; u += 1) {
        const fi = clamp(i0 + lerp(TERG_U0, TERG_U1, u / (TERG_ROWS - 1)),
          0, segs - 1);
        const ri = rings[Math.round(fi)];
        const rr = C.abdomenRadius * ri.swell * ri.pinch * (1 + TERG_LIFT[u]);
        for (let v = 0; v < TERG_ARC; v += 1) {
          const ang = lerp(TERG_A1, TERG_A2, v / (TERG_ARC - 1));
          const k = (p * per + u * TERG_ARC + v) * 3;
          objRest[k] = (fi / (segs - 1)) * C.abdomenLength;
          objRest[k + 1] = Math.cos(ang) * rr;
          objRest[k + 2] = Math.sin(ang) * rr;
        }
      }
    }
    /* Painted once. Nothing here is a function of the fight, so the
       colour attribute is never re-uploaded - which is the whole
       reason the plates are affordable on a body that already
       rewrites 157 colours a frame. */
    for (let p = 0; p < TERGITE_AT.length; p += 1) {
      for (let u = 0; u < TERG_ROWS; u += 1) {
        for (let v = 0; v < TERG_ARC; v += 1) {
          const k = (p * per + u * TERG_ARC + v) * 4;
          const across = Math.abs(v / (TERG_ARC - 1) - 0.5) * 2;  // 0 crown, 1 rim
          /* Lit at the crown, near-black at the rims, which is what a
             curved plate under a high sun does and is also the term
             that keeps the flanks from competing with the lamp behind
             them. The mottle is per-vertex and frozen, like the
             sac's. */
          const t = (0.09 + 0.40 * (1 - across * across)) * (0.84 + rng() * 0.32);
          colour[k] = lerp(CHITIN_DARK[0], CHITIN_LIT[0], t);
          colour[k + 1] = lerp(CHITIN_DARK[1], CHITIN_LIT[1], t);
          colour[k + 2] = lerp(CHITIN_DARK[2], CHITIN_LIT[2], t);
          /* THE WORN RIM, and it is the one place on this animal that
             is allowed to go pale.

             A plate's exposed lower edge is the part that gets rubbed
             - by the floor, by her own brood, by twenty years of the
             next plate sliding over it - and a rubbed chitin edge goes
             PALE AND DESATURATED, which the surface kit's own `wear`
             term does for exactly this reason. Here it is painted
             rather than shaded, because the kit keys wear on which way
             a facet points and these rims point outward in every
             direction at once.

             It is also the cheapest legitimate edge in the frame.
             Twelve pale lines, each one lying along the boundary
             between dark armour and lit membrane, each one a hard
             value step across the brightest part of the animal - and
             `edgeDensity` is literally a count of pixels whose
             luminance gradient clears a threshold. The lines have to
             be LILAC rather than cream: the same pale-edge cue in a
             warm hue is the district's sand arriving on the one boss
             forbidden to wear it, which is how the atmosphere rim got
             turned down four paragraphs up. */
          if (across > 0.72) {
            /* ...and MUCH darker than the first attempt at it, which
               is the fourth time this file has walked into the same
               wall. At a linear 0.60/0.47/0.74 the rims were a pale
               lilac on the page and photographed KHAKI, because the
               sun's specular and the sky's rim are additive terms that
               do not care what the albedo is: the paler the paint, the
               more completely the warm light owns the pixel. The value
               STEP is what buys the edge, not the value itself, so the
               rim only has to be lighter than the near-black plate
               beside it - and at a third of the old brightness, with
               the blue channel still well clear of the red, it stays
               violet under the same light that turned the last one
               into sand. */
            const rub = sstep(0.72, 1.0, across);
            colour[k] = lerp(colour[k], 0.26, rub * 0.60);
            colour[k + 1] = lerp(colour[k + 1], 0.17, rub * 0.60);
            colour[k + 2] = lerp(colour[k + 2], 0.40, rub * 0.60);
          }
          /* THE ACCENT. Brood light escaping under the plate's rear
             lip - only the last row, only where the plate laps the
             next segment, and weighted toward the rims where the lap
             is loosest. Alpha is the bio mask, so this is emission
             through the same channel the sac's lamp uses and it
             cannot drift to a different colour than the light it is
             supposed to be leaking. */
          if (u === TERG_ROWS - 1) {
            const leak = 0.16 + 0.84 * across * across;
            colour[k] = lerp(colour[k], SAC_GLOW[0], leak * 0.70);
            colour[k + 1] = lerp(colour[k + 1], SAC_GLOW[1], leak * 0.70);
            colour[k + 2] = lerp(colour[k + 2], SAC_GLOW[2], leak * 0.70);
            colour[k + 3] = leak * 0.85;
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setAttribute("sfObj", new THREE.BufferAttribute(objRest, 3));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(C.lairX, floorY, C.lairZ), C.abdomenLength + 16);
    const mesh = new THREE.Mesh(geo, tergiteMat);
    mesh.name = "sf-abbess-tergites";
    mesh.frustumCulled = false;
    /* Casting is the point. The overhang's shadow on the membrane
       beneath it is the only self-occlusion this animal has, and the
       brief calls a creature with no dark in its creases a toy. */
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, geo, position, normal };
  })();

  /** Lay the six plates out on the spine that was just posed. Called
   *  from `poseAbdomen`, after it, never before - the plates read
   *  `spine` and `spineRadius` and a plate laid on last frame's body
   *  hangs off the animal by however far she moved. */
  function poseTergites() {
    const tp = tergites.position;
    const tn = tergites.normal;
    const per = TERG_ARC * TERG_ROWS;
    for (let p = 0; p < TERGITE_AT.length; p += 1) {
      const i0 = TERGITE_AT[p];
      for (let u = 0; u < TERG_ROWS; u += 1) {
        const fi = clamp(i0 + lerp(TERG_U0, TERG_U1, u / (TERG_ROWS - 1)),
          0, segs - 1);
        const ia = Math.min(segs - 2, Math.floor(fi));
        const fr = fi - ia;
        /* The frame comes off the SEGMENT the row sits on rather than
           off the nearest ring, so a plate spanning a constriction
           does not kink where the two ring frames disagree. */
        _t.subVectors(spine[ia + 1], spine[ia]);
        if (_t.lengthSq() < 1e-8) _t.set(0, 0, 1);
        _t.normalize();
        _n1.set(0, 1, 0);
        if (Math.abs(_t.y) > 0.92) _n1.set(1, 0, 0);
        _n1.crossVectors(_t, _n1).normalize();
        _n2.crossVectors(_t, _n1).normalize();
        _v.lerpVectors(spine[ia], spine[ia + 1], fr);
        const rad = lerp(spineRadius[ia], spineRadius[ia + 1], fr);
        for (let v = 0; v < TERG_ARC; v += 1) {
          const ang = lerp(TERG_A1, TERG_A2, v / (TERG_ARC - 1));
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          // The same belly flattening the sac uses, so the two agree.
          const squash = 1 - 0.22 * clamp01(sa);
          const rx = (_n1.x * ca + _n2.x * sa) * squash;
          const ry = (_n1.y * ca + _n2.y * sa) * squash;
          const rz = (_n1.z * ca + _n2.z * sa) * squash;
          const r = rad * (1 + TERG_LIFT[u]) + TERG_PAD[u];
          const k = (p * per + u * TERG_ARC + v) * 3;
          tp[k] = _v.x + rx * r;
          tp[k + 1] = _v.y + ry * r;
          tp[k + 2] = _v.z + rz * r;
          tn[k] = rx; tn[k + 1] = ry; tn[k + 2] = rz;
        }
      }
    }
    tergites.geo.attributes.position.needsUpdate = true;
    tergites.geo.attributes.normal.needsUpdate = true;
  }

  /* ============================================================
     THE BROOD LIGHT

     One number that every lit thing on her reads, so the lamp, the
     spill, the veins, the weak point and the eggs cannot drift apart.
     ============================================================ */

  /** 0 while she is whole, 1 as she dies. Drives the sickening. */
  function sickness() {
    if (!inst || !inst.maxHealth) return 0;
    return clamp01(1 - inst.health / inst.maxHealth);
  }

  /** How open the ventral weak point is, on the same threshold combat
   *  uses for it (`HITBOX.abbess.ventral.open`). The light and the hit
   *  volume have to agree or the player is aiming at a lie. */
  function ventralOpen() {
    return sstep(0.16, 0.62, state.raised);
  }

  /* The lamp's colour, rebuilt only when the health band it depends on
     actually moves. Allocating three numbers per frame is nothing; the
     point is that everything downstream reads ONE array. */
  const glowRGB = [SAC_GLOW[0], SAC_GLOW[1], SAC_GLOW[2]];
  let glowSick = -1;
  function broodColour() {
    const sick = sickness();
    if (Math.abs(sick - glowSick) > 0.01) {
      glowSick = sick;
      /* Normalised to a peak channel of 1 - see the palette note. An
         additive shell built from an un-normalised saturated colour
         clips its hot channel first and the whole thing goes white. */
      let peak = 0;
      for (let c = 0; c < 3; c += 1) {
        glowRGB[c] = lerp(SAC_GLOW[c], SAC_SICK[c], sick);
        peak = Math.max(peak, glowRGB[c]);
      }
      for (let c = 0; c < 3; c += 1) glowRGB[c] /= Math.max(1e-4, peak);
    }
    return glowRGB;
  }

  /* ============================================================
     REPAINTING THE SAC

     Per-vertex, per-frame, and it is affordable for exactly one
     reason: there are 157 vertices on this mesh. The gain is that the
     light in her can MOVE - travel down the body, flare on the weak
     point when the fight opens it, and sicken as she dies - none of
     which a colour attribute written once at load can do.

     The mottle is NOT redrawn here; it is frozen at build. See the
     note where it is sampled.
     ============================================================ */
  function paintSac() {
    const col = sac.colour;
    const mot = sac.mottle;
    const g = broodColour();
    const wake = clamp01(state.woken);
    /* The lamp does not come on with the pose. It comes on AFTER it,
       squared, so the rouse reads as a body lifting and then lighting
       rather than as a light on a dimmer. */
    const lit = wake * wake * (state.deathT >= 0
      ? clamp01(1 - state.deathT / 3.2) : 1);
    const open = ventralOpen();
    const sick = sickness();

    for (let i = 0; i < segs; i += 1) {
      const ring = rings[i];
      /* SOMETHING MOVING IN IT. Two slow travelling waves at
         incommensurate rates, so the brood light never repeats a
         pattern the eye can lock onto - which is what separates "a
         lamp with something alive in it" from "a lamp". */
      const churn = 1
        + 0.30 * Math.sin(atmos.elapsed * 0.83 - ring.t * 4.6)
        + 0.16 * Math.sin(atmos.elapsed * 1.97 + ring.t * 8.1);
      /* ...and a stutter as she dies, on top of it. */
      const flicker = sick > 0.45
        ? 1 - 0.30 * sick * Math.max(0, Math.sin(atmos.elapsed * 11.3 + ring.t * 2))
        : 1;
      for (let s = 0; s < SAC_SIDES; s += 1) {
        const vi = i * SAC_SIDES + s;
        const k = vi * 4;
        /* SIN, NOT COS - the ring frame's `n1` is horizontal and `n2`
           points DOWN (see `poseAbdomen`), so the cosine term runs
           across her flanks and the sine term runs belly-to-back. Built
           on cosine, this whole ramp painted one side of her pale and
           the other dark, and the animal read as flat because its only
           value gradient was at ninety degrees to the light. */
        const under = clamp01(Math.sin((s / SAC_SIDES) * TAU) * 0.5 + 0.5);
        /* Belly lit, back dark, and the ramp is HARD. She is lit from
           inside and from below by her own chamber and from above by
           nothing; a gentle ramp across that reads as a smooth object
           rather than as a body. */
        /* THE RAMP IS A BORDER, NOT A GRADIENT, and getting here took
           two wrong answers in a row.

           The first was linear, which put the ramp's MIDDLE - a warm
           pink at half value - across the whole of her flanks. The
           chamber's ambient is warm, so most of the animal came back
           reading as tan: the district, on the boss.

           The second was that same ramp raised to a power, which cured
           the tan by making the flanks DARK - and measured worse. She
           came back at meanLuma 25.2 against a Halo pool band of
           31.4-91.6, with 72.5% of the frame crushed under luma 26
           against a ceiling of 55.3. Both failures have one cause: the
           flank is most of her projected area, and it was being asked
           to carry the TRANSITION. Whatever value the transition sits
           at is the value the animal reads as, and there is no value in
           the middle of this ramp that is not either sand or mud.

           So the transition does not live on the flank any more. It is
           a smoothstep with both edges up in the DORSAL quarter: the
           belly and both flanks are the lamp at full, the top third is
           SAC_DEEP's violet-black, and the border between them is a
           hard line running the length of her. Two families, unequal in
           area, with an edge - which is the Scarab's construction and
           is also, not by accident, what a physogastric queen looks
           like: opaque tergites over a lit membrane.

           `under` is 1 at the belly, 0.5 at the flank, 0 at the spine.
           AND THE BORDER SITS HIGH - 0.03/0.30, not the 0.15/0.50 this
           was first written at. The chase camera in this game looks
           slightly DOWN at a seated animal, so the band of the body it
           actually photographs runs from the spine to a little past the
           shoulder: `under` between 0 and about 0.6. A border in the
           middle of that puts the transition across the entire visible
           surface, which is the same defect as the linear ramp wearing
           a different mask - and it measured like one, moving meanLuma
           by a single point. Pushed up to the dorsal sixth, the camera
           sees lamp with a dark spine on it, which is what it is. */
        const pale = sstep(0.03, 0.30, under) * mot[vi]
          * lerp(1.0, 0.82, ring.t);
        /* A band is chitin; everything else is membrane. Two ramps
           rather than one, so the plates read as armour laid over the
           sac instead of as shadow on it. */
        /* ...and the bands are held DOWN, hard, rather than merely
           being a dimmer version of the same ramp. With the membrane
           now lit to full across both flanks, the tergites are the only
           dark left on the lower two-thirds of the animal, and the
           alternation between them is where every edge in her
           silhouette comes from: six near-black rings over twenty
           metres of lamp. At the 0.5 this carried they were a shade,
           and the abdomen photographed as one continuous bag. */
        const from = ring.band ? SAC_BAND : SAC_DEEP;
        const to = ring.band ? CHITIN_LIT : SAC_PALE;
        const t = ring.band ? pale * 0.30 : pale;
        let r = lerp(from[0], to[0], t);
        let gg = lerp(from[1], to[1], t);
        let b = lerp(from[2], to[2], t);

        /* THE VENTRAL WEAK POINT, and it has to be a PLACE rather than
           a coordinate. It sits on the belly of the fat forward third -
           the part of her that is over the player's head when the
           abdomen comes up - and it is hotter, wetter and more
           saturated than any other square metre of the animal. It is
           already lit while she is merely seated, so a player can find
           it before they ever need it; it flares when the slam opens
           the hit volume, on the same threshold combat tests. */
        const weak = sstep(0.72, 0.99, under)
          * sstep(0.12, 0.24, ring.t) * (1 - sstep(0.44, 0.60, ring.t));
        const heat = weak * (0.45 + open * 0.55) * lit;
        if (heat > 0) {
          /* IT HAS TO OUT-READ ITS OWN LAMP. While the belly was dark
             the weak point could be "the hot bit"; now that the whole
             lower half of her is hot rose, hue alone cannot mark it and
             a player looking for somewhere to aim would be looking at
             twenty metres of the same colour. So the core goes up the
             VALUE scale toward white-hot, on top of the brood colour,
             and only in the last third of the heat - which keeps the
             surrounding membrane saturated and puts one small bleached
             patch in the middle of it. */
          const core = sstep(0.55, 1.0, heat);
          const cr = lerp(g[0], WEAK_CORE[0], core);
          const cg = lerp(g[1], WEAK_CORE[1], core);
          const cb = lerp(g[2], WEAK_CORE[2], core);
          r = lerp(r, cr, heat * 0.9);
          gg = lerp(gg, cg, heat * 0.9);
          b = lerp(b, cb, heat * 0.9);
        }
        /* THE VEINS, and they are the reason the cross-section went
           from twelve sides to twenty-two.

           A stretched brood membrane is not evenly translucent: it is
           thin between the ducts and thick over them, so backlighting
           it prints a set of bright lengthwise channels with dark
           cords between. Nothing on this animal was doing that. The
           kit's grain is isotropic by construction - it is a gyroid,
           it has no preferred direction anywhere in it, which is
           exactly right for pores and exactly wrong for plumbing - so
           twenty metres of lamp had no structure running ALONG it at
           all, and the only lengthwise information in the whole body
           was the tergites.

           Five channels around the circumference, drifting rearward
           with the ring so they braid rather than running as straight
           stripes, and modulating BOTH albedo and emission - a vein
           that only brightened the glow would read as a light behind
           a stencil, whereas thickness changes what the membrane is
           as well as what gets through it.

           Five is set by the vertex count and not by taste: at
           twenty-two sides a five-cycle wave has four and a half
           samples per cycle, and anything past six starts aliasing
           into a moire that travels as she breathes. */
        const duct = 0.5 + 0.5 * Math.sin((s / SAC_SIDES) * TAU * 5
          + ring.t * 6.1 + mot[vi] * 1.4);
        const ductLit = 1 + (duct - 0.5) * 0.34 * pale;
        r *= ductLit; gg *= ductLit; b *= ductLit;

        col[k] = r;
        col[k + 1] = gg;
        col[k + 2] = b;

        /* THE ALPHA is the bio mask: `albedo * alpha * bio` is added
           as emission. A tergite emits nothing - it is armour - and
           her back barely does, so the light reads as coming from
           INSIDE and escaping where the membrane is thinnest. Values
           over 1 are deliberate and are not clamped anywhere: above the
           material's gain of 1.55 they clear the bloom threshold, which
           is the whole difference between a bright surface and a light
           source. */
        /* AND THE EMISSION FOLLOWS THE SAME BORDER, not `under` raw.
           These two used to disagree: the albedo had a hard edge at the
           dorsal quarter and the emission had a soft linear one running
           all the way to the spine, so the top of her was dark paint
           with a faint glow on it - which is a painted surface, not a
           lit one. Sharing `pale` means the membrane emits exactly
           where it is translucent and the tergites emit nothing, which
           is the difference between light coming THROUGH her and light
           painted ON her.

           The gain more than doubled at the same time, and that is the
           measurement talking rather than taste: emission here is
           `albedo * alpha * bio`, and at the old 0.14-0.48 the belly's
           emissive landed around 0.24 of albedo - under the bloom
           chain's threshold, which is precisely the line between a pale
           surface and a light source. The thing this animal is FOR is
           being the only lamp in a dark chamber. */
        const vein = (ring.band ? 0.04
          : (0.52 + ring.t * 0.52) * (0.10 + pale * 0.90) * churn * flicker)
          /* ...and the ducts modulate what gets THROUGH as well as
             what the membrane looks like. Stronger here than on the
             albedo, because a channel of brood light is mostly a
             transmission story. */
          * (0.72 + duct * 0.56);
        /* CEILING AT 1.8, and it is a composition decision rather than
           a safety one. Nothing clamps this on the way to the shader,
           and at the 2.4 it was first written the weak point pushed
           every channel past 1 and the hot core rendered WHITE - which
           throws away the one saturated hue in the frame at exactly
           the point the frame is about. At 1.8 the red channel clips
           and the other two do not, so the core stays rose and only
           its very centre goes white through the bloom. */
        col[k + 3] = clamp((vein + heat) * lit, 0, 1.8);
      }
    }
    /* The ovipositor. Brightest point on her that is not the weak
       point, because the light in her runs backward down the body
       toward where the eggs come out - which is the one cue that tells
       a player at range which end of a twenty-six-metre animal to walk
       around. */
    {
      const k = (segs * SAC_SIDES) * 4;
      col[k] = lerp(SAC_VEIN[0], g[0], 0.5);
      col[k + 1] = lerp(SAC_VEIN[1], g[1], 0.5);
      col[k + 2] = lerp(SAC_VEIN[2], g[2], 0.5);
      col[k + 3] = 1.15 * lit;
    }
    sac.geo.attributes.color.needsUpdate = true;
  }

  /* ============================================================
     THE SPILL GEOMETRY

     A belly shell and a floor pool, both additive, both rewritten from
     the same spine the sac is drawn from so they cannot drift off it.

     The shell is a HALF cylinder: only the lower sides get vertices,
     because the top of her is armour and a glow that wrapped the whole
     body would read as a force field rather than as light coming out
     of a belly. The pool is a fan on the chamber floor with its
     heights sampled off the terrain, for the reason the ground-FX
     notes give: a flat quad under a creature on uneven ground either
     buries its far edge or floats it.
     ============================================================ */
  /* THE WHOLE BODY, not the forward nine rings, and the arc is wider
     than it was.

     The shell was built as a pool of light under the fat third on the
     reasoning that that is where the brood is. Measured, that was the
     wrong trade: the emissive channel makes a surface bright, and the
     only thing that makes a surface read as a LIGHT is haze standing
     off it - and haze on the front half of a twenty-six metre animal
     is a lamp with a dark object attached to the back of it. Ringed
     one-for-one with the sac's own segments (GLOW_RINGS === segs, so
     the mapping below is the identity and the shell cannot slide off
     the body it belongs to) and taken round past the flanks, she has a
     glow ATTACHED TO HER SHAPE rather than a puddle in her middle.

     Still not the top: the tergites are armour, and a shell that
     closed over the spine would read as a force field. */
  const GLOW_RINGS = 13;     // === segs: one shell ring per body ring
  const GLOW_SIDES = 9;      // the lower two-thirds of the circumference
  /* FORTY-EIGHT, up from thirty and twenty-two before that, and the
     reason has been geometric every time: see the ring note below.
     The last raise was the contact occlusion - a body-shaped dark
     patch resolved on thirty spokes is a body-shaped POLYGON. */
  const POOL_SIDES = 48;
  /* The pool's edge, jittered ONCE. A perfect circle of light on a
     floor is a projector; the same disc with its radius wobbling by a
     fifth reads as a lamp with a body in front of it. Frozen at build
     for the reason the sac's mottle is - a field redrawn from `rng()`
     every frame boils. */
  /* How far the pool floats over the height field. Nine centimetres
     was under the aeolian ripple's own amplitude, so the disc dived
     through the ground it was lying on and came back cut into hard
     straight-edged black wedges that read as broken geometry. */
  const POOL_LIFT = 0.26;
  const poolEdge = new Float32Array(POOL_SIDES);
  for (let s = 0; s < POOL_SIDES; s += 1) poolEdge[s] = 0.78 + rng() * 0.44;

  /* Both spill meshes are WOUND OUTWARD AND CARRY NORMALS - see the
     derivation above `glowPool`, which applies to this one too. */
  const glowShell = (() => {
    const count = GLOW_RINGS * GLOW_SIDES;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const colour = new Float32Array(count * 3);
    const index = [];
    for (let i = 0; i < GLOW_RINGS - 1; i += 1) {
      for (let s = 0; s < GLOW_SIDES - 1; s += 1) {
        const a = i * GLOW_SIDES + s;
        const b = (i + 1) * GLOW_SIDES + s;
        index.push(a, b + 1, b, a, a + 1, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 3));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(C.lairX, floorY, C.lairZ), C.abdomenLength + 22);
    const mesh = new THREE.Mesh(geo, glowMat);
    mesh.name = "sf-abbess-glow-shell";
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.visible = false;
    decor.add(mesh);
    return { mesh, geo, position, normal, colour };
  })();

  /* THE POOL GREW A SECOND RING, and the reason is a falloff shape
     rather than a size.

     A fan from a lit centre to a black rim is a LINEAR ramp, and a
     linear ramp over seventeen metres of floor spends most of its area
     below half brightness - so widening it to cover more of the
     chamber made the light thinner everywhere instead of covering more
     ground, and darkPct did not move. Real spill from a long lamp
     lying two metres above a floor is nearly flat underneath it and
     then falls off a cliff at the edge of the source.

     Rings give exactly that: a bright plateau out to a third of the
     radius, a shoulder, then the drop. Sixty extra vertices, the same
     one draw call, and the same material.

     AND THEN THREE RINGS RATHER THAN TWO, AND THIRTY SIDES RATHER THAN
     TWENTY-TWO, because two rings at twenty-two sides came back with a
     hard jagged pink edge across the chamber floor that read as a
     rendering fault. It was one: a fan triangle from the centre to a
     ring twenty-one metres out spans ten metres of GROUND, the ground
     is not flat, and a flat triangle laid over it dives through the
     terrain and gets clipped by it. The disc was not too bright, it
     was too COARSE - the same trap the ground-FX notes record for a
     flat quad under a creature on uneven ground, arriving again the
     moment the disc was widened. Radii and gains are a table so the
     falloff can be reshaped without touching the mesh. */
  /* SIX RINGS, AND THE TAIL IS THE POINT.

     Three rings was a plateau and a cliff, and it measured like one:
     the lit floor was a bright patch with a hard boundary and
     everything past the boundary was still crushed. darkPct counts
     pixels under luma 26, and the cheapest pixels to move out of that
     band are not the ones under the lamp - those are already out of
     it - but the several thousand square metres of chamber floor at
     luma 12 that only need lifting to 30. A long dim tail is worth
     more to this frame than a brighter core, and it costs nothing
     extra: the fill is the same disc either way, the gains are a
     table.

     The finer radial sampling is a correctness fix on top of that.
     A fan triangle from a ring at 7m to one at 21m spans FOURTEEN
     metres of ground, the chamber floor is not flat, and a flat
     triangle laid across it dives through the terrain and gets
     clipped by it - which photographed as a hard jagged pink polygon
     with straight edges, exactly the "rendering fault" read the
     ground-FX notes warn about for a flat quad on uneven ground. Six
     rings put the longest span at four metres. Same one draw call,
     180 vertices instead of 90. */
  const POOL_RINGS = [
    { r: 0.16, gain: 0.95 },
    { r: 0.34, gain: 0.88 },
    { r: 0.52, gain: 0.64 },
    { r: 0.70, gain: 0.40 },
    { r: 0.86, gain: 0.18 },
    { r: 1.00, gain: 0.00 },
  ];
  /* ---- AND THE POOL IS NOT FLAT LIGHT ---------------------------
     The single largest failure in this animal's frames was not on
     the animal. An additive disc with a smooth radial falloff is a
     GRADIENT: thirty-odd percent of the picture carrying no edge and
     no grain anywhere in it, and worse, sitting on top of the chamber
     floor's own ripple and rock and drowning it - because additive
     light is a constant added in LINEAR space, and the tone curve's
     slope falls as it rises, so a bright wash compresses whatever
     texture was underneath it. Measured, that one surface took
     edgeDensity from 7.4 to 4.9 and microDetail from 5.2 to 4.2 while
     every other change in the round was making the animal better.

     The cure is not a dimmer lamp - dimmer only drops the floor back
     into the tone curve's toe, where its contrast is crushed from the
     other end, and that measured worse still. The cure is that the
     light itself has STRUCTURE, which is also the truth of it: this
     is light through a twenty-metre translucent abdomen full of eggs,
     with tergites across it and a body between it and the floor. Real
     spill from that is blotched, not smooth.

     Two low-frequency angular trains at incommensurate rates - so the
     pattern never repeats around the disc - plus a small per-vertex
     jitter to break the trains' own regularity. Frozen at build for
     the reason the sac's mottle is: a field redrawn from `rng()` each
     frame boils. */
  const poolMottle = new Float32Array(POOL_SIDES * POOL_RINGS.length);
  for (let r = 0; r < POOL_RINGS.length; r += 1) {
    for (let s = 0; s < POOL_SIDES; s += 1) {
      const a = (s / POOL_SIDES) * TAU;
      poolMottle[r * POOL_SIDES + s] = clamp(
        0.74 + 0.30 * Math.sin(a * 3 + r * 1.7)
        + 0.20 * Math.sin(a * 7 - r * 2.9)
        + (rng() - 0.5) * 0.26, 0.22, 1.5);
    }
  }

  /* WOUND OUTWARD, AND CARRYING NORMALS, and neither is decoration on
     an additive DoubleSide mesh that renders identically either way.

     Both of these were wrong on the first build and `saintfall-abbess-
     fight.mjs` is what said so: it traverses every NAMED mesh under her
     group and audits face winding against the vertex normals, because
     the sac and the eggs both shipped inside-out once and lighting is
     no guard against it. A glow shell with no `normal` attribute
     crashed that audit outright, and once the normals existed the
     audit reported exactly what the derivation says - the obvious
     index order in a right-handed ring frame faces every triangle
     INWARD, and the obvious fan order faces a ground quad DOWN. Both
     are the same trap this project has recorded twice already. */
  const glowPool = (() => {
    const count = POOL_SIDES * POOL_RINGS.length + 1;
    const position = new Float32Array(count * 3);
    /* Straight up, and static - the pool is a floor, so its normal is
       the one thing about it that never changes. */
    const normal = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) normal[i * 3 + 1] = 1;
    const colour = new Float32Array(count * 3);
    const index = [];
    for (let s = 0; s < POOL_SIDES; s += 1) {
      const n = (s + 1) % POOL_SIDES;
      // Reversed from the obvious order: see the winding note above.
      index.push(0, 1 + n, 1 + s);
      for (let r = 0; r + 1 < POOL_RINGS.length; r += 1) {
        const a = 1 + r * POOL_SIDES + s;
        const b = 1 + r * POOL_SIDES + n;
        const c = 1 + (r + 1) * POOL_SIDES + s;
        const d = 1 + (r + 1) * POOL_SIDES + n;
        index.push(a, d, c, a, b, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 3));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(C.lairX, floorY, C.lairZ), 40);
    const mesh = new THREE.Mesh(geo, glowMat);
    mesh.name = "sf-abbess-glow-pool";
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.visible = false;
    decor.add(mesh);
    return { mesh, geo, position, colour };
  })();

  /** Lay both spill meshes out from the spine that was just posed. */
  function poseGlow() {
    const g = broodColour();
    const wake = clamp01(state.woken);
    const lit = wake * wake * (state.deathT >= 0
      ? clamp01(1 - state.deathT / 3.2) : 1);
    const open = ventralOpen();
    if (lit < 0.02) {
      glowShell.mesh.visible = false;
      glowPool.mesh.visible = false;
      return;
    }

    /* ---- the belly shell ---- */
    const gp = glowShell.position;
    const gn = glowShell.normal;
    const gc = glowShell.colour;
    for (let i = 0; i < GLOW_RINGS; i += 1) {
      const t = i / (GLOW_RINGS - 1);
      const ring = rings[Math.min(segs - 1, i)];
      const a = spine[Math.max(0, i - 1)];
      const b = spine[Math.min(segs - 1, i + 1)];
      _t.subVectors(b, a);
      if (_t.lengthSq() < 1e-8) _t.set(0, 0, 1);
      _t.normalize();
      _n1.set(0, 1, 0);
      if (Math.abs(_t.y) > 0.92) _n1.set(1, 0, 0);
      _n1.crossVectors(_t, _n1).normalize();
      _n2.crossVectors(_t, _n1).normalize();
      /* Just proud of the shell. Any further and it detaches into a
         halo; any nearer and it z-fights the body it is lighting. */
      const r = spineRadius[Math.min(segs - 1, i)] * 1.045 + 0.10;
      /* Brightest under the weak point, falling away fore and aft, so
         the spill agrees with the albedo the sac was just painted
         with rather than being a second opinion about where she
         glows. */
      const weak = sstep(0.10, 0.26, ring.t) * (1 - sstep(0.42, 0.72, ring.t));
      /* AND THE SHELL KNOWS WHERE THE PLATES ARE. This is the one line
         that stopped the spill from undoing the body.

         An additive shell draws IN FRONT of the surface it is lighting,
         so a shell with an even gain along the animal paints over every
         dark tergite it passes - and the first full-length build did
         exactly that: meanLuma cleared the pool floor and edgeDensity
         did not move a pixel, because twenty metres of carefully
         alternating plate and membrane had been washed into one soft
         pink bag. Light does not leave armour. Dimmed hard over the
         band rings, the spill and the albedo agree about what she is
         made of, and the rings survive being lit. */
      const gain = lit * (0.50 + weak * (0.86 + open * 1.05))
        * (ring.band ? 0.26 : 1);
      for (let s = 0; s < GLOW_SIDES; s += 1) {
        /* The lower arc only: from a quarter turn before straight-down
           to a quarter turn after it. `n2` is down, so the belly is at
           a phase of a quarter turn. */
        const ang = TAU * (0.02 + (s / (GLOW_SIDES - 1)) * 0.46);
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const k = (i * GLOW_SIDES + s) * 3;
        const rx = _n1.x * ca + _n2.x * sa;
        const ry = _n1.y * ca + _n2.y * sa;
        const rz = _n1.z * ca + _n2.z * sa;
        gp[k] = spine[Math.min(segs - 1, i)].x + rx * r;
        gp[k + 1] = spine[Math.min(segs - 1, i)].y + ry * r;
        gp[k + 2] = spine[Math.min(segs - 1, i)].z + rz * r;
        // Radial, so the winding audit has something true to check against.
        gn[k] = rx; gn[k + 1] = ry; gn[k + 2] = rz;
        /* Falls off toward the edges of the arc AND toward the ends of
           the body, so the shell has no hard rim anywhere. A hard rim
           is what makes an additive shell read as a decal. */
        const edge = Math.sin((s / (GLOW_SIDES - 1)) * Math.PI);
        const f = gain * edge * (0.42 + 0.58 * Math.sin(Math.PI * clamp01(t)));
        gc[k] = g[0] * f;
        gc[k + 1] = g[1] * f;
        gc[k + 2] = g[2] * f;
      }
    }
    glowShell.geo.attributes.position.needsUpdate = true;
    glowShell.geo.attributes.normal.needsUpdate = true;
    glowShell.geo.attributes.color.needsUpdate = true;
    glowShell.mesh.visible = true;

    /* ---- the pool she throws on the chamber floor ---- */
    const pp = glowPool.position;
    const pc = glowPool.colour;
    const mid = spine[3];
    /* It DIMS as she lifts, and that is the physical read rather than
       a dramatic one: the lamp moving nine metres away from the floor
       spreads the same light over a much larger patch. The player sees
       the floor go dark under her a beat before it is hit. */
    const height = Math.max(0.6, mid.y - groundAt(mid.x, mid.z));
    /* BIG. Twenty-two metres of chamber floor at its widest, which
       sounds enormous until you remember what is casting it: a
       twenty-metre lamp two metres off the ground.

       AND THEN CAPPED AGAIN, at seventeen. This is an additive pass
       with no depth write over a large piece of ground on a frame that
       is already GPU fill-bound, and it is the single most expensive
       thing this round added: a paired audit (Abbess normalised
       against the Distaff in the same run, because eight agents on one
       machine make absolute milliseconds meaningless) put it at about
       0.19ms on its own at twenty-six metres. Seventeen buys most of
       the picture back for well under half the fill. */
    /* AND THEN OUT AGAIN, to twenty-one, once the falloff had a
       plateau in it. The seventeen-metre cap was the right call
       against a linear ramp - past that the extra fill was buying
       almost nothing, because everything it added was in the dim tail.
       With the mid ring holding the brightness flat under her, the
       extra four metres are real lit floor: the ground's own aeolian
       ripple and its rocks come up out of the crush, which is where
       edgeDensity and microDetail live on the two thirds of the frame
       that is not the animal. Re-audited, not assumed - see the
       report. */
    const radius = clamp(13 + height * 1.2, 13, 22);
    /* BRIGHTER, and this is the cheapest legitimate luminance on the
       whole animal because it is not on the animal. The chamber floor
       is the largest dark area in every frame she appears in; a lamp
       two metres above it that does not visibly light it is a lamp the
       renderer does not believe in. Raised from 0.80 rather than
       widening the disc, because the radius is fill and the gain is
       not: same pixels, more light. */
    const centre = lit * (1.24 + open * 0.42) * (4.6 / (3.4 + height));
    /* HOW HARD SHE OCCLUDES HER OWN SPILL, and the fact that she does
       at all is what turns a lamp into an animal standing on a floor.

       An additive pool drawn over the ground has no idea the ground is
       under twenty metres of body, so it painted its brightest pink
       straight across the one place the frame most needed dark - the
       contact. She came back looking laid ON the chamber rather than
       resting IN it, and the brief's first debt to the frame is "a
       contact shadow where it meets the ground; nothing looks placed
       without one".

       This is not a shadow map and does not want to be. The lamp IS
       the body, so the floor it cannot reach is exactly the floor its
       own belly is pressed against: an analytic distance to the spine
       polyline in XZ, full dark inside the contact patch, full
       brightness by the time you are a body-width clear. Which also
       means it OPENS as she heaves - `raised` lifts the belly off the
       floor and the light gets under her, so the ground brightens
       under the abdomen a beat before it is hit. That is the slam's
       telegraph, paid for by a term that was already needed. */
    const occlude = 0.45 * (1 - clamp01(state.raised) * 0.82);
    const floorLit = (px, pz) => {
      let best = 1e9;
      for (let i = 0; i + 1 < segs; i += 1) {
        const ax = spine[i].x; const az = spine[i].z;
        const bx = spine[i + 1].x; const bz = spine[i + 1].z;
        const ex = bx - ax; const ez = bz - az;
        const len2 = ex * ex + ez * ez;
        const u = len2 > 1e-6
          ? clamp01(((px - ax) * ex + (pz - az) * ez) / len2) : 0;
        const dx = px - (ax + ex * u);
        const dz = pz - (az + ez * u);
        /* Relative to the LOCAL radius, so the dark patch is the
           animal's own tapering footprint rather than a capsule
           somebody guessed at. */
        const rr = Math.max(0.4, lerp(spineRadius[i], spineRadius[i + 1], u));
        best = Math.min(best, Math.hypot(dx, dz) / rr);
      }
      return 1 - occlude * (1 - sstep(0.40, 1.70, best));
    };
    /* AND THE FLOOR IS NOT THE LAMP'S COLOUR, which is both physics
       and the whole composition.

       Additive geometry adds the SOURCE's colour, so the pool was
       painting the chamber floor in undiluted rose - and once it was
       bright enough to matter, the largest surface in the frame had
       the same hue as the animal standing on it. That is the boss
       wearing its own light, which is the same failure as a boss
       wearing its district's sand with the sign flipped: one hue
       family, two exposures.

       Real spill takes the ALBEDO of what it lands on, and this floor
       is Vesper-IX's warm brown. Pulling a quarter of the chroma out
       of the pool and biasing what is left toward the ground's own
       warmth gives the frame two families again - a rose animal in a
       warm-lit hollow - for four multiplies a frame. */
    const pg = [0, 0, 0];
    {
      const lum = g[0] * 0.2126 + g[1] * 0.7152 + g[2] * 0.0722;
      pg[0] = lerp(g[0], lum * 1.34, 0.30);
      pg[1] = lerp(g[1], lum * 1.02, 0.30);
      pg[2] = lerp(g[2], lum * 0.86, 0.30);
    }
    const cy = groundAt(mid.x, mid.z) + POOL_LIFT;
    const c0 = centre * floorLit(mid.x, mid.z);
    pp[0] = mid.x; pp[1] = cy; pp[2] = mid.z;
    pc[0] = pg[0] * c0; pc[1] = pg[1] * c0; pc[2] = pg[2] * c0;
    /* Every ring walks the SAME jittered edge profile, so the plateau,
       the shoulder and the rim are one irregular shape at three scales
       rather than a wobbly disc inside a round one - which would read
       as three objects.

       The jitter is DAMPED toward the middle, though. A twenty percent
       radial wobble is a lamp with a body in front of it when it is
       the outline; on the bright inner ring it is a visible star, and
       a star with a hard bright edge is a decal. */
    for (let r = 0; r < POOL_RINGS.length; r += 1) {
      const ring = POOL_RINGS[r];
      const wob = lerp(0.35, 1, r / (POOL_RINGS.length - 1));
      const gain = centre * ring.gain;
      for (let s = 0; s < POOL_SIDES; s += 1) {
        const ang = (s / POOL_SIDES) * TAU;
        const rr = radius * ring.r * lerp(1, poolEdge[s], wob);
        const px = mid.x + Math.cos(ang) * rr;
        const pz = mid.z + Math.sin(ang) * rr;
        const k = (1 + r * POOL_SIDES + s) * 3;
        pp[k] = px;
        pp[k + 1] = groundAt(px, pz) + POOL_LIFT;
        pp[k + 2] = pz;
        /* ...and the blotches DRIFT. One slow travelling term on top
           of the frozen field, at the same unhurried rate as the churn
           inside her, so the light on the floor moves the way light
           through something alive does. It is smooth in space, so it
           cannot boil the way a per-vertex redraw would. */
        const f = gain * floorLit(px, pz) * poolMottle[r * POOL_SIDES + s]
          * (1 + 0.16 * Math.sin(atmos.elapsed * 0.61 + ang * 2 - r));
        pc[k] = pg[0] * f; pc[k + 1] = pg[1] * f; pc[k + 2] = pg[2] * f;
      }
    }
    glowPool.geo.attributes.position.needsUpdate = true;
    glowPool.geo.attributes.color.needsUpdate = true;
    glowPool.mesh.visible = true;
  }

  /**
   * Lay the abdomen out and write its geometry.
   *
   * The axis is an arc, not a line: it leaves the thorax level, sags
   * under its own mass through the middle, and lifts at the ovipositor.
   * `raised` rotates the whole arc about the waist, which is what makes
   * the slam one number rather than a choreography.
   */
  /* WHETHER THERE IS AN ANIMAL TO DRAW.

     `woken` used to be the only answer, and it crosses 0.02 about five
     frames INTO the rouse - so the reveal camera opened on an empty
     chamber and she blinked into it. The rouse is now shown from its
     first frame; everything else it does (the light coming up, the
     brood glow) still rides `woken`. */
  function shown() {
    return state.woken > 0.02 || state.phase === "rouse" || state.deathT >= 0;
  }

  function poseAbdomen(dt, force = false) {
    /* A DORMANT QUEEN COSTS NOTHING, and this is where she used not to.
       Every frame of the entire game rewrote 157 positions, 157
       normals and 157 colours of an invisible mesh and flagged three
       buffer uploads for them. The Stylite's dormant pose solve cost
       this game 1.3ms/frame and surfaced as THIS boss's budget
       failing; the same mistake was sitting inside this file the whole
       time. Gated on there being something on screen - and `force`
       exists because `ensureSpawned`, `resetToSeat` and `restore` all
       need a spine written for combat.js to read a hit volume off
       before she is ever visible. */
    // A corpse does not move. Once the settle is over, nothing is written.
    if (!force && state.deathT >= 8.9) return;
    if (!force && !shown() && state.raised === 0) {
      if (sac.mesh.visible) {
        sac.mesh.visible = false;
        tergites.mesh.visible = false;
        glowShell.mesh.visible = false;
        glowPool.mesh.visible = false;
      }
      return;
    }
    /* THE ABDOMEN LAGS THE THORAX. She turns her head at rate 0.9 and
       twenty metres of egg sac follows it at 0.55, which is what makes
       the two halves read as one heavy animal rather than as a turret
       with a trailer. Deliberately NOT used by `layClutch`: eggs are
       placed off `inst.yaw` and the fight harness measures where they
       land, so the lag is allowed to change the picture and not the
       arithmetic. */
    if (dt > 0) state.sacYaw = dampAngle(state.sacYaw, inst ? inst.yaw : C.yaw, 0.55, dt);
    const yaw = state.sacYaw;
    const sx = Math.sin(yaw);
    const sz = Math.cos(yaw);
    const lift = state.raised;

    /* THE SETTLE. One critically-ish damped spring, kicked by every
       impact she takes or makes, read below with a per-ring delay so
       the wobble TRAVELS down twenty metres of flesh instead of
       bobbing the whole body as a unit. Integrated here rather than in
       `update` so it cannot advance on a frame the body was not posed
       on - a spring that keeps ringing while the mesh is hidden comes
       back to life mid-swing when she wakes. */
    if (dt > 0) {
      state.jigV += (-state.jigY * 62 - state.jigV * 7.4) * dt;
      state.jigY += state.jigV * dt;
      if (Math.abs(state.jigY) < 1e-4 && Math.abs(state.jigV) < 1e-3) {
        state.jigY = 0;
        state.jigV = 0;
      }
      /* The flinch decays on the same clock. */
      state.hitAmt = Math.max(0, state.hitAmt - dt * 1.9);
    }
    /* DEFLATION. Death is a physical event: the sac empties over three
       seconds and the animal goes down with it. */
    const deflate = state.deathT >= 0
      ? lerp(1, 0.52, smoothstep(state.deathT / 2.8)) : 1;
    /* The waist, and it sits INSIDE the collar rather than behind it.
       At 3.2m back the sac's first ring started a metre and a half
       clear of the collar plate's rear face, so the two halves of the
       animal were visibly separate objects with a gap of chamber floor
       between them. Tucked to 1.5 it emerges from under the plate,
       which is what a join looks like. */
    const wx = C.lairX - sx * 1.5;
    const wz = C.lairZ - sz * 1.5;
    /* AND IT DOES NOT RISE WITH THE ROUSE. See the radius below: the
       seat is a constant, so the first frame the player sees of her is
       the frame she is fought at. */
    const wy = floorY + C.abdomenClearance + 2.1;

    for (let i = 0; i < segs; i += 1) {
      const ring = rings[i];
      const along = ring.t * C.abdomenLength;
      /* The sag, and then the lift. Both are functions of `t` so the
         body bends rather than hinging: an abdomen that pivots at one
         point is a boom, and this one has to look like it is being
         carried by muscle it barely has. */
      const sag = -Math.sin(ring.t * Math.PI) * 0.9 * (1 - lift * 0.75)
        + Math.pow(ring.t, 1.6) * 1.5;
      const heave = Math.pow(ring.t, 1.25) * lift * 9.5;
      /* The settle, read with a phase that runs down the body. The
         cosine is the delay: at the waist the wobble is in phase with
         the impulse, and by the ovipositor it is most of a cycle
         behind, which is what makes twenty metres of loaded flesh look
         loaded rather than rigid. Amplitude grows with `t` for the
         same reason - the tip has the least holding it. */
      const jig = state.jigY * Math.pow(ring.t + 0.12, 1.2)
        * Math.cos(ring.t * 3.1);
      spine[i].set(wx - sx * along, wy + sag + heave + jig, wz - sz * along);

      /* Breath, and the laying wave. The wave is a travelling gaussian
         rather than a sine so it reads as ONE thing moving down her
         rather than as the whole body oscillating. */
      const breath = Math.sin(atmos.elapsed * 1.15 - ring.phase) * 0.045;
      const wave = state.wave >= 0
        ? Math.exp(-((ring.t - state.wave) ** 2) / 0.018) * 0.30 : 0;
      /* THE FLINCH, AND WHERE IT LANDED. A local dent centred on the
         ring the shot actually hit, falling off over about two
         segments. A boss that flinches identically wherever it is shot
         is a health bar with a model attached; this is the cheapest
         possible answer to "respect WHERE it was hit" on a body that
         is one deformable surface. Kept shallow - a fifth of a radius
         at worst - because the ventral hit test shoots at this
         surface, and a dent deep enough to be dramatic is a dent deep
         enough to make a player's aim wrong. */
      const dent = state.hitAmt > 0 && state.hitRing >= 0
        ? state.hitAmt * 0.20 * Math.exp(-((i - state.hitRing) ** 2) / 3.2) : 0;
      /* FULL SIZE FROM THE FIRST FRAME, and this used to carry a
         `(0.34 + wake * 0.66)` term.

         The reasoning behind it was that the rouse should be one
         animation - a body swelling and lighting together - and read
         as a diagram it is a good one. On screen it was not: `woken`
         crosses 0.02 on the first frame of the rouse, so the mesh
         appeared at a THIRD of its radius and then spent four and a
         half seconds visibly ballooning, under a reveal camera framed
         down the length of her for exactly that time. Twenty metres of
         egg sac inflating is a thing an audience reads as a balloon
         being blown up, not as an animal waking.

         The wake is still the whole of the reveal - it just spends
         itself on LIGHT rather than on volume (see `paintSac`, where
         it is squared into the brood glow). She is the size she is
         fought at from the frame she becomes visible. */
      spineRadius[i] = C.abdomenRadius * ring.swell * ring.pinch
        * (1 + breath + wave - dent) * deflate;
    }

    /* And the geometry, with analytic normals off the ring frame -
       `computeVertexNormals` on a smooth-shaded sac bands visibly at
       every pinch, because it averages across the constriction. */
    const p = sac.position;
    const nrm = sac.normal;
    for (let i = 0; i < segs; i += 1) {
      const a = spine[Math.max(0, i - 1)];
      const b = spine[Math.min(segs - 1, i + 1)];
      _t.subVectors(b, a);
      if (_t.lengthSq() < 1e-8) _t.set(0, 0, 1);
      _t.normalize();
      _n1.set(0, 1, 0);
      if (Math.abs(_t.y) > 0.92) _n1.set(1, 0, 0);
      _n1.crossVectors(_t, _n1).normalize();
      _n2.crossVectors(_t, _n1).normalize();
      const r = spineRadius[i];
      for (let s = 0; s < SAC_SIDES; s += 1) {
        const ang = (s / SAC_SIDES) * TAU;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        /* Flattened underneath. She rests on this: a circular section
           reads as a balloon, and the belly of something this heavy
           spreads where it meets the floor. */
        // Same axis correction as the colour ramp: `n2` is down.
        const squash = 1 - 0.22 * clamp01(Math.sin(ang));
        const cx = (_n1.x * ca + _n2.x * sa) * squash;
        const cy = (_n1.y * ca + _n2.y * sa) * squash;
        const cz = (_n1.z * ca + _n2.z * sa) * squash;
        const k = (i * SAC_SIDES + s) * 3;
        p[k] = spine[i].x + cx * r;
        p[k + 1] = spine[i].y + cy * r;
        p[k + 2] = spine[i].z + cz * r;
        nrm[k] = cx; nrm[k + 1] = cy; nrm[k + 2] = cz;
      }
    }
    const tip = segs * SAC_SIDES;
    const end = spine[segs - 1];
    const k = tip * 3;
    p[k] = end.x - _t.x * -spineRadius[segs - 1] * 1.4;
    p[k + 1] = end.y - _t.y * -spineRadius[segs - 1] * 1.4;
    p[k + 2] = end.z - _t.z * -spineRadius[segs - 1] * 1.4;
    nrm[k] = _t.x; nrm[k + 1] = _t.y; nrm[k + 2] = _t.z;

    sac.geo.attributes.position.needsUpdate = true;
    sac.geo.attributes.normal.needsUpdate = true;
    sac.mesh.visible = shown();
    /* The plates, the light and its spill, all off the pose that was
       just written. AFTER, never before: every one of them reads
       `spine` and `spineRadius`, and geometry laid out on last frame's
       body hangs off the animal by however far she moved. */
    poseTergites();
    tergites.mesh.visible = sac.mesh.visible;
    paintSac();
    poseGlow();
  }

  /* ============================================================
     THE HEAD AND THORAX

     Small, dark and plated - and static, because unlike the sac they
     are exactly what a rigid body is for. Built once and carried on a
     group that turns to face the player.

     Everything the player is meant to shoot is behind them. That is
     the point of building her this way round: her armour is the part
     that looks at you.
     ============================================================ */
  const head = new THREE.Group();
  head.name = "sf-abbess-head";
  group.add(head);

  {
    const parts = [];
    const paint = (geo, lit, glow = 0) => {
      const count = geo.attributes.position.count;
      const colour = new Float32Array(count * 4);
      for (let i = 0; i < count; i += 1) {
        const t = lit * (0.8 + rng() * 0.4);
        colour[i * 4] = lerp(CHITIN_DARK[0], CHITIN_LIT[0], t);
        colour[i * 4 + 1] = lerp(CHITIN_DARK[1], CHITIN_LIT[1], t);
        colour[i * 4 + 2] = lerp(CHITIN_DARK[2], CHITIN_LIT[2], t);
        colour[i * 4 + 3] = glow;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
      return geo;
    };
    /** The same, on the sac's own bone ramp - for the parts of her that
     *  are plate rather than shell. */
    const paintPale = (geo, lit, glow = 0) => {
      const count = geo.attributes.position.count;
      const colour = new Float32Array(count * 4);
      for (let i = 0; i < count; i += 1) {
        const t = lit * (0.82 + rng() * 0.36);
        colour[i * 4] = lerp(SAC_BAND[0], SAC_PALE[0], t);
        colour[i * 4 + 1] = lerp(SAC_BAND[1], SAC_PALE[1], t);
        colour[i * 4 + 2] = lerp(SAC_BAND[2], SAC_PALE[2], t);
        colour[i * 4 + 3] = glow;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
      return geo;
    };
    /** A lens: the brood colour at whatever bio gain it is worth. */
    const paintEye = (geo, glow) => {
      const count = geo.attributes.position.count;
      const ec = new Float32Array(count * 4);
      for (let i = 0; i < count; i += 1) {
        ec[i * 4] = EYE_HOT[0];
        ec[i * 4 + 1] = EYE_HOT[1];
        ec[i * 4 + 2] = EYE_HOT[2];
        ec[i * 4 + 3] = glow;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(ec, 4));
      return geo;
    };
    /* SCALED UP FROM THE FIRST PASS, all of it.

       Proportionally a queen's fore-body IS tiny, and modelled to that
       proportion it disappeared: twenty metres of lit sac beside four
       metres of dark chitin in a dark chamber left the front of the
       animal reading as a shadow. She needs a head the eye can find,
       because the head is where her armour is and the armour is the
       reason the player has to walk around her. Half again as big, with
       the two things that give a face a focus - lit eyes, and pale
       mandibles against dark plate. */
    // Thorax: a low plated wedge, ribbed.
    const thorax = new THREE.CylinderGeometry(3.3, 4.0, 5.6, 9, 2, false);
    thorax.rotateX(Math.PI / 2);
    thorax.translate(0, 2.7, 1.8);
    parts.push(paint(thorax, 0.75));
    /* A collar plate where the thorax meets the sac. Longer and wider
       at its rear than the first pass so it OVERLAPS the abdomen's
       first two rings: the sac's own radius varies with her breath and
       with the laying wave, and a butt joint between two surfaces that
       both move opens and closes a seam every second. A skirt that
       swallows the join cannot. */
    const collar = new THREE.CylinderGeometry(4.9, 3.7, 3.4, 9, 1, false);
    collar.rotateX(Math.PI / 2);
    collar.translate(0, 2.7, -1.5);
    parts.push(paint(collar, 0.5));
    /* THE SEAM, and it is the animal's only accent that is not the
       abdomen.

       The fore-body is four metres of near-black plate sitting between
       a lit sac and a lit face, and photographed from the side it was
       the single largest dark shape in the frame - a matte block with
       the two interesting things on either side of it. The art
       direction's answer to that is the Scarab's: a dominant material,
       a small accent in a designed repeating place, one saturated
       focal element. This is the accent. Brood light escaping from
       UNDER the collar plate where it laps over the abdomen's first
       ring - the one place on her armour where the lamp behind it can
       physically get out, so it lands as a hot line following the
       plate's own rear edge rather than as a glow somebody painted on.

       Weighted downward as well as rearward, because light escaping a
       lapped joint runs out of the low side of it; the top of the
       collar stays black and the silhouette is unchanged. */
    {
      const cp = collar.attributes.position;
      const cc = collar.attributes.color;
      for (let i = 0; i < cp.count; i += 1) {
        const seam = clamp01((-2.35 - cp.getZ(i)) / 0.85)
          * clamp01(0.55 - (cp.getY(i) - 2.7) / 4.2);
        if (seam <= 0) continue;
        cc.setX(i, lerp(cc.getX(i), SAC_GLOW[0], seam * 0.9));
        cc.setY(i, lerp(cc.getY(i), SAC_GLOW[1], seam * 0.9));
        cc.setZ(i, lerp(cc.getZ(i), SAC_GLOW[2], seam * 0.9));
        cc.setW(i, seam * 1.5);
      }
    }
    // Head: forward and down.
    const skull = new THREE.SphereGeometry(2.5, 11, 8);
    skull.scale(1, 0.80, 1.30);
    skull.translate(0, 2.3, 6.1);
    parts.push(paint(skull, 1.0, 0.06));
    /* The eyes. Two lit lozenges, and they are the only strongly
       emissive thing on her that is not the egg sac - which makes the
       head the second place the eye goes and the first place it
       returns to. */
    /* PAINTED HOT, not merely "lit". They used to take the plate's own
       albedo at alpha 1 and a bio gain of 1 - which is an emissive of
       0.15, dimmer than the sunlit side of the same plate, so the eyes
       read as light-coloured chitin rather than as eyes. On the brood
       colour at alpha 3 they clear the bloom threshold outright and
       become the only blown pixels on the animal. */
    /* ...AND THEN BROKEN INTO OMMATIDIA, because one lozenge at that
       size is a blown WHITE LOZENGE. Read back off the portrait it was
       a flat hard-edged white blob about a metre and a half across with
       no structure in it at all - which is what a blown highlight looks
       like when it has no small dark next to it, and it was also the
       only bright thing on the animal, so it took the eye and gave it
       nothing.

       A compound eye is a CLUSTER. One smaller central lens and six
       beads around it, each with its own silhouette and its own black
       gap between, keeps every blown pixel the frame needs -
       brightPct was 0.00 across this whole cast before there were hot
       eyes at all - and turns them into the one place on this animal
       with structure at four centimetres. Which is the axis that keeps
       measuring low: microDetail is fine grain surviving to the
       screen, and thirteen small bright shapes survive where one big
       one is just an area. */
    for (const side of [-1, 1]) {
      const core = new THREE.SphereGeometry(0.40, 7, 5);
      core.scale(1, 0.78, 1.32);
      core.translate(side * 1.5, 2.85, 7.62);
      parts.push(paintEye(core, 4.4));
      for (let o = 0; o < 6; o += 1) {
        const a = (o / 6) * TAU + side * 0.4;
        const bead = new THREE.SphereGeometry(0.185, 5, 4);
        bead.scale(1, 0.9, 1.15);
        bead.translate(side * 1.5 + Math.cos(a) * 0.62,
          2.85 + Math.sin(a) * 0.50,
          7.62 + Math.cos(a) * side * 0.30);
        /* Dimmer than the core and unequally so, so the cluster has an
           internal value range instead of thirteen identical dots. */
        parts.push(paintEye(bead, 2.1 + (o % 3) * 0.70));
      }
    }
    /* Mandibles: PALE, against dark plate. Chitin-on-chitin was
       invisible; a queen's jaws are the same material as her tergites
       and read as bone at this range, which is also the one cue that
       says this animal can still bite. */
    for (const side of [-1, 1]) {
      const jaw = new THREE.ConeGeometry(0.85, 5.0, 5);
      jaw.rotateX(Math.PI * 0.54);
      jaw.rotateZ(side * 0.34);
      jaw.translate(side * 1.45, 1.7, 8.6);
      parts.push(paintPale(jaw, 0.85));
      // ...and a shorter inner pair, so the mouth reads as a set.
      const inner = new THREE.ConeGeometry(0.5, 3.0, 5);
      inner.rotateX(Math.PI * 0.58);
      inner.rotateZ(side * 0.55);
      inner.translate(side * 0.7, 1.35, 7.9);
      parts.push(paintPale(inner, 0.6));
    }
    /* Six vestigial legs. She cannot walk on them and they are modelled
       to say so: too short for the body, splayed, and holding nothing
       up. A queen with usable legs is just a big insect. */
    for (let i = 0; i < 3; i += 1) {
      for (const side of [-1, 1]) {
        const leg = new THREE.CylinderGeometry(0.42, 0.18, 3.8, 5);
        leg.rotateZ(side * 1.05);
        leg.rotateX(-0.2 + i * 0.16);
        leg.translate(side * 3.1, 1.6, 3.6 - i * 1.9);
        parts.push(paint(leg, 0.4));
      }
    }
    const merged = mergeAll(THREE, parts);
    const mesh = new THREE.Mesh(merged, chitinMat);
    mesh.name = "sf-abbess-fore";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    head.add(mesh);
  }

  /** Minimal merge - three's own helper is an addon import this module
   *  does not otherwise need, and every part here shares one layout. */
  function mergeAll(T, geos) {
    let verts = 0;
    let idx = 0;
    for (const g of geos) {
      verts += g.attributes.position.count;
      idx += g.index ? g.index.count : g.attributes.position.count;
    }
    const position = new Float32Array(verts * 3);
    const normal = new Float32Array(verts * 3);
    const colour = new Float32Array(verts * 4);
    const index = new Uint32Array(idx);
    let vo = 0;
    let io = 0;
    for (const g of geos) {
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      position.set(g.attributes.position.array.subarray(0, n * 3), vo * 3);
      normal.set(g.attributes.normal.array.subarray(0, n * 3), vo * 3);
      colour.set(g.attributes.color.array.subarray(0, n * 4), vo * 4);
      if (g.index) {
        for (let i = 0; i < g.index.count; i += 1) index[io + i] = g.index.getX(i) + vo;
        io += g.index.count;
      } else {
        for (let i = 0; i < n; i += 1) index[io + i] = i + vo;
        io += n;
      }
      vo += n;
    }
    const out = new T.BufferGeometry();
    out.setAttribute("position", new T.BufferAttribute(position, 3));
    out.setAttribute("normal", new T.BufferAttribute(normal, 3));
    out.setAttribute("color", new T.BufferAttribute(colour, 4));
    out.setIndex(new T.BufferAttribute(index, 1));
    return out;
  }

  /* ============================================================
     THE EGGS

     Pooled, like every other hazard in this game, and each one is a
     small independent creature-in-waiting with its own pool.

     One geometry for all of them, rewritten per frame - they SWELL,
     visibly, and the swell is the timer. A player who has learned to
     read a clutch knows how long they have without a HUD element
     telling them, because the egg that is about to split is the fat
     one.
     ============================================================ */
  const eggVerts = EGG_RINGS * EGG_SIDES + 2;
  /* How long the rupture takes. Short: it is a physical event, not a
     dissolve, and past about a quarter of a second the eye stops
     reading "burst" and starts reading "deflate". */
  const EGG_BURST_SECONDS = 0.22;
  const eggs = [];
  for (let i = 0; i < C.eggMax; i += 1) {
    eggs.push({
      live: false, x: 0, y: 0, z: 0, t: 0, hp: 0, seed: rng(), base: i * eggVerts,
      burst: 0, burstFrom: 0,
      /* Which caste is inside it - see `rangedShare`. Decided when the
         egg is laid rather than when it hatches, so the shell can say
         so for the whole five seconds the player is deciding which
         ones to burn. */
      caste: "thresher",
    });
  }
  let eggCursor = 0;
  /* Whether the egg mesh still holds geometry that has to be cleared -
     see the gate in `updateEggs`. */
  let eggsDirty = false;

  const eggMesh = (() => {
    const total = C.eggMax * eggVerts;
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const colour = new Float32Array(total * 4);
    /* The rest pose the surface kit reads instead of `position` - see
       `bindSurfaceToRestPose`. An egg's real position is world-space
       and it SWELLS from a third of full size to over it, which would
       drag the grain across the shell for the whole five seconds a
       player is deciding whether to shoot it. Each egg is also offset
       by a decorrelating stride so twenty-six of them do not come out
       of the pool wearing the same twenty-six centimetres of noise. */
    const objRest = new Float32Array(total * 3);
    const index = [];
    for (let e = 0; e < C.eggMax; e += 1) {
      const base = e * eggVerts;
      /* Outward, same correction as the sac's - the rings run down the
         egg while the angle runs positively about that axis, so the
         obvious order faces inward. The caps below were already right,
         which is exactly how a half-inverted mesh gets shipped: the
         ends look correct and only the walls are wrong. */
      for (let r = 0; r < EGG_RINGS - 1; r += 1) {
        for (let s = 0; s < EGG_SIDES; s += 1) {
          const n = (s + 1) % EGG_SIDES;
          const a = base + r * EGG_SIDES;
          const b = base + (r + 1) * EGG_SIDES;
          index.push(a + s, b + n, b + s, a + s, a + n, b + n);
        }
      }
      const top = base + EGG_RINGS * EGG_SIDES;
      const bot = top + 1;
      for (let s = 0; s < EGG_SIDES; s += 1) {
        const n = (s + 1) % EGG_SIDES;
        index.push(base + s, top, base + n);
        const lastRing = base + (EGG_RINGS - 1) * EGG_SIDES;
        index.push(lastRing + n, bot, lastRing + s);
      }
      const ox = (e % 7) * 3.7;
      const oy = (e % 5) * 4.3;
      const oz = (e % 3) * 5.1;
      for (let v = 0; v < eggVerts; v += 1) {
        const k = (base + v) * 4;
        colour[k] = EGG_PALE[0];
        colour[k + 1] = EGG_PALE[1];
        colour[k + 2] = EGG_PALE[2];
        /* Lit from inside, and the alpha is written per frame with the
           swell - a nearly-hatched egg is nearly a light source. */
        colour[k + 3] = 0.4;
      }
      for (let r = 0; r < EGG_RINGS; r += 1) {
        const vv = (r + 0.5) / EGG_RINGS;
        for (let s = 0; s < EGG_SIDES; s += 1) {
          const ang = (s / EGG_SIDES) * TAU;
          const k = (base + r * EGG_SIDES + s) * 3;
          objRest[k] = ox + Math.cos(ang) * Math.sin(vv * Math.PI) * 1.15;
          objRest[k + 1] = oy + Math.cos(vv * Math.PI) * 1.55;
          objRest[k + 2] = oz + Math.sin(ang) * Math.sin(vv * Math.PI) * 1.15;
        }
      }
      /* `restTop`, not `top` - the index loop above already binds
         `top` in this same block, and a duplicate const in an ES
         module is a SyntaxError that `node --check` does not report
         (it parses as a script). The page's own boot handler caught
         it: "Identifier 'top' has already been declared". */
      const restTop = base + EGG_RINGS * EGG_SIDES;
      objRest[restTop * 3] = ox;
      objRest[restTop * 3 + 1] = oy + 1.55;
      objRest[restTop * 3 + 2] = oz;
      objRest[(restTop + 1) * 3] = ox;
      objRest[(restTop + 1) * 3 + 1] = oy - 1.55;
      objRest[(restTop + 1) * 3 + 2] = oz;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colour, 4));
    geo.setAttribute("sfObj", new THREE.BufferAttribute(objRest, 3));
    geo.setIndex(index);
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(C.lairX, floorY, C.lairZ), 80);
    const mesh = new THREE.Mesh(geo, eggMat);
    mesh.name = "sf-abbess-eggs";
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // Nothing has been laid yet; `updateEggs` turns it on when it has.
    mesh.visible = false;
    decor.add(mesh);
    return { mesh, geo, position, normal, colour };
  })();

  /** Write one egg's ellipsoid, or collapse it to nothing if dead. */
  function writeEgg(egg) {
    const p = eggMesh.position;
    const nrm = eggMesh.normal;
    const col = eggMesh.colour;
    /* Swells from a third of full size to slightly over it, then the
       last tenth of its life is a visible shudder. */
    let grow = egg.live ? lerp(0.34, 1.06, Math.pow(egg.t, 0.7)) : 0;
    const shake = egg.live && egg.t > 0.86
      ? Math.sin(atmos.elapsed * 26 + egg.seed * 9) * 0.10 * (egg.t - 0.86) / 0.14 : 0;
    let glow = egg.live ? 0.25 + Math.pow(egg.t, 2) * 1.15 : 0;
    /* AN EGG BURSTS, IT DOES NOT VANISH. The art direction asks for
       this by name and it is four lines: the shell blows outward over
       a fifth of a second while the brood light inside it flares, and
       only then does it go to nothing. A hazard that disappears on the
       frame it dies teaches the player that it was never really there. */
    if (!egg.live && egg.burst > 0) {
      const u = 1 - egg.burst / EGG_BURST_SECONDS;
      grow = lerp(egg.burstFrom, egg.burstFrom * 1.85, smoothstep(u)) * (1 - u * u);
      glow = (1 - u) * 3.2;
    }
    /* The ranged caste ships at 3.55m against the Thresher's 1.9, and
       the shell says so: a fifth bigger, which is enough to tell two
       eggs apart in silhouette at the far end of the chamber where the
       tint has already gone to grey. */
    const size = egg.caste === "gleaner" ? 1.20 : 1;
    const R = 1.15 * size * (grow + shake);
    const H = 1.55 * size * (grow + shake);
    /* A clutch is HER light in miniature, so it reads off the same
       brood colour - which means a dying queen lays visibly sickly
       eggs without anything having to say so. Ripe eggs go hotter as
       they near hatching, which is the timer the player is reading. */
    const g = broodColour();
    const ripe = clamp01(egg.t * 1.2);
    let cr = lerp(EGG_PALE[0], g[0], 0.35 + ripe * 0.5);
    let cg = lerp(EGG_PALE[1], g[1], 0.35 + ripe * 0.5);
    let cb = lerp(EGG_PALE[2], g[2], 0.35 + ripe * 0.5);
    /* ...and the caste, painted onto the shell rather than announced.
       Ramped with ripeness so a fresh clutch is legible without the
       whole field turning green the moment it lands. */
    if (egg.caste === "gleaner") {
      const tint = 0.70 + ripe * 0.28;
      cr = lerp(cr, EGG_RANGED[0], tint);
      cg = lerp(cg, EGG_RANGED[1], tint);
      cb = lerp(cb, EGG_RANGED[2], tint);
    }
    for (let r = 0; r < EGG_RINGS; r += 1) {
      const v = (r + 0.5) / EGG_RINGS;
      const ry = Math.cos(v * Math.PI);
      const rr = Math.sin(v * Math.PI);
      for (let s = 0; s < EGG_SIDES; s += 1) {
        const ang = (s / EGG_SIDES) * TAU;
        const vi = egg.base + r * EGG_SIDES + s;
        const k = vi * 3;
        const cx = Math.cos(ang) * rr;
        const cz = Math.sin(ang) * rr;
        p[k] = egg.x + cx * R;
        p[k + 1] = egg.y + ry * H + H;
        p[k + 2] = egg.z + cz * R;
        nrm[k] = cx; nrm[k + 1] = ry; nrm[k + 2] = cz;
        col[vi * 4] = cr; col[vi * 4 + 1] = cg; col[vi * 4 + 2] = cb;
        col[vi * 4 + 3] = glow;
      }
    }
    const top = egg.base + EGG_RINGS * EGG_SIDES;
    const bot = top + 1;
    for (const [vi, sign] of [[top, 1], [bot, -1]]) {
      const k = vi * 3;
      p[k] = egg.x;
      p[k + 1] = egg.y + H + sign * H;
      p[k + 2] = egg.z;
      nrm[k] = 0; nrm[k + 1] = sign; nrm[k + 2] = 0;
      col[vi * 4] = cr; col[vi * 4 + 1] = cg; col[vi * 4 + 2] = cb;
      col[vi * 4 + 3] = glow;
    }
  }

  function layEgg(x, z, caste = "thresher") {
    const egg = eggs[eggCursor];
    eggCursor = (eggCursor + 1) % eggs.length;
    egg.live = true;
    egg.caste = caste;
    egg.x = x;
    egg.z = z;
    egg.y = groundAt(x, z);
    egg.t = 0;
    egg.hp = C.eggHealth;
    egg.seed = rng();
    state.laid += 1;
    ctx.vfx?.spark?.(x, egg.y + 0.6, z, 1.1, false, true);
    bus.emit("egg", { x, y: egg.y, z, caste, index: eggs.indexOf(egg) });
    return egg;
  }

  /** Hatch, or fail to. A capped brood still lays - the tell has to be
   *  identical whether or not the spawn arrives - but the egg comes out
   *  spent rather than silently not being laid. */
  function hatchEgg(egg) {
    egg.live = false;
    pruneBrood();
    if (brood.length >= C.broodCap) {
      ctx.vfx?.spark?.(egg.x, egg.y + 0.5, egg.z, 1.4, false, false);
      bus.emit("stillborn", { x: egg.x, z: egg.z });
      return null;
    }
    /* Whatever was in it. A Gleaner is twice a Thresher's height and
       comes out of a shell the same size, which is exactly the read a
       hatching wants - the egg was never big enough for what left it. */
    const kid = enemies.spawn(egg.caste === "gleaner" ? "gleaner" : "thresher",
      egg.x, egg.z, {
        yaw: rng() * TAU,
        emerge: { delay: 0, duration: 0.85, depth: 1.0 },
      });
    if (!kid) return null;
    /* Born awake and looking at you - a clutch that has to notice the
       player first gives away the seconds that make it a threat. */
    kid.alerted = true;
    kid.suspicion = 1;
    kid.abbessBornAt = atmos.elapsed;
    brood.push(kid);
    ctx.vfx?.blast?.(egg.x, egg.y + 0.4, egg.z,
      egg.caste === "gleaner" ? 3.2 : 2.4);
    bus.emit("hatch", { x: egg.x, y: egg.y, z: egg.z, caste: egg.caste });
    return kid;
  }

  function killEgg(egg, x, y, z) {
    /* The size it was at the moment it died, so a fat egg makes a
       bigger rupture than one laid three seconds ago. */
    egg.burstFrom = lerp(0.34, 1.06, Math.pow(clamp01(egg.t), 0.7));
    egg.burst = EGG_BURST_SECONDS;
    egg.live = false;
    ctx.vfx?.blast?.(x ?? egg.x, (y ?? egg.y) + 0.7, z ?? egg.z, 3.0);
    ctx.vfx?.spark?.(x ?? egg.x, (y ?? egg.y) + 0.7, z ?? egg.z, 2.2, false, true);
    /* AND IT LEAVES SOMETHING. What came out of it lands on the floor
       and stays there, which is the difference between a hazard the
       player cleared and a hazard the player watched disappear. */
    stainGround(egg.x, egg.z, 1.9 + egg.burstFrom * 1.6, 0.5);
    bus.emit("eggKilled", { x: egg.x, y: egg.y, z: egg.z });
  }

  /* ============================================================
     ICHOR THAT LANDS AND STAINS

     Through the shared ordnance scorch pool, which is where every
     other lasting ground mark in this game lives, tinted to the brood
     light rather than to soot.

     RATE LIMITED, and that is not politeness: the pool is small and
     shared with stratagems, and a magazine emptied into her belly at
     ten rounds a second would evict every other mark on the map inside
     two seconds. One stain per `ICHOR_GAP` is enough to read as a
     spreading pool under a wounded animal, which is the point.
     ============================================================ */
  const ICHOR_GAP = 0.85;
  function stainGround(x, z, radius, strength = 0.42, force = false) {
    if (!ctx.vfx?.scorchFx) return;
    if (!force && atmos.elapsed - state.ichorAt < ICHOR_GAP) return;
    state.ichorAt = atmos.elapsed;
    const g = broodColour();
    /* Darkened hard. A stain is what is LEFT of a bright fluid after
       it has soaked into rock; painting it at the emitter's own value
       gives a floor covered in glowing paint. */
    ctx.vfx.scorchFx(x, z, radius, 26,
      new THREE.Color(g[0] * 0.30, g[1] * 0.16, g[2] * 0.20), strength);
  }

  /**
   * Damage an egg through a world-space sphere test.
   *
   * Eggs are NOT enemies - they have no rig, no AI and no place in
   * `enemies.live` - so combat.js cannot route to them and this module
   * publishes a test instead. Every damage path in the game that can
   * reach the ground calls it: see `ctx.abbess.hitEggs` in combat.js's
   * shot, melee and explosion resolution.
   *
   * A MELEE CONNECTION IS ALWAYS LETHAL, and that is a rule rather
   * than a number. `eggHealth` is written for the rifle - four rounds,
   * which is what makes clearing a clutch at range a real cost - and
   * the lance's opener happens to deal 89.7. Those two numbers sitting
   * either side of "one swing kills an egg" by 0.3 is not a design, it
   * is a coincidence waiting to be broken by any weapon tuning pass,
   * a combo re-weight or a talent. So the swing says so directly: get
   * inside the clutch and it dies, whatever either number becomes.
   */
  function hitEggs(x, y, z, radius, damage, opts = {}) {
    let hits = 0;
    for (const egg of eggs) {
      if (!egg.live) continue;
      const dx = egg.x - x;
      const dz = egg.z - z;
      const dy = (egg.y + 1.4) - y;
      if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
      egg.hp = opts.melee ? 0 : egg.hp - damage;
      hits += 1;
      if (egg.hp <= 0) killEgg(egg, x, y, z);
      else ctx.vfx?.spark?.(egg.x, egg.y + 1.2, egg.z, 1.0, false, true);
    }
    return hits;
  }

  function updateEggs(dt) {
    /* ANOTHER THING A DORMANT QUEEN USED TO PAY FOR. This walked all
       twenty-six pool slots and rewrote 780 vertices of an empty mesh
       on every frame of the game, whether or not a single egg existed.
       The frame is GPU fill-bound and this is CPU, but three buffer
       re-uploads a frame for nothing is still nothing bought. One pass
       is still spent after the last egg dies, so the pool is left
       collapsed rather than frozen mid-burst. */
    let any = false;
    for (const egg of eggs) if (egg.live || egg.burst > 0) { any = true; break; }
    if (!any) {
      if (eggsDirty) {
        eggsDirty = false;
        for (const egg of eggs) writeEgg(egg);
        eggMesh.geo.attributes.position.needsUpdate = true;
        eggMesh.geo.attributes.normal.needsUpdate = true;
        eggMesh.geo.attributes.color.needsUpdate = true;
      }
      eggMesh.mesh.visible = false;
      return;
    }
    eggsDirty = true;
    eggMesh.mesh.visible = true;
    for (const egg of eggs) {
      if (egg.live) {
        egg.t += dt / C.eggHatchSeconds;
        if (egg.t >= 1) hatchEgg(egg);
      } else if (egg.burst > 0) {
        egg.burst = Math.max(0, egg.burst - dt);
      }
      writeEgg(egg);
    }
    eggMesh.geo.attributes.position.needsUpdate = true;
    eggMesh.geo.attributes.normal.needsUpdate = true;
    eggMesh.geo.attributes.color.needsUpdate = true;
  }

  /* ============================================================
     THE BROOD

     She does not command them - combat.js's ordinary Thresher brain
     does, and it hunts the player. What this module adds is a REASON
     to come home, applied by moving the one thing that brain steers
     by: after `feedAfterSeconds` a child's aggro is released and it
     walks to her, and touching her head feeds her.
     ============================================================ */
  function pruneBrood() {
    for (let i = brood.length - 1; i >= 0; i -= 1) {
      const kid = brood[i];
      if (!kid || kid.state === "death" || kid.health <= 0
        || !enemies.live.includes(kid)) brood.splice(i, 1);
    }
  }

  function updateBrood(dt) {
    pruneBrood();
    if (!inst || state.phase === "dormant") return;
    const now = atmos.elapsed;
    for (const kid of brood) {
      const age = now - (kid.abbessBornAt || now);
      if (age < C.feedAfterSeconds) continue;

      /* RECALLED, and DRIVEN.

         The first version simply dropped the child's aggro and set its
         `home` to her, on the reasoning that combat.js already walks an
         unalerted creature back to its post. It does - but the sensing
         block ahead of that re-detects a player standing in the same
         room on the very next frame, so the child turned round, saw the
         trooper, and went back to work. Nothing ever reached her.

         So the encounter takes ownership (`inst.selfDriven`, honoured
         by stepEnemy) and walks them itself. That is also the better
         read: a nurse carrying food does not stop to fight, and a
         column of Threshers ignoring the player to file home past them
         is a far clearer statement of what is about to happen than any
         amount of them milling about. */
      if (!kid.selfDriven) {
        kid.selfDriven = true;
        kid.alerted = false;
        kid.suspicion = 0;
        kid.home = { x: C.lairX, z: C.lairZ };
        enemies.play?.(kid, "idle", 0.25);
        bus.emit("recall", { x: kid.x, z: kid.z });
      }

      const dx = C.lairX - kid.x;
      const dz = C.lairZ - kid.z;
      const d = Math.hypot(dx, dz);
      if (d <= C.feedRadius) { feed(kid); continue; }

      // Walked, not teleported, and around masonry like anything else.
      const speed = (kid.spec?.speed?.walk || 1.5) * 1.35;
      const step = Math.min(d, speed * dt);
      const nx = kid.x + (dx / d) * step;
      const nz = kid.z + (dz / d) * step;
      const out = ctx.collide?.slide
        ? ctx.collide.slide(kid.x, kid.z, nx, nz, null,
          kid.spec?.collisionRadius || 0.62)
        : [nx, nz];
      kid.x = out[0];
      kid.z = out[1];
      kid.yaw = dampAngle(kid.yaw, Math.atan2(dx, dz), 5, dt);
      kid.speed = speed;
      if (kid.state !== "idle") enemies.play?.(kid, "idle", 0.3);
    }
  }

  function feed(kid) {
    kid.selfDriven = false;
    const healed = Math.min(C.feedHeal, inst.maxHealth - inst.health);
    inst.health = Math.min(inst.maxHealth, inst.health + C.feedHeal);
    state.fed += 1;
    enemies.remove?.(kid);
    const i = brood.indexOf(kid);
    if (i >= 0) brood.splice(i, 1);
    ctx.vfx?.spark?.(kid.x, kid.y + 1.2, kid.z, 2.6, false, true);
    bus.emit("feed", { x: kid.x, z: kid.z, healed, health: inst.health });
  }

  /* ============================================================
     BEHAVIOUR
     ============================================================ */

  function faceTowards(x, z, rate, dt) {
    if (!inst) return;
    const dx = x - C.lairX;
    const dz = z - C.lairZ;
    if (Math.hypot(dx, dz) < 1e-3) return;
    /* She turns her HEAD, not her body. The abdomen is laid out along
       `inst.yaw` too, but clamped to a narrow arc around the seat: a
       queen who pivots twenty metres of egg sac to track the player is
       a tank turret, and the whole point of her is that she cannot get
       out of the way. */
    const want = Math.atan2(dx, dz);
    inst.yaw = dampAngle(inst.yaw, clampToSeat(want), rate, dt);
    head.rotation.y = inst.yaw;
    head.position.set(C.lairX, floorY, C.lairZ);
    head.updateMatrixWorld(true);
  }

  function clampToSeat(want) {
    let rel = want - C.yaw;
    while (rel > Math.PI) rel -= TAU;
    while (rel < -Math.PI) rel += TAU;
    return C.yaw + clamp(rel, -0.8, 0.8);
  }

  function beginClutch() {
    state.clutchWind = C.clutchWindup;
    state.clutchTimer = C.clutchCadence;
    bus.emit("clutchTelegraph", { x: C.lairX, z: C.lairZ });
  }

  /* ============================================================
     KEEPING THE PLAYER OUT OF HER

     Twenty-six metres of animal that the player could walk straight
     through, because none of it exists as far as the collision grid is
     concerned - that grid is rasterised once, at load, from the
     authored world, and everything in this file is built at runtime.
     The Garner's mouth had the same problem and the same answer: the
     creature holds them off itself.

     Tested against the LIVE sac, one capsule per segment, so it agrees
     with what is on screen at every moment of her breath, her laying
     wave and her slam. Which also means the one place the fight wants
     the player to be stays open by construction: while the abdomen is
     raised, its capsules are nine metres up and the ground underneath
     them is free. Getting under her is supposed to be possible - it is
     where her weak point is - and nothing here has to special-case
     that, because the volume simply is not there any more.

     Horizontal pushes only. A vertical correction on a creature that
     heaves would launch or bury the trooper; being eased sideways out
     of a wall of flesh is what the rest of the game does.
     ============================================================ */
  const PLAYER_RADIUS = 1.05;

  /** Shove the player out of one capsule, in XZ. Returns true if it
   *  moved them, so the caller can settle overlapping segments. */
  function shoveOut(ps, ax, ay, az, bx, by, bz, ra, rb) {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 1e-6
      ? clamp01(((ps.x - ax) * dx + (ps.z - az) * dz) / len2) : 0;
    const cx = ax + dx * t;
    const cz = az + dz * t;
    const cy = ay + (by - ay) * t;
    const r = lerp(ra, rb, t);
    /* Vertical gate first. A segment the player is standing well under
       or well over is not in their way, and this is the whole reason a
       raised abdomen can be walked beneath. */
    if (Math.abs((ps.y + 0.95) - cy) > r + 1.15) return false;
    const want = r + PLAYER_RADIUS;
    let ox = ps.x - cx;
    let oz = ps.z - cz;
    const d = Math.hypot(ox, oz);
    if (d >= want) return false;
    if (d < 1e-4) {
      // Dead on the axis: pick a bearing rather than divide by zero.
      ox = Math.cos(atmos.elapsed * 3.1);
      oz = Math.sin(atmos.elapsed * 3.1);
    } else {
      ox /= d;
      oz /= d;
    }
    ps.x = cx + ox * want;
    ps.z = cz + oz * want;
    return true;
  }

  function keepOut() {
    const ps = ctx.player?.state;
    if (!ps || state.woken < 0.25 || ctx.combat?.player?.dead) return;
    /* Two passes. Shoving clear of one segment can push the player into
       the next one along a body that curves, and a single pass leaves
       them standing inside her with the correction fighting itself. */
    for (let pass = 0; pass < 2; pass += 1) {
      let moved = false;
      // The thorax and its collar, as one upright capsule at her seat.
      moved = shoveOut(ps, C.lairX, floorY + 2.7, C.lairZ,
        C.lairX, floorY + 4.4, C.lairZ, 4.3, 3.4) || moved;
      for (let i = 0; i < segs - 1; i += 1) {
        moved = shoveOut(ps,
          spine[i].x, spine[i].y, spine[i].z,
          spine[i + 1].x, spine[i + 1].y, spine[i + 1].z,
          spineRadius[i], spineRadius[i + 1]) || moved;
      }
      if (!moved) break;
    }
  }

  /** How many of a clutch of `n` come out shooting, from where the
   *  player is standing right now - see `rangedShare`. */
  function rangedInClutch(n) {
    const ps = ctx.player?.state;
    if (!ps) return 0;
    const dist = Math.hypot(ps.x - C.lairX, ps.z - C.lairZ);
    const u = clamp01((dist - C.rangedFrom) / Math.max(1e-3, C.rangedTo - C.rangedFrom));
    const share = lerp(C.rangedShare[0], C.rangedShare[1], smoothstep(u));
    /* Rounded, and then held to at most one short of the whole clutch.
       A clutch that is ALL Gleaners stops being her brood and starts
       being a garrison she happens to have summoned; the swarm is
       still the fight. */
    return Math.min(n - 1, Math.round(n * share));
  }

  function layClutch() {
    const hurt = 1 - clamp01(inst.health / Math.max(1, inst.maxHealth));
    const hurtBonus = hurt * 2.2;
    const timeBonus = Math.min(3, state.fightTime / C.clutchTimeScaleSeconds);
    const n = clamp(Math.round(C.clutchEggs[0] + hurtBonus + timeBonus), C.clutchEggs[0], C.clutchEggs[1]);
    const ranged = Math.max(0, rangedInClutch(n));
    const sx = Math.sin(inst.yaw);
    const sz = Math.cos(inst.yaw);
    /* Behind her, in an arc across her own axis, and past the far end
       of the abdomen - so a clutch lands where the player has to walk
       around twenty metres of animal to reach it. That geometry is the
       mechanic: eggs are cheap to kill and expensive to get to. */
    for (let i = 0; i < n; i += 1) {
      const spread = (i - (n - 1) * 0.5) * 4.2 + (rng() - 0.5) * 1.6;
      const back = C.abdomenLength + 3 + rng() * 7;
      const x = C.lairX - sx * back - sz * spread;
      const z = C.lairZ - sz * back + sx * spread;
      /* Spread through the arc rather than clustered at one end, so a
         player answering the clutch cannot burn all the dangerous ones
         with a single blast at the edge of it. */
      const isRanged = ranged > 0
        && Math.floor(i * ranged / n) !== Math.floor((i + 1) * ranged / n);
      layEgg(x, z, isRanged ? "gleaner" : "thresher");
    }
    // The wave that delivers them, travelling the length of her.
    state.wave = 0;
    ctx.vfx?.spark?.(C.lairX - sx * C.abdomenLength,
      floorY + 2, C.lairZ - sz * C.abdomenLength, 2.4, false, true);
    bus.emit("clutch", { x: C.lairX, z: C.lairZ, count: n, ranged, fightTime: state.fightTime });
  }

  function beginSlam() {
    state.slamPhase = "rise";
    state.slamTime = 0;
    state.slamTimer = C.slamCadence;
    ctx.player?.doctrineKick?.(0.45, 0.35);
    bus.emit("slamTelegraph", { x: C.lairX, z: C.lairZ });
  }

  /** The impact. Everything inside the ring goes down, INCLUDING her
   *  own children - which is most of why a good player learns to fight
   *  next to the brood rather than away from it. */
  function landSlam() {
    const sx = Math.sin(inst.yaw);
    const sz = Math.cos(inst.yaw);
    // Centred under the abdomen's mass, not under her head.
    const cx = C.lairX - sx * C.abdomenLength * 0.55;
    const cz = C.lairZ - sz * C.abdomenLength * 0.55;
    const cy = groundAt(cx, cz);
    ctx.vfx?.blast?.(cx, cy + 0.4, cz, C.slamRadius * 0.6);
    ctx.vfx?.breach?.(cx, cy, cz, C.slamRadius, 2.4);
    ctx.player?.punch?.(1.8);
    ctx.player?.doctrineKick?.(1.3, 1.1);

    /* WHAT TWENTY METRES OF ABDOMEN LANDING ACTUALLY DOES.

       Three things the impact used not to leave behind, and all of
       them are the axis the brief calls weight:

       - the body ANSWERS. One kick into the settle spring, so she
         does not stop dead on contact: the flesh keeps going, bottoms
         out, and rings back up the length of her.
       - the floor answers. Dust pushed OUT along the ring rather than
         up from the middle, because a falling body displaces air
         sideways; a puff at the centre reads as an explosion.
       - and it STAYS. Three belly prints through the shared decal
         pool, which is what the trooper's own boots use, so the mark
         she leaves is the same kind of mark everything else leaves. */
    state.jigV -= 5.4;
    const sy = Math.sin(state.sacYaw);
    const sz2 = Math.cos(state.sacYaw);
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * TAU;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const r = C.slamRadius * 0.42;
      ctx.vfx?.sandSpray?.(cx + dx * r, cy + 0.25, cz + dz * r, 1.5, dx, dz);
    }
    for (let i = -1; i <= 1; i += 1) {
      const back = C.abdomenLength * (0.34 + i * 0.22);
      ctx.vfx?.footprint?.(C.lairX - sy * back, C.lairZ - sz2 * back,
        state.sacYaw, 0, 2.4);
    }

    /* THE PLAYER, AND THE ONE WAY OUT OF IT.

       A slam is a shock through the FLOOR - so it reaches whatever is
       standing on the floor, and nothing that is not. Measured as
       height above the ground rather than off `grounded`, because
       `grounded` goes false for a stride down a slope and a player
       does not get to dodge twenty metres of abdomen by walking
       downhill. It also means the answer is the same one whichever
       way the player leaves the ground: a jump, a boost, or the pack.

       This is the only clean out. The ring is wider than her body, the
       tell is the longest in the game, and standing in it now costs
       the trooper their hands as well as their health. */
    const ps = ctx.player?.state;
    if (ps && !ctx.combat?.player?.dead) {
      const d = Math.hypot(ps.x - cx, ps.z - cz);
      const clearance = ps.y - groundAt(ps.x, ps.z);
      const airborne = clearance > C.slamAirClear;
      if (d < C.slamRadius && !airborne) {
        const falloff = 1 - 0.55 * (d / C.slamRadius);
        ctx.combat.hurtPlayer(C.slamDamage * falloff
          * SURVIVAL_CONFIG.enemyDamageMultiplier, {
          source: "abbess-slam", x: ps.x, y: ps.y + 1.0, z: ps.z,
        });
        /* Flattened, then left staggering. See slamStunSeconds. */
        ctx.player?.applyStun?.(C.slamStunSeconds);
        ctx.player?.applySlow?.(C.slamSlowFactor, C.slamSlowSeconds);
        ctx.player?.punch?.(2.6);
      } else if (d < C.slamRadius) {
        /* CLEARED IT, and it has to be legible as a dodge rather than
           as an attack that missed. One kick through the camera: the
           shock passes underneath. */
        ctx.player?.doctrineKick?.(0.7, 0.5);
        bus.emit("slamCleared", { x: ps.x, z: ps.z, clearance });
      }
    }
    /* Her own brood, through combat's authoritative shockwave so the
       kills count, the stuns apply and the kill feed sees them. */
    ctx.combat?.shockwave?.(cx, cy, cz, {
      radius: C.slamRadius,
      innerRadius: C.slamRadius * 0.35,
      damage: C.slamBroodDamage,
      stun: 1.6,
      knockSpeed: 11,
      source: "abbess-slam",
    });
    bus.emit("slam", { x: cx, y: cy, z: cz });
  }

  /* ANTICIPATION, as a fraction of the rise.
     The rise used to be a straight ramp from 0, which is the one curve
     nothing heavy has ever moved along: mass has to be gathered before
     it can be thrown. She now COILS first - the abdomen sinks against
     the floor and the sag deepens, because `raised` going negative
     feeds straight back through the same `sag`/`heave` pair that lifts
     it - and only then goes up, accelerating out of the crouch and
     easing into the hold at the top. Same three phases, same total
     duration, same peak: the fight harness asserts "rise > hold >
     fall" and a peak past 0.98, and both still hold. */
  const SLAM_COIL = 0.30;
  const SLAM_COIL_DEPTH = 0.17;

  function stepSlam(dt) {
    state.slamTime += dt;
    if (state.slamPhase === "rise") {
      const u = clamp01(state.slamTime / C.slamRise);
      state.raised = u < SLAM_COIL
        ? -SLAM_COIL_DEPTH * Math.sin((u / SLAM_COIL) * Math.PI)
        : smoothstep((u - SLAM_COIL) / (1 - SLAM_COIL));
      if (state.slamTime >= C.slamRise) {
        state.slamPhase = "hold";
        state.slamTime = 0;
      }
      return;
    }
    if (state.slamPhase === "hold") {
      state.raised = 1;
      if (state.slamTime >= C.slamHold) {
        state.slamPhase = "fall";
        state.slamTime = 0;
      }
      return;
    }
    // Falling, and fast: the whole read of the attack is that the rise
    // is slow enough to answer and the drop is not.
    state.raised = clamp01(1 - state.slamTime / C.slamFall);
    if (state.slamTime >= C.slamFall) {
      state.slamPhase = null;
      state.raised = 0;
      landSlam();
    }
  }

  /* ============================================================
     THE BITE

     Config and the reasoning are in `ABBESS_CONFIG`. What is here is
     the three-phase clock and the two things that make it fair: the
     tell is on the HEAD, which is the part of her the player is
     already looking at, and the damage is resolved at the strike
     frame rather than at the press.
     ============================================================ */

  /** Where the player is relative to her jaws: distance from the seat
   *  and how far off her facing they are. */
  function biteBearing() {
    const ps = ctx.player?.state;
    if (!ps || !inst) return null;
    const dx = ps.x - C.lairX;
    const dz = ps.z - C.lairZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-3) return { dist, off: 0, dx: Math.sin(inst.yaw), dz: Math.cos(inst.yaw) };
    let off = Math.atan2(dx, dz) - inst.yaw;
    while (off > Math.PI) off -= TAU;
    while (off < -Math.PI) off += TAU;
    return { dist, off: Math.abs(off), dx: dx / dist, dz: dz / dist };
  }

  /** In front of her, close enough, and not behind cover of her own
   *  body. Used both to START a bite and to RESOLVE one. */
  function biteReaches(range = C.biteRange) {
    const b = biteBearing();
    return !!b && b.dist <= range && b.off <= C.biteArc;
  }

  function beginBite() {
    state.bitePhase = "wind";
    state.biteTime = 0;
    state.biteTimer = C.biteCadence;
    state.bites += 1;
    /* The tell, and it is deliberately at the jaws rather than in the
       camera. She is the one thing on screen the player is already
       looking at; a screen shake would say "something is about to
       happen" where this says "THAT is about to happen". */
    const sx = Math.sin(inst.yaw);
    const sz = Math.cos(inst.yaw);
    ctx.vfx?.venomBurst?.(C.lairX + sx * 9.6, floorY + 2.4, C.lairZ + sz * 9.6, 1.5);
    bus.emit("biteTelegraph", { x: C.lairX, z: C.lairZ });
  }

  /** The snap. Re-checked against where the player IS, which is the
   *  whole of the answer to it: step out of the cone during the
   *  rear-back and twenty-six metres of animal closes on nothing. */
  function landBite() {
    const sx = Math.sin(inst.yaw);
    const sz = Math.cos(inst.yaw);
    const jx = C.lairX + sx * 11.4;
    const jz = C.lairZ + sz * 11.4;
    const jy = floorY + 1.4;
    ctx.vfx?.blast?.(jx, jy, jz, 3.4);
    ctx.vfx?.spark?.(jx, jy, jz, 3.0, false, true);
    ctx.vfx?.sandSpray?.(jx, floorY + 0.2, jz, 2.0, sx, sz);
    ctx.player?.punch?.(1.1);
    /* Her own mass answers the snap, down the length of her. */
    state.jigV -= 2.6;

    const ps = ctx.player?.state;
    const b = biteBearing();
    if (!ps || !ctx.combat || ctx.combat.player?.dead || !b
      || b.dist > C.biteRange || b.off > C.biteArc) {
      bus.emit("biteWhiff", { x: jx, z: jz });
      return false;
    }
    state.bitesLanded += 1;
    ctx.combat.hurtPlayer(C.biteDamage * SURVIVAL_CONFIG.enemyDamageMultiplier, {
      source: "abbess-bite", x: ps.x, y: ps.y + 1.2, z: ps.z,
    });
    /* AND THROWN OFF HER. Not a stun - the slam owns that verb, and
       two attacks that both end with the player on the floor is one
       attack with two animations. This one puts distance between the
       trooper and her jaws, which is a consequence they can act on:
       the fight resumes immediately, several metres further out. */
    ctx.player?.drag?.(b.dx * C.biteThrow, b.dz * C.biteThrow);
    ctx.player?.punch?.(2.2);
    ctx.player?.doctrineKick?.(1.0, 0.8);
    bus.emit("bite", { x: ps.x, z: ps.z, damage: C.biteDamage });
    return true;
  }

  function stepBite(dt) {
    state.biteTime += dt;
    if (state.bitePhase === "wind") {
      if (state.biteTime >= C.biteWindup) {
        state.bitePhase = "strike";
        state.biteTime = 0;
      }
      return;
    }
    if (state.bitePhase === "strike") {
      if (state.biteTime >= C.biteStrike) {
        landBite();
        state.bitePhase = "recover";
        state.biteTime = 0;
      }
      return;
    }
    if (state.biteTime >= C.biteRecover) {
      state.bitePhase = null;
      state.biteTime = 0;
    }
  }

  /* THE HEAD'S OWN POSE, read by `update` and by nothing else.

     Three numbers rather than a rig: the fore-body is one merged mesh
     (six vestigial legs, a thorax, a collar and a face, all baked into
     a single draw call) so the jaws cannot open independently without
     a second one. What the whole head CAN do is rear and lunge, and on
     an animal whose body does not move that is a bigger motion than
     any mandible would have been.

     `push` is metres along her facing, `pitch` is radians of nod
     (positive is nose DOWN, the same sign the brace uses) and `drop`
     is how far the whole fore-body sinks. She rears UP and BACK, then
     comes forward and down: the rear-back is eased with a cubic so the
     gather is slow and the release is not.

     AND THE FORWARD TRAVEL IS SMALL ON PURPOSE. The first pass threw
     the head 4.4m out and it tore the animal in half on camera: the
     collar plate is a skirt that laps about 1.7m over the abdomen's
     first rings (see its note - the join between two surfaces that
     both move has to be swallowed, not butted), and anything past that
     overlap slides the skirt clear and opens a hole where her waist
     should be. Photographed at the snap the fore-body was a separate
     object standing in front of a sac.

     So the reach is bought with ROTATION instead, which costs the join
     nothing: the jaws sit eleven metres in front of the pivot, so a
     fifth of a radian of nod swings them through better than two
     metres while the collar barely moves at all. */
  const BITE_BACK = 1.8;
  const BITE_PUSH = 1.5;
  function bitePose() {
    if (!state.bitePhase) return null;
    if (state.bitePhase === "wind") {
      const u = clamp01(state.biteTime / C.biteWindup);
      const e = u * u * u;
      return { push: -BITE_BACK * e, pitch: -0.22 * e, drop: -0.55 * e };
    }
    if (state.bitePhase === "strike") {
      const u = clamp01(state.biteTime / C.biteStrike);
      return {
        push: lerp(-BITE_BACK, BITE_PUSH, u),
        pitch: lerp(-0.22, 0.20, u),
        drop: lerp(-0.55, 0.45, u),
      };
    }
    const u = smoothstep(clamp01(state.biteTime / C.biteRecover));
    return {
      push: BITE_PUSH * (1 - u), pitch: 0.20 * (1 - u), drop: 0.45 * (1 - u),
    };
  }

  function beginRoyal() {
    state.phase = "royal";
    state.timer = C.royalSeconds;
    state.royalDone = true;
    state.raised = 0;
    state.slamPhase = null;
    state.bitePhase = null;
    ctx.mission?.announce?.("THE ABBESS LAYS A ROYAL CELL", 3.6);
    ctx.player?.doctrineKick?.(1.1, 0.9);
    bus.emit("royal", { x: C.lairX, z: C.lairZ });
  }

  /** Emergency brood surge. Non-boss enemies (Gleaners and Threshers)
   *  spawned at low health to protect the queen, replacing the boss spawn. */
  function hatchRoyal() {
    const sx = Math.sin(inst.yaw);
    const sz = Math.cos(inst.yaw);
    const back = C.abdomenLength + 12;
    const x = C.lairX - sx * back;
    const z = C.lairZ - sz * back;
    const spawnedKids = [];
    const count = 4;
    for (let i = 0; i < count; i += 1) {
      const spread = (i - (count - 1) * 0.5) * 3.6;
      const kx = x - sz * spread;
      const kz = z + sx * spread;
      const caste = i % 2 === 0 ? "gleaner" : "thresher";
      const kid = enemies.spawn(caste, kx, kz, {
        yaw: inst.yaw + Math.PI,
        emerge: { delay: i * 0.15, duration: 1.5, depth: 2.0 },
      });
      if (kid) {
        kid.alerted = true;
        kid.suspicion = 1;
        kid.abbessBornAt = atmos.elapsed;
        brood.push(kid);
        spawnedKids.push(kid);
      }
    }
    ctx.vfx?.breach?.(x, groundAt(x, z), z, 16, 2.8);
    bus.emit("royalHatch", { x, z, spawned: spawnedKids.length > 0, count: spawnedKids.length });
    return spawnedKids[0] || null;
  }

  function stepSeated(dt) {
    state.fightTime += dt;
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - C.lairX, ps.z - C.lairZ);

    if (!state.royalDone
      && inst.health <= inst.maxHealth * C.royalAtHealth) {
      beginRoyal();
      return;
    }

    if (state.slamPhase) { stepSlam(dt); return; }
    if (state.bitePhase) { stepBite(dt); return; }

    state.clutchTimer -= dt;
    state.slamTimer -= dt;
    state.biteTimer -= dt;

    if (state.clutchWind > 0) {
      state.clutchWind -= dt;
      if (state.clutchWind <= 0) layClutch();
      return;
    }

    /* THREE CLOCKS AND ONE DECISION, and the player owns the decision
       entirely by where they stand.

       In her face: the bite, which is answered by leaving her cone.
       Out on the floor beside her: the slam, answered by leaving the
       ground. Further out than either: the clutch, answered by coming
       back in - and, since the clutch reads the same distance to
       decide how much of itself hatches shooting, answered LESS well
       the longer they stay out there.

       Ordered nearest-first. The bite is checked before the slam
       because its range is inside the slam's: a player standing at her
       jaws should get snapped at rather than heaved upon, and the
       snap gives the face armour its reason to exist. */
    if (state.biteTimer <= 0 && biteReaches()) {
      beginBite();
      return;
    }

    if (state.slamTimer <= 0 && dist < C.slamRange) {
      beginSlam();
      return;
    }

    if (state.clutchTimer <= 0) beginClutch();
  }

  function stepRoyal(dt) {
    state.fightTime += dt;
    state.timer = Math.max(0, state.timer - dt);
    // The cell swells on the same wave the ordinary clutch rides.
    state.wave = clamp01(1 - state.timer / C.royalSeconds);
    if (state.timer <= 0) {
      hatchRoyal();
      state.phase = "seated";
      state.wave = -1;
      state.clutchTimer = C.clutchCadence * 0.6;
      state.slamTimer = C.slamCadence * 0.4;
      state.biteTimer = C.biteCadence * 0.5;
    }
  }

  function beginRouse() {
    state.phase = "rouse";
    state.timer = C.rouseSeconds;
    setEncounterGate(false, true);
    ctx.mission?.announce?.("THE ABBESS WAKES", 3.4);
    bus.emit("aggro", { x: C.lairX, z: C.lairZ });
    if (state.revealed) return;
    state.revealed = true;
    if (ctx.player?.setFree && !ctx.player.state.free) {
      /* Framed down the LENGTH of her, from behind the ovipositor
         toward the head. It is the only angle that says what she is:
         a body the camera has to travel to get past. */
      const sx = Math.sin(C.yaw);
      const sz = Math.cos(C.yaw);
      const camX = C.lairX - sx * (C.abdomenLength + 16) - sz * 9;
      const camZ = C.lairZ - sz * (C.abdomenLength + 16) + sx * 9;
      /* Ray-tested before use: sixteen spires lean inward over the
         Throat, and from some of their gaps this down-the-length shot
         opens on a spire flank instead of the queen. The solver keeps
         the authored framing when it can see her and walks the fan
         when it cannot. See reveal-camera.js. */
      revealCamera(ctx, {
        label: "abbess",
        preferred: [camX, groundAt(camX, camZ) + 7, camZ],
        target: [C.lairX, floorY + 3.5, C.lairZ],
        halfHeight: 6, halfWidth: 7,
        floorY: floorY + 1,
        fov: 50,
      });
      state.releaseCameraAt = 0.8;
    }
  }

  function releaseEncounterCamera() {
    ctx.player?.setFree?.(false);
    state.releaseCameraAt = undefined;
  }

  function beginRetire() {
    healToFull();
    clearHazards();
    state.phase = "retire";
    state.timer = C.retireSeconds;
    state.disengageFor = 0;
    state.fightTime = 0;
    state.raised = 0;
    state.slamPhase = null;
    state.bitePhase = null;
    state.clutchWind = 0;
    releaseEncounterCamera();
    bus.emit("retiring", { x: C.lairX, z: C.lairZ });
  }

  function setEncounterGate(hidden, locked = hidden) {
    if (!inst) return;
    inst.encounterHidden = !!hidden;
    inst.encounterLocked = !!locked;
    if (inst.root) inst.root.visible = false;   // an empty anchor
    group.visible = !hidden;
  }

  function stepInstance(dt) {
    if (!inst) return;
    if (inst.state === "death" || inst.health <= 0) {
      if (!state.defeated) {
        state.defeated = true;
        state.phase = "dead";
        if (inst.state !== "death") enemies.kill?.(inst);
        clearHazards();
        ctx.vfx?.breach?.(C.lairX, floorY, C.lairZ, 24, 3.4);
        ctx.player?.doctrineKick?.(1.8, 1.6);
        /* A DEATH THAT IS A PHYSICAL EVENT, not a fade. The clock
           `deathT` drives it and `poseAbdomen` reads it: the sac
           empties to half its volume over three seconds, the brood
           light in it goes out over the same time, the body settles
           twice on the spring, and what came out of her stays on the
           chamber floor. `clearHazards` runs FIRST, so the reset it
           does to the spring is overwritten by the kick below rather
           than the other way round. */
        state.deathT = 0;
        state.jigV = -7.5;
        ctx.vfx?.venomBurst?.(C.lairX, floorY + 3.4, C.lairZ, 3.2);
        stainGround(C.lairX - Math.sin(state.sacYaw) * C.abdomenLength * 0.45,
          C.lairZ - Math.cos(state.sacYaw) * C.abdomenLength * 0.45,
          14, 0.62, true);
        bus.emit("defeated", { x: C.lairX, z: C.lairZ });
      }
      return;
    }

    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - C.lairX, ps.z - C.lairZ);

    if (state.phase === "dormant") {
      if (!ctx.combat?.player?.dead && dist <= C.aggroRadius) beginRouse();
      return;
    }

    if (state.phase === "retire") {
      state.timer = Math.max(0, state.timer - dt);
      if (dist <= C.aggroRadius && !ctx.combat?.player?.dead) {
        state.phase = "rouse";
        state.timer = C.rouseSeconds * (1 - state.woken);
        setEncounterGate(false, true);
        bus.emit("aggro", { x: C.lairX, z: C.lairZ });
        return;
      }
      if (state.timer <= 0) {
        state.phase = "dormant";
        state.revealed = false;
        setEncounterGate(true, true);
        bus.emit("reset", { x: C.lairX, z: C.lairZ });
      }
      return;
    }

    if (dist > C.disengageRadius) {
      state.disengageFor += dt;
      if (state.disengageFor > C.disengageSeconds) { beginRetire(); return; }
    } else {
      state.disengageFor = 0;
    }

    /* AND SHE COMMITS TO WHERE SHE IS BITING.

       Her head tracks at 0.9 the rest of the time, which is what makes
       her armour follow the player around the room. Through a bite it
       falls away to nothing over the rear-back and stays there for the
       snap - so the heading she strikes at is the one she had about a
       third of the way into the tell, not the one she has at contact.

       Without this the attack is unanswerable in the only direction
       that should answer it: 0.9 is fast enough to hold a sprinting
       player inside a 49-degree cone for the whole 0.78s, and a strike
       re-check that always passes is a strike with no tell at all. */
    const committing = state.bitePhase === "wind"
      ? 1 - clamp01((state.biteTime / C.biteWindup - 0.3) / 0.35)
      : state.bitePhase ? 0 : 1;
    faceTowards(ps.x, ps.z, 0.9 * committing, dt);

    if (state.phase === "rouse") {
      /* FLOORED, never left to run away negative. The Coulter's own
         comment says why and this encounter proved it again: a phase
         that overshoots by one frame writes `timer: -0.02` into the
         save, the schema validator refuses a negative duration, and the
         whole file is rejected with no indication that a boss's spare
         two hundredths of a second is the reason. "Ready" is a state,
         not a quantity. */
      state.timer = Math.max(0, state.timer - dt);
      if (state.releaseCameraAt !== undefined && state.timer <= state.releaseCameraAt) {
        releaseEncounterCamera();
      }
      if (state.timer <= 0) {
        releaseEncounterCamera();
        state.phase = "seated";
        setEncounterGate(false, false);
        bus.emit("engaged", { x: C.lairX, z: C.lairZ });
      }
      return;
    }

    if (state.phase === "seated") stepSeated(dt);
    else if (state.phase === "royal") stepRoyal(dt);
  }

  /* ------------------------------------------------------------
     PER-FRAME
     ------------------------------------------------------------ */

  /* ============================================================
     WHERE SHE WAS HIT

     combat.js already publishes every landed hit with a world position
     on it - `enemyDamaged` - and hud.js already listens for the damage
     numbers. Subscribing to the same event is how this module finds
     out WHERE a shot landed without combat.js needing to know the
     Abbess exists, which is the same shape as the Stylite's grip hook
     in reverse.

     LAZY, because `ctx.combat` does not exist when this module is
     built - district-bosses.js constructs the encounters before the
     first frame and combat after. Attached on the first update that
     finds a bus, once.
     ============================================================ */
  let hitSub = null;
  function ensureHitSubscription() {
    if (hitSub || !ctx.combat?.bus?.on) return;
    hitSub = ctx.combat.bus.on("enemyDamaged", (event) => {
      if (!inst || !event || event.enemyId !== inst.id) return;
      onHurt(event);
    });
  }

  /** Flinch, ichor and a kick into the settle spring, placed on the
   *  ring the shot actually reached. */
  function onHurt(event) {
    /* Nearest ring in the XZ plane AND in height, so a shot into the
       raised abdomen flinches the part that is nine metres up rather
       than the part still on the floor. */
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < segs; i += 1) {
      const dx = spine[i].x - event.x;
      const dy = spine[i].y - event.y;
      const dz = spine[i].z - event.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    /* Past the far end of the sac it was the thorax that was hit, and
       the thorax is rigid armour - it does not dent, so the flinch
       stays off it and only the spring is kicked. */
    const onSac = bestD < 64;
    if (onSac) {
      state.hitRing = best;
      state.hitAmt = Math.min(1, state.hitAmt + (event.weak ? 0.85 : 0.45));
    }
    state.jigV -= event.weak ? 1.5 : 0.55;
    /* THE ICHOR. A weak-point hit sprays; anything else weeps. Either
       way it lands on the floor and stays there - see `stainGround`,
       which rate-limits itself. */
    if (onSac) {
      ctx.vfx?.venomBurst?.(event.x, event.y, event.z, event.weak ? 1.5 : 0.8);
      stainGround(spine[best].x, spine[best].z,
        2.4 + (event.weak ? 2.0 : 0), event.weak ? 0.55 : 0.34);
    }
  }

  /* The damage the surface kit is currently showing, so the uniform is
     only written when it has actually moved. */
  let shownDamage = -1;
  function syncSurfaceDamage() {
    const hurt = state.deathT >= 0 ? 1 : sickness();
    if (Math.abs(hurt - shownDamage) < 0.015) return;
    shownDamage = hurt;
    /* IT ACCUMULATES AND IT STAYS. The kit pools scorch in the coarse
       mottle, cracks the deepest creases, glazes the breaks wet and
       lights an ember in them late (squared in damage, so a boss at
       90% health does not already look finished). The sac takes it
       full; the plate takes less, because armour is the part that is
       supposed to still be there at the end. */
    setSurfaceDamage(sacMat, hurt);
    setSurfaceDamage(chitinMat, hurt * 0.72);
    /* The tergites take MORE than the head's plate and less than the
       membrane. They are the armour the player is actually shooting -
       everything worth hitting is behind them - so a queen at the end
       of a fight whose back plates are unmarked is a queen nobody has
       been shooting. */
    setSurfaceDamage(tergiteMat, hurt * 0.88);
  }

  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    if (!inst) { ensureSpawned(); return; }
    ensureHitSubscription();

    stepInstance(d);
    syncSurfaceDamage();

    /* Capped, and the cap is load-bearing: past the settle the body is
       a corpse and `poseAbdomen` stops rewriting it entirely (see its
       gate), so a killed boss costs the rest of the session nothing. */
    if (state.deathT >= 0) state.deathT = Math.min(9, state.deathT + d);

    const wantWoken = state.phase === "dormant" ? 0
      : state.phase === "retire" ? 0 : 1;
    state.woken = state.phase === "rouse"
      ? clamp01(1 - state.timer / Math.max(1e-4, C.rouseSeconds))
      : damp(state.woken, wantWoken, 1.4, d);

    // The laying wave, once it has been started.
    if (state.wave >= 0 && state.phase !== "royal") {
      state.wave += d * 0.62;
      if (state.wave > 1.25) state.wave = -1;
    }

    poseAbdomen(d);

    /* THE FORE-BODY BRACES. Her six legs are vestigial and cannot
       carry her, which is exactly why they have to be seen trying:
       before a clutch and through the slam's coil the whole front of
       the animal drops and pitches forward onto them, and it comes
       back up as the abdomen goes. It is two numbers on a group that
       was previously nailed to the floor, and it is the only
       anticipation the player can see from in front of her - which is
       where her armour, and therefore most of the fight, is.

       The legs are baked into the merged fore-body geometry and cannot
       move independently without a second draw call for a thirty-
       centimetre motion; the body settling onto them says the same
       thing for nothing. */
    const brace = clamp01(
      (state.clutchWind > 0 ? state.clutchWind / C.clutchWindup : 0)
      + Math.max(0, -state.raised / SLAM_COIL_DEPTH));
    /* ...and it LUNGES. The bite's own pose, layered on top of the
       brace: `push` metres along her facing, a nod, and the crouch
       she gathers into. See `bitePose`, which is where the curve
       lives. */
    const bp = bitePose();
    const bsx = bp ? Math.sin(inst.yaw) * bp.push : 0;
    const bsz = bp ? Math.cos(inst.yaw) * bp.push : 0;
    head.rotation.y = inst.yaw;
    head.rotation.x = brace * 0.075 + state.jigY * 0.010 + (bp ? bp.pitch : 0);
    head.position.set(C.lairX + bsx,
      floorY - brace * 0.42 + state.jigY * 0.06 - (bp ? bp.drop : 0),
      C.lairZ + bsz);
    head.visible = shown();
    head.updateMatrixWorld(true);
    /* AFTER the pose, never before: the capsules the player is being
       held out of have to be the ones that were just drawn, or the
       correction is a frame behind a body that breathes and heaves. */
    keepOut();

    updateEggs(d);
    updateBrood(d);

    /* THE SPINE, PUBLISHED. combat.js's hit tests read this directly -
       see HITBOX.abbess - so the volume the player shoots at is the
       pose they are looking at, including mid-slam when twenty metres
       of it is nine metres in the air. */
    inst.sacSpine = spine;
    inst.sacRadius = spineRadius;
    inst.raised = state.raised;

    /* Mirrored onto the instance for the HUD, the minimap, the mission
       marker and the arena check. Her origin is her THORAX, not the
       middle of her mass: it is where the player aims when they are
       aiming at "her", and it is where the objective arrow should
       land. */
    inst.x = C.lairX;
    inst.z = C.lairZ;
    inst.y = floorY;
    inst.alerted = state.phase !== "dormant";
    inst.suspicion = inst.alerted ? 1 : 0;
    inst.root.position.set(inst.x, inst.y, inst.z);

    /* Spore and dust off the sac while she works. Cheap, and it is what
       keeps a mostly-static animal from reading as scenery between
       attacks. */
    if (state.woken > 0.4) {
      state.dustTick -= d;
      if (state.dustTick <= 0) {
        state.dustTick = 0.22;
        const sx = Math.sin(inst.yaw);
        const sz = Math.cos(inst.yaw);
        const t = rng();
        ctx.vfx?.venomGas?.(
          C.lairX - sx * t * C.abdomenLength,
          floorY + 1.5 + state.raised * 5,
          C.lairZ - sz * t * C.abdomenLength, 3.2, 0.5);
      }
    }
  }

  /* ============================================================
     LIFECYCLE
     ============================================================ */

  function healToFull() {
    if (!inst) return;
    inst.health = inst.maxHealth;
    inst.raised = 0;
  }

  function clearHazards() {
    for (const egg of eggs) { egg.live = false; egg.burst = 0; }
    /* Her children are hers. Leaving a cap of Threshers standing in the
       chamber after a reset means the next approach starts mid-fight
       against a swarm nobody saw arrive. */
    for (const kid of [...brood]) {
      kid.selfDriven = false;
      enemies.remove?.(kid);
    }
    brood.length = 0;
    state.wave = -1;
    state.raised = 0;
    state.slamPhase = null;
    /* A half-thrown bite is a physical state like the spring below:
       leaving one mid-lunge across a retire brings her head back out
       on the frame she wakes, at an animal nobody has approached. */
    state.bitePhase = null;
    state.biteTime = 0;
    /* THE PHYSICAL STATE GOES WITH THE HAZARDS. None of these are ever
       saved (see the note on `state`), so this and `resetToSeat` are
       the only places they are cleared - and a settle spring or a
       half-decayed flinch left across a retire would come back the
       moment she woke, on a body that had not been touched. */
    state.jigY = 0;
    state.jigV = 0;
    state.hitAmt = 0;
    state.hitRing = -1;
  }

  function ensureSpawned() {
    if (state.defeated) return null;
    if (inst) return inst;
    inst = enemies.spawn("abbess", C.lairX, C.lairZ, {
      yaw: C.yaw,
      eventId: "district-boss:bloom",
    });
    if (!inst) return null;
    inst.sacSpine = spine;
    inst.sacRadius = spineRadius;
    inst.raised = 0;
    poseAbdomen(0, true);
    setEncounterGate(true, true);
    return inst;
  }

  function resetToSeat() {
    state.defeated = false;
    if (!inst) ensureSpawned();
    if (!inst) return;
    healToFull();
    clearHazards();
    state.phase = "dormant";
    state.timer = 0;
    state.woken = 0;
    state.raised = 0;
    state.revealed = false;
    state.disengageFor = 0;
    state.fightTime = 0;
    state.royalDone = false;
    releaseEncounterCamera();
    state.clutchTimer = C.clutchCadence * 0.45;
    state.clutchWind = 0;
    state.slamTimer = C.slamCadence * 0.7;
    state.biteTimer = C.biteCadence * 0.55;
    state.fed = 0;
    state.laid = 0;
    state.bites = 0;
    state.bitesLanded = 0;
    /* A reset is a resurrection: the death clock has to go, or she
       comes back deflated and unlit with her surface still scorched
       from a fight that no longer happened. */
    state.deathT = -1;
    state.sacYaw = C.yaw;
    shownDamage = -1;
    syncSurfaceDamage();
    inst.yaw = C.yaw;
    poseAbdomen(0, true);
    setEncounterGate(true, true);
    bus.emit("reset", { x: C.lairX, z: C.lairZ });
  }

  function liveEggs() {
    return eggs.filter((e) => e.live).length;
  }

  function status() {
    if (!inst) {
      return state.defeated ? {
        phase: "dead", dead: true, defeated: true,
        health: 0, maxHealth: 12000, x: C.lairX, z: C.lairZ,
      } : null;
    }
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      health: Math.max(0, Math.round(inst.health)),
      maxHealth: Math.round(inst.maxHealth),
      woken: Number(state.woken.toFixed(3)),
      raised: Number(state.raised.toFixed(3)),
      slamming: !!state.slamPhase,
      slamPhase: state.slamPhase,
      biting: !!state.bitePhase,
      bitePhase: state.bitePhase,
      bites: state.bites,
      bitesLanded: state.bitesLanded,
      exposed: state.raised > 0.5,
      fightTime: Number(state.fightTime.toFixed(1)),
      eggs: liveEggs(),
      brood: brood.length,
      broodCap: C.broodCap,
      fed: state.fed,
      laid: state.laid,
      royalDone: state.royalDone,
      hidden: !!inst.encounterHidden,
      locked: !!inst.encounterLocked,
      dead: inst.state === "death",
      x: C.lairX,
      z: C.lairZ,
    };
  }

  function snapshot() {
    if (!inst) {
      return state.defeated ? {
        phase: "dead", timer: 0, instanceId: null, health: 0,
        maxHealth: 12000, royalDone: true, defeated: true,
      } : null;
    }
    /* Eggs and living brood are deliberately NOT persisted, for the
       Coulter's reason: they are seconds-long consequences of an attack,
       and restoring into a chamber full of hatchlings the player never
       saw laid is worse than losing them. `royalDone` IS saved - it is
       a once-per-encounter beat, and repeating it on every load would
       hand the player an unlimited supply of Matriarchs. */
    return {
      phase: state.phase,
      instanceId: state.defeated || inst.state === "death" ? null : inst.id,
      timer: Number(Math.max(0, state.timer).toFixed(2)),
      fightTime: Number(state.fightTime.toFixed(1)),
      health: Math.round(inst.health),
      maxHealth: Math.round(inst.maxHealth),
      royalDone: state.royalDone,
      fed: state.fed,
      laid: state.laid,
      defeated: state.defeated,
    };
  }

  function restore(saved, restoredEnemies = {}) {
    if (!saved || typeof saved !== "object") return false;
    const byId = restoredEnemies?.byId instanceof Map ? restoredEnemies.byId : new Map();
    const rebound = (typeof saved.instanceId === "string" && byId.get(saved.instanceId))
      || enemies.live.find((c) => c.eventId === "district-boss:bloom" && c.key === "abbess")
      || enemies.live.find((c) => c.key === "abbess");
    state.defeated = !!saved.defeated || saved.phase === "dead" || saved.health <= 0;
    if (state.defeated) {
      if (rebound) enemies.remove?.(rebound);
      inst = null;
      state.phase = "dead";
      state.woken = 0;
      // Past the settle, so nothing is posed for a boss nobody can see.
      state.deathT = 9;
      group.visible = false;
      clearHazards();
      return true;
    }
    inst = rebound || null;
    ensureSpawned();
    if (!inst) return false;
    const phase = ["dormant", "rouse", "seated", "royal", "retire", "dead"]
      .includes(saved.phase) ? saved.phase : "dormant";
    state.phase = phase;
    state.revealed = phase !== "dormant";
    state.timer = Math.max(0, Number(saved.timer) || 0);
    state.fightTime = Math.max(0, Number(saved.fightTime) || 0);
    state.woken = phase === "dormant" || phase === "retire" ? 0 : 1;
    state.royalDone = !!saved.royalDone;
    state.fed = Math.max(0, Math.round(Number(saved.fed) || 0));
    state.laid = Math.max(0, Math.round(Number(saved.laid) || 0));
    state.raised = 0;
    state.slamPhase = null;
    state.bitePhase = null;
    state.clutchWind = 0;
    state.biteTimer = C.biteCadence * 0.55;
    state.disengageFor = 0;
    state.releaseCameraAt = undefined;
    clearHazards();
    if (Number.isFinite(saved.health)) {
      inst.health = clamp(saved.health, 1, inst.maxHealth);
    }
    inst.yaw = C.yaw;
    /* The death clock and the abdomen's heading are NOT in the save
       file and must not survive one - a load into a live fight from a
       session where she had already died would otherwise restore a
       deflated, unlit queen at full health. The surface damage IS
       restored, because it is a function of the health that was saved:
       loading at 20% has to look like 20%. */
    state.deathT = -1;
    state.sacYaw = C.yaw;
    shownDamage = -1;
    syncSurfaceDamage();
    poseAbdomen(0, true);
    setEncounterGate(phase === "dormant", phase === "dormant" || phase === "rouse");
    return true;
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
    ensureSpawned,
    /** Every ground-reaching damage path in combat.js calls this so an
     *  egg can be shot, swung at or blown up. Eggs are not enemies and
     *  cannot be routed to through `enemies.live`. */
    hitEggs,
    /** Live eggs, for the HUD and for checks. */
    eggs() {
      return eggs.filter((e) => e.live).map((e) => ({
        x: Number(e.x.toFixed(2)), y: Number(e.y.toFixed(2)),
        z: Number(e.z.toFixed(2)), t: Number(e.t.toFixed(3)),
        hp: Math.max(0, Math.round(e.hp)), caste: e.caste,
      }));
    },
    /* HER children, with the caste each of them came out of an egg
       as - a clutch is no longer one species, so "how many did she
       put in the room" is now two questions. */
    brood() {
      return brood.map((k) => ({
        id: k.id, key: k.key, x: k.x, z: k.z, alerted: !!k.alerted,
      }));
    },
    /** Fold her back down, with the animation. The arena boundary's
     *  reset path - see district-bosses.js. */
    retire() {
      if (!inst || state.defeated) return null;
      if (state.phase === "dormant" || state.phase === "retire") return null;
      beginRetire();
      return { phase: state.phase, timer: state.timer };
    },
    resetToSeat,
    forcePhase(phase, timer) {
      if (!inst) return null;
      state.phase = String(phase);
      if (Number.isFinite(timer)) state.timer = timer;
      state.woken = state.phase === "dormant" || state.phase === "retire" ? 0 : 1;
      setEncounterGate(state.phase === "dormant",
        state.phase === "dormant" || state.phase === "rouse");
      poseAbdomen(0, true);
      return { phase: state.phase, timer: state.timer, woken: state.woken };
    },
    /** Throw a clutch now, through the production path. */
    forceClutch() {
      if (!inst || state.phase === "dormant") return null;
      layClutch();
      return { eggs: liveEggs() };
    },
    /** ...and a slam, likewise. */
    forceSlam() {
      if (!inst || state.phase === "dormant") return null;
      beginSlam();
      return { slamPhase: state.slamPhase };
    },
    /** ...and a bite. Reports whether the player was in the cone at the
     *  moment it was thrown, so a check can tell "she missed" from
     *  "she never tried". */
    forceBite() {
      if (!inst || state.phase === "dormant") return null;
      const reached = biteReaches();
      beginBite();
      return { bitePhase: state.bitePhase, inCone: reached };
    },
    /** Age the whole brood past its hunting window, so a check about
     *  trophallaxis does not have to wait eleven seconds per child. */
    recallBrood() {
      for (const kid of brood) kid.abbessBornAt = -1e6;
      return brood.length;
    },
    instance() { return inst; },
    dispose() { scene.remove(group); },
  };
}
