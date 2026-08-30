/* ============================================================
   SAINTFALL - Kenosis operative kits ("doctrines")

   The White Vigil and the Bastion Penitent each get a complete
   verb set here, at parity with Vesper's campaign kit: every
   ability has an input, a refusal reason, an animation, VFX, SFX
   and a status() the HUD and the harness can read.

   THE DOCTRINE OF THE WING - White Vigil, reliquary scout:
   - paired crescent volley (LMB; RMB raises/focuses the guns),
     resolved by summit-discharge with this kit's weapon numbers;
   - Vigil Step (E): a 12m combat translation on charges, walked
     through the collision field rather than through walls;
   - quick blades: the shared melee procession at 1.30x tempo,
     swung by the crescents themselves (dual pistol-whip);
   - the Augur pack carries 30% more reliquary charge and refills
     faster (figure.jetpackProfile, jetpack.js).

   THE DOCTRINE OF THE CENSER - Bastion Penitent, reliquary
   bulwark:
   - the tower shield (E, held): an unlimited physical guard with
     no charge cost, installed as the level's `ctx.shield` so the
     player controller and combat's hurtPlayer treat it exactly
     like an Aegis that never runs dry. Frontal only, and wider
     than the Aegis - a wall, not a bubble;
   - the Hammer Cast (RMB): the reliquary hammer thrown flat
     through everything in its line, knocking flyers out of the
     sky (combat.groundFlyer), then RETURNING to the fist;
   - the shared melee procession at 0.78x tempo with bulwark
     damage - each blow a bell;
   - the Censer pack cannot fly: the flight chord is a single
     jet-boosted leap (jetpack.js leap mode), and the airborne
     melee press is the Penitent's Fall it always was.

   Built AFTER player, loadout, jetpack, and (when the level
   carries them) combat/enemies/boost/slam. This module wraps the
   loadout's arm hooks - the swings are additive offsets over the
   carry, driven by the player's own action clock - and publishes
   `ctx.loadout.meleeSpec`, which is what opens player.meleeSwing
   and combat.meleeStrike on a level with no ctx.weapons.
   ============================================================ */

import { clamp, clamp01 } from "saintfall/core.js";
import { GUARD_TYPES, normalizeGuardDetail } from "saintfall/guard-rules.js";

/* One kit per operative. Damage numbers are authored against the
   campaign bestiary (Thresher 60 / Gleaner 150 / Harrow 420) so the
   trials ground plays at campaign weight. */
const KITS = {
  "white-vigil": {
    doctrine: "Doctrine of the Wing",
    melee: {
      /* Read by player.meleeSwing and combat.meleeStrike in place of
         a weapons-module spec. Reach is a blade in each fist, not a
         polearm; the tempo advantage is the identity. `sweepScale`
         sizes the crescent VFX to the weapon - a wrist blade draws
         slightly tighter than the lance the shapes were measured on. */
      melee: true, reach: 1.85, damage: 46, sweepScale: 0.92,
    },
    blink: {
      range: 12.0, charges: 2, recharge: 5.5,
      /* Post-step momentum: arriving dead-stopped reads as a hitch,
         not a technique. */
      exitSpeed: 9.0,
    },
    /* THE STOOP - the scout's airborne melee, and it is AIMED. The
       bulwark's answer to being in the air is the Penitent's Fall,
       which only ever goes down; a skirmisher's answer is a line.
       The thrust flies wherever the reticle points, which at a flat
       aim is a fully horizontal lance across the sky and at a steep
       one is a dive - the same verb, and the player picks. */
    thrust: {
      speed: 34.0, seconds: 0.62, cooldown: 1.1,
      radius: 1.9, damage: 92, knockback: 12,
      /* Aim clamps. Down is nearly unlimited (a dive is the point);
         up is held well short of vertical so the stoop cannot be
         flown as a second jetpack. */
      pitchDown: -1.35, pitchUp: 0.42,
      /* What is left of the line when it runs out: enough to carry
         into the fall rather than stopping dead in the air. */
      exitSpeed: 12.0,
    },
    discharge: {
      /* Consumed by summit-discharge: the crescents become a real
         mid-range weapon. Sustained 137 dps at the muzzle, falling
         past focusStart toward rangeM. */
      damage: 26, range: 42, speed: 46, falloffStart: 26, falloffFloor: 0.55,
      spreadHip: 0.030, spreadAds: 0.007,
    },
  },
  "bastion-penitent": {
    doctrine: "Doctrine of the Censer",
    /* The reliquary is the biggest thing anyone swings on this
       mountain, and its crescent has to say so: half again the
       lance's sweep. */
    melee: { melee: true, reach: 2.60, damage: 132, sweepScale: 1.55 },
    block: {
      moveSpeed: 2.0, frontDot: 0.30, perfectWindow: 0.25,
      distance: 0.98, centreY: 1.15,
    },
    hammer: {
      damage: 260, returnDamage: 130, speed: 34, returnSpeed: 40,
      range: 46, cooldown: 8.0, knockdownStun: 3.0, knockback: 14,
    },
  },
};

/* An additive arm track: [u, outboard, up, forward] control points,
   linearly interpolated on the action's own normalized clock. The
   outboard column is side-signed at evaluation so one authored curve
   serves either fist. Amplitudes are rest-target offsets in
   figure-root metres - the same channel as the loadout's carry and
   fire poses - and the arm solver's own reach clamps keep any of
   them anatomical. */
/* The arc is authored as an ARC, and it is authored ON THE ARM'S OWN
   SPHERE. A hand can only be where the arm reaches - a lateral
   target thrown past that sphere is CLAMPED by the rest-arm solve,
   and the first cut of these tracks lost a third of its travel to
   exactly that (measured: a 0.64m authored sweep arrived as 0.41m).
   So each swing is three points a shoulder can actually visit at
   full-ish extension: wind-up OUT-BACK-LOW behind the shoulder
   line, an APEX high over it, and the carve ACROSS the midline at
   chest height - roughly 140 degrees of shoulder travel, which is
   what a big swing is. The chest/pelvis channels of the shared
   clips carry the shoulder itself through another half turn on top. */
/* THE SCOUT'S TRACKS ARE LEFT AS THEY WERE, AND THAT IS A DECISION.

   The Vigil has the same phrasing fault the Bastion had - its coil is
   quicker than its carve, so melee1 peaks at 0.23 of the clip against
   a damage window of 0.41-0.64. The identical fix was authored,
   measured, and REVERTED: at 1.30x tempo these clips are about 35
   frames long against the Bastion's 58, and a strike segment narrow
   enough to sit inside the window is then only three or four frames
   wide. Measured, that traded the contact-phase win for a worse
   worst-frame (jolt 2.78 -> 4.35 on melee2) - a net loss on a kit
   that plays acceptably today.

   A short clip wants FEWER, wider beats, which is what these already
   are. Fixing the Vigil properly means lengthening its clips or
   moving its hit windows, which changes how the whole kit trades and
   is not what was asked for here. Recorded in the probe as a known
   baseline so a genuine regression still trips. */
const VIGIL_TRACKS = {
  strike: [
    [0.00, 0.000, 0.000, 0.000],
    [0.18, 0.420, 0.140, -0.420],
    [0.34, 0.020, 0.470, 0.320],
    [0.52, -0.560, 0.180, 0.260],
    [0.76, -0.140, 0.060, 0.110],
    [1.00, 0.000, 0.000, 0.000],
  ],
  /* melee2 is the OTHER fist, so its wind-up and carve run the other
     way across the body - a true backhand, not the opener again. */
  backhand: [
    [0.00, 0.000, 0.000, 0.000],
    [0.18, 0.400, 0.060, -0.300],
    [0.34, 0.060, 0.420, 0.340],
    [0.52, -0.520, 0.240, 0.300],
    [0.76, -0.130, 0.080, 0.120],
    [1.00, 0.000, 0.000, 0.000],
  ],
  /* melee3 swings BOTH blades: the tracks mirror through the side
     sign, so the pair opens wide and scissors shut through centre. */
  crossCut: [
    [0.00, 0.000, 0.000, 0.000],
    [0.22, 0.480, 0.420, -0.240],
    [0.38, 0.240, 0.620, 0.180],
    [0.56, -0.300, 0.140, 0.480],
    [0.80, -0.080, 0.040, 0.180],
    [1.00, 0.000, 0.000, 0.000],
  ],
  turn: [
    [0.00, 0.000, 0.000, 0.000],
    [0.26, 0.440, 0.200, -0.140],
    [0.48, 0.050, 0.400, 0.320],
    [0.68, -0.420, 0.160, 0.300],
    [1.00, 0.000, 0.000, 0.000],
  ],
  lunge: [
    [0.00, 0.000, 0.000, 0.000],
    [0.25, 0.180, 0.080, -0.400],
    [0.45, -0.200, 0.240, 0.560],
    [0.75, -0.060, 0.080, 0.200],
    [1.00, 0.000, 0.000, 0.000],
  ],
};
/* THE BULWARK SWINGS WIDER THAN THE SCOUT. Its arm is 0.72m against
   the Vigil's 0.55m and it is swinging a two-handed reliquary rather
   than a wrist blade, so every one of these travels further, higher
   and slower than its Vigil counterpart - the tempo difference
   (0.78x vs 1.30x) then does the rest of the work. */
/* THE BULWARK SWINGS WIDER THAN THE SCOUT. Its arm is 0.72m against
   the Vigil's 0.55m and it is swinging a two-handed reliquary rather
   than a wrist blade, so every one of these travels further, higher
   and slower than its Vigil counterpart - the tempo difference
   (0.78x vs 1.30x) then does the rest of the work.

   PHRASED FOR WEIGHT, NOT JUST SLOWED DOWN. The first cut of these
   spent its speed in the WIND-UP: measured, the coil-to-apex move
   was the fastest thing in the clip and the hammer was already
   decelerating by the time the damage window opened, which is the
   difference between a blow that lands and a prop that arrives.
   Every track below is now four beats:

     0.00 - 0.34   COIL. Most of the clip's TIME and little of its
                   speed. This is where the mass is sold.
     0.34 - 0.44   turn-over: the hammer goes over the top.
     0.44 - 0.60   THE STRIKE, and the fastest segment by 2-3x.
                   Placed to sit INSIDE the clip's own hit window
                   (melee1 0.41-0.64, melee2 0.36-0.62, melee3
                   0.35-0.54, turn 0.29-0.53, lunge 0.37-0.56) so
                   contact happens at the top of the swing.
     0.60 - 1.00   follow-through and recovery, CARRYING ON in the
                   direction the blow was travelling. The old crown
                   track reversed here, and a reversal has to pass
                   through zero speed - which the probe caught as a
                   swing stopping in the middle of itself. */
const BASTION_TRACKS = {
  /* THE OPENER IS A THRUST. Two things make it one rather than a
     small swing: the hand travels almost entirely on the FORWARD
     axis, and the wrist barely turns at all - a tenth of what the
     carve below does. The old opener's 2.2-radian wrist sweep, with
     the shared clip's chest counter-rotation under it, is what read
     from play as a twist mid-swing.

     Same four beats as everything else: a slow draw back to the hip,
     a short gather, the drive - fastest by more than 2x and centred
     on the clip's own hit window - then extension held before the
     recovery. See `summit-player.js` for the body clip that goes
     with it and for why holding forward turns this into the lunge. */
  thrust: [
    [0.00, 0.000, 0.000, 0.000],
    [0.14, 0.200, -0.040, -0.250],
    /* THE THREE AXES REVERSE AT DIFFERENT KEYS, and that is the whole
       trick to a cock that does not read as a stop. The first cut had
       outboard, height and reach all turning around at 0.30, so every
       component of the hand's velocity crossed zero on the same frame
       and the probe measured a dead stop at 3% of mean speed. Here
       the hand reaches its widest at 0.24, its lowest at 0.39 and its
       furthest back at 0.32, so something is always moving and the
       draw reads as a loaded pause rather than a hitch. */
    [0.24, 0.265, -0.075, -0.380],
    [0.32, 0.235, -0.105, -0.462],
    [0.39, 0.170, -0.115, -0.330],
    [0.46, 0.060, -0.040, -0.020],
    [0.55, -0.060, 0.110, 0.480],
    [0.62, -0.090, 0.150, 0.680],
    [0.74, -0.075, 0.130, 0.580],
    [0.88, -0.030, 0.060, 0.250],
    [1.00, 0.000, 0.000, 0.000],
  ],
  /* The shield does not have to clear a lane for a blow that never
     crosses the body, so the thrust's guard hand keeps most of its
     wall - it only squares up and comes forward with the drive. */
  thrustTuck: [
    [0.00, 0.000, 0.000, 0.000],
    [0.30, 0.030, 0.010, 0.030],
    [0.52, 0.075, 0.025, 0.110],
    [0.78, 0.035, 0.010, 0.050],
    [1.00, 0.000, 0.000, 0.000],
  ],
  sweep: [
    [0.00, 0.000, 0.000, 0.000],
    [0.18, 0.330, 0.120, -0.330],
    [0.32, 0.520, 0.300, -0.480],
    [0.42, 0.400, 0.620, -0.200],
    [0.52, 0.030, 0.660, 0.190],
    [0.64, -0.560, 0.420, 0.470],
    [0.76, -0.690, 0.170, 0.400],
    [0.88, -0.290, 0.050, 0.175],
    [1.00, 0.000, 0.000, 0.000],
  ],
  /* THE SHIELD CLEARS THE LANE. A swing this wide finishes with the
     hammer hand almost where the shield hand lives, and a 1.5m plate
     is a wall the hammer would otherwise pass through. The off hand
     tucks outboard and back while the blow crosses - which is what a
     shield arm does anyway when the weapon comes over. Re-timed with
     the strike: the tuck now peaks at 0.58, where the hammer is. */
  shieldTuck: [
    [0.00, 0.000, 0.000, 0.000],
    [0.34, 0.070, 0.020, -0.070],
    [0.58, 0.205, 0.045, -0.205],
    [0.80, 0.090, 0.015, -0.090],
    [1.00, 0.000, 0.000, 0.000],
  ],
  rise: [
    [0.00, 0.000, 0.000, 0.000],
    [0.18, 0.320, -0.240, -0.240],
    [0.30, 0.480, -0.380, -0.360],
    [0.38, 0.410, -0.170, -0.090],
    [0.49, 0.010, 0.230, 0.190],
    [0.60, -0.490, 0.620, 0.420],
    [0.72, -0.630, 0.730, 0.340],
    [0.87, -0.230, 0.275, 0.150],
    [1.00, 0.000, 0.000, 0.000],
  ],
  crown: [
    [0.00, 0.000, 0.000, 0.000],
    [0.16, 0.180, 0.400, -0.250],
    [0.30, 0.240, 0.800, -0.330],
    [0.36, 0.200, 0.890, -0.190],
    [0.45, 0.095, 0.470, 0.140],
    [0.51, -0.010, 0.090, 0.360],
    [0.57, -0.095, -0.250, 0.545],
    [0.68, -0.115, -0.400, 0.510],
    [0.85, -0.055, -0.175, 0.255],
    [1.00, 0.000, 0.000, 0.000],
  ],
  turn: [
    [0.00, 0.000, 0.000, 0.000],
    [0.14, 0.420, 0.140, -0.080],
    [0.26, 0.600, 0.240, -0.120],
    [0.32, 0.540, 0.330, 0.010],
    [0.42, 0.060, 0.360, 0.230],
    [0.52, -0.470, 0.300, 0.415],
    [0.66, -0.590, 0.170, 0.395],
    [0.85, -0.235, 0.055, 0.170],
    [1.00, 0.000, 0.000, 0.000],
  ],
  lunge: [
    [0.00, 0.000, 0.000, 0.000],
    [0.18, 0.180, 0.140, -0.300],
    [0.32, 0.240, 0.200, -0.440],
    [0.38, 0.150, 0.215, -0.290],
    [0.44, 0.075, 0.225, -0.060],
    [0.50, -0.040, 0.235, 0.270],
    [0.57, -0.175, 0.240, 0.650],
    [0.68, -0.195, 0.185, 0.695],
    [0.85, -0.078, 0.080, 0.300],
    [1.00, 0.000, 0.000, 0.000],
  ],
  throwWind: [
    [0.00, 0.000, 0.000, 0.000],
    [0.30, 0.300, 0.520, -0.420],
    [0.44, -0.180, 0.280, 0.600],
    [0.62, -0.060, 0.080, 0.280],
    [1.00, 0.000, 0.000, 0.000],
  ],
  catch: [
    [0.00, 0.000, 0.000, 0.000],
    [0.25, -0.060, 0.190, 0.310],
    [0.60, 0.020, 0.050, 0.100],
    [1.00, 0.000, 0.000, 0.000],
  ],
};
/* THE WEAPON'S ARC IS NOT THE HAND'S ARC, and this is where most of
   a big swing actually lives. A hand can travel about a metre; the
   head of a reliquary hammer sits ~0.6m beyond the fist, so turning
   the WRIST through the swing carries that head through an arc more
   than twice as long, for free, without moving the shoulder past
   what it can reach. The props are welded into the palm (see the
   loadout's `hold`), so rotating the palm basis rotates the whole
   weapon and can never break the grip.

   `axis` is read in body space: "yaw" turns about world up (a
   horizontal carve), "pitch" about the body's own right vector (an
   overhead chop coming down through the front). The angle is signed
   by the swinging hand, so the two fists mirror each other. */
const WRIST_TRACKS = {
  vigilStrike: { axis: "yaw", keys: [[0.00, 0], [0.20, -0.85], [0.34, -0.20], [0.52, 1.05], [0.78, 0.30], [1.00, 0]] },
  vigilBackhand: { axis: "yaw", keys: [[0.00, 0], [0.20, -0.75], [0.34, -0.15], [0.52, 1.00], [0.78, 0.28], [1.00, 0]] },
  vigilCross: { axis: "pitch", keys: [[0.00, 0], [0.22, 0.72], [0.38, 0.40], [0.56, -1.05], [0.80, -0.30], [1.00, 0]] },
  vigilTurn: { axis: "yaw", keys: [[0.00, 0], [0.26, -0.80], [0.48, 0.10], [0.68, 1.10], [1.00, 0]] },
  vigilLunge: { axis: "yaw", keys: [[0.00, 0], [0.25, -0.45], [0.45, 0.55], [0.75, 0.18], [1.00, 0]] },
  /* Half a radian more each way than the scout, on a weapon whose
     head is twice as far from the fist - and phrased to the same four
     beats as the arm tracks, so the wrist's whip and the shoulder's
     carve peak TOGETHER, inside the damage window. They used to peak
     a third of a clip apart, which is a swing that accelerates twice
     and lands between the two. */
  /* A THRUST DOES NOT TURN THE WEAPON. 0.64 radians end to end,
     against 2.2 for the carve - just enough for the head to tip up
     as it draws and level out as it drives. */
  bastionThrust: { axis: "pitch", keys: [[0.00, 0], [0.14, 0.20], [0.24, 0.30], [0.32, 0.34], [0.39, 0.28], [0.46, 0.10], [0.55, -0.22], [0.62, -0.30], [0.74, -0.22], [0.88, -0.08], [1.00, 0]] },
  bastionSweep: { axis: "yaw", keys: [[0.00, 0], [0.18, -0.70], [0.32, -1.05], [0.42, -0.88], [0.52, -0.10], [0.64, 1.02], [0.76, 0.86], [0.88, 0.30], [1.00, 0]] },
  bastionRise: { axis: "yaw", keys: [[0.00, 0], [0.18, -0.64], [0.30, -0.98], [0.38, -0.82], [0.49, -0.08], [0.60, 0.98], [0.72, 0.82], [0.87, 0.26], [1.00, 0]] },
  bastionCrown: { axis: "pitch", keys: [[0.00, 0], [0.16, 0.48], [0.30, 0.86], [0.36, 0.76], [0.45, 0.24], [0.51, -0.36], [0.57, -0.94], [0.68, -0.82], [0.85, -0.26], [1.00, 0]] },
  bastionTurn: { axis: "yaw", keys: [[0.00, 0], [0.14, -0.68], [0.26, -1.08], [0.32, -0.90], [0.42, -0.06], [0.52, 1.06], [0.66, 0.88], [0.85, 0.26], [1.00, 0]] },
  bastionLunge: { axis: "yaw", keys: [[0.00, 0], [0.18, -0.33], [0.32, -0.50], [0.38, -0.42], [0.44, -0.26], [0.50, 0.06], [0.57, 0.54], [0.68, 0.44], [0.85, 0.14], [1.00, 0]] },
  /* The cast: the hammer is cocked back over the shoulder and whips
     forward, and the release lands on the way through. */
  bastionThrow: { axis: "pitch", keys: [[0.00, 0], [0.30, 0.85], [0.44, -0.95], [0.62, -0.25], [1.00, 0]] },
};

/* The wrist matters MORE than the hand for this, not less: the
   hammer head sits 0.83m past the fist, so a corner in the wrist
   track is amplified by that whole lever before it reaches the tip.
   Same interpolator. */
function sampleAngle(keys, u) {
  if (!keys || !keys.length) return 0;
  return hermite(keys, clamp01(u), 1);
}

/* The tower shield's guard, by blend rather than clock: hard to the
   MIDLINE, a modest lift, forward into a wall. The first shipped
   guard raised the hand 27cm and the wrist pitched with the arm -
   the shield tilted skyward (reported from play). The raise is now
   smaller, the centring larger, and the palm's ORIENTATION is held
   by the guard hand-basis below, so height never buys tilt. */
const GUARD_OFFSET = { out: -0.145, up: 0.160, fwd: 0.280 };

/* ============================================================
   THE INTERPOLATOR, AND WHY IT IS NOT A LERP

   Both of these tracks used to be sampled with straight linear
   interpolation between control points, and that is what "clunky"
   turned out to mean when it was measured. Linear interpolation
   holds a CONSTANT velocity inside each segment and changes
   direction INSTANTLY at every key, so the weapon tip's speed trace
   is a staircase - and every step is a jolt.

   Measured on the Bastion before this change
   (`scripts/saintfall-kenosis-swing-probe.mjs`): melee1's hammer tip
   ran at about 6 m/s and then spiked to 49 for a single sample where
   the wrist track reversed 1.65 radians at one key, on a lever 0.83m
   long. melee3 accelerated to 26 m/s, dropped to ZERO mid-swing, and
   restarted to 33. That is a stop-start, not a swing.

   This is a clamped cubic Hermite: it passes through every authored
   point (so the arcs tuned in m105 are preserved exactly), its
   velocity is CONTINUOUS across every key, and its end tangents are
   zero - which is precisely right for a blow that starts from rest
   and returns to rest. Tangents are computed against real key TIMES,
   not index spacing, because these tracks are deliberately
   non-uniform: the coil is long and the strike is short.
   ============================================================ */
function hermite(keys, t, col) {
  const n = keys.length;
  if (n === 1) return keys[0][col];
  let i = 0;
  while (i < n - 2 && t >= keys[i + 1][0]) i += 1;
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const h = Math.max(1e-5, k2[0] - k1[0]);
  const s = clamp01((t - k1[0]) / h);
  /* Finite-difference tangents over the neighbouring keys, in value
     per unit clip time. Zero at the ends: a swing leaves rest and
     arrives at rest, and a non-zero end tangent would make the hand
     enter and leave the clip already moving. */
  const m1 = i === 0 ? 0
    : (k2[col] - keys[i - 1][col]) / Math.max(1e-5, k2[0] - keys[i - 1][0]);
  const m2 = i + 2 > n - 1 ? 0
    : (keys[i + 2][col] - k1[col]) / Math.max(1e-5, keys[i + 2][0] - k1[0]);
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * k1[col]
    + (s3 - 2 * s2 + s) * h * m1
    + (-2 * s3 + 3 * s2) * k2[col]
    + (s3 - s2) * h * m2;
}

function sampleTrack(track, u, out) {
  out.out = 0; out.up = 0; out.fwd = 0;
  if (!track || !track.length) return out;
  const t = clamp01(u);
  out.out = hermite(track, t, 1);
  out.up = hermite(track, t, 2);
  out.fwd = hermite(track, t, 3);
  return out;
}

export function buildKenosisKit(ctx, player, loadout) {
  const { THREE } = ctx;
  const id = ctx.playerCharacter?.id || null;
  const KIT = KITS[id];
  if (!KIT || !loadout) return null;
  const isVigil = id === "white-vigil";
  const isBastion = id === "bastion-penitent";

  /* This is the line that arms melee on a weaponless level: both
     player.meleeSwing and combat.meleeStrike read it when there is
     no ctx.weapons. Published on the loadout object ctx.loadout
     points at. */
  loadout.meleeSpec = { ...KIT.melee };
  /* DAMAGE IS A LIVE READ, not a copied number. `combat.meleeStrike`
     takes `spec.damage` at the moment of the strike, so a getter is
     the whole integration: the doctrine's window effects (an arrival
     strike, a banked guard, a measured third blow) apply without
     combat.js or the strike path knowing a doctrine exists. */
  {
    const baseDamage = KIT.melee.damage;
    Object.defineProperty(loadout.meleeSpec, "damage", {
      enumerable: true,
      get: () => (ctx.doctrine?.kit?.("meleeDamage", baseDamage, {
        hammer: isBastion,
        comboStep: player.actionState?.combo || 0,
      }) ?? baseDamage),
    });
  }
  if (ctx.loadout && ctx.loadout !== loadout) ctx.loadout.meleeSpec = loadout.meleeSpec;

  /* ----------------------------------------------------------
     ARM OVERLAYS. The loadout's own hooks stay authoritative for
     the carry; the kit adds the swing on top. Wrapped ONCE, here,
     after summit-main has pointed ctx.loadout at the loadout's
     returned object - the same late-patch pattern the loadout
     itself uses for handBasis.
     ---------------------------------------------------------- */
  const overlay = { out: 0, up: 0, fwd: 0 };
  const guard = { blend: 0 };

  /* Which fists a named swing animates. The Vigil alternates blades
     through the procession; the Bastion's every blow is the hammer
     hand, with the shield hand holding its wall. */
  /* One entry per animated clip: where the hand goes, how the wrist
     turns while it gets there, and which crescent the hit draws. A
     NEGATIVE sweep id mirrors the effect, which is what a blow thrown
     by the other fist needs. */
  const VIGIL_MOVES = {
    melee1: { hand: 1, arm: VIGIL_TRACKS.strike, wrist: WRIST_TRACKS.vigilStrike, sweep: 1 },
    melee2: { hand: 0, arm: VIGIL_TRACKS.backhand, wrist: WRIST_TRACKS.vigilBackhand, sweep: -2 },
    melee3: { hand: 2, arm: VIGIL_TRACKS.crossCut, wrist: WRIST_TRACKS.vigilCross, sweep: 3 },
    meleeTurn: { hand: 1, arm: VIGIL_TRACKS.turn, wrist: WRIST_TRACKS.vigilTurn, sweep: 4 },
    meleeTurnCw: { hand: 1, arm: VIGIL_TRACKS.turn, wrist: WRIST_TRACKS.vigilTurn, sweep: 4 },
    meleeLunge: { hand: 1, arm: VIGIL_TRACKS.lunge, wrist: WRIST_TRACKS.vigilLunge, sweep: 5 },
  };
  /* Every Bastion blow is the hammer hand; the shield hand holds its
     wall throughout, which is the whole silhouette of the figure. */
  const TUCK = BASTION_TRACKS.shieldTuck;
  const BASTION_MOVES = {
    /* The opener is the THRUST, and sweep 5 is the lunge streak - a
       thrust that paints a wide crescent is a thrust nobody believes.
       `BASTION_TRACKS.sweep` is still the carve; nothing uses it as
       an opener any more, and melee2/melee3 keep the swings. */
    melee1: {
      hand: 1, arm: BASTION_TRACKS.thrust, wrist: WRIST_TRACKS.bastionThrust,
      off: BASTION_TRACKS.thrustTuck, sweep: 5,
    },
    melee2: { hand: 1, arm: BASTION_TRACKS.rise, wrist: WRIST_TRACKS.bastionRise, off: TUCK, sweep: 2 },
    melee3: { hand: 1, arm: BASTION_TRACKS.crown, wrist: WRIST_TRACKS.bastionCrown, off: TUCK, sweep: 3 },
    meleeTurn: { hand: 1, arm: BASTION_TRACKS.turn, wrist: WRIST_TRACKS.bastionTurn, off: TUCK, sweep: 4 },
    meleeTurnCw: { hand: 1, arm: BASTION_TRACKS.turn, wrist: WRIST_TRACKS.bastionTurn, off: TUCK, sweep: 4 },
    meleeLunge: { hand: 1, arm: BASTION_TRACKS.lunge, wrist: WRIST_TRACKS.bastionLunge, off: TUCK, sweep: 5 },
    hammerThrow: { hand: 1, arm: BASTION_TRACKS.throwWind, wrist: WRIST_TRACKS.bastionThrow, off: TUCK, sweep: 0 },
    hammerCatch: { hand: 1, arm: BASTION_TRACKS.catch, wrist: null, sweep: 0 },
  };
  const MOVES = isVigil ? VIGIL_MOVES : BASTION_MOVES;

  const moveFor = (name) => (name ? MOVES[name] || null : null);
  const moveUsesHand = (move, i) => !!move && (move.hand === 2 || move.hand === i);

  function overlayArm(i, out) {
    /* The RECORD, not the name - the overlay runs on the clip's own
       clock. (`player.action` answers only the name; reading `.t` off
       a string is the exact silent no-op the fail-silent memory
       warns about, and it was this module's first shipped bug.) */
    const action = player.actionState;
    const side = i === 0 ? 1 : -1;
    if (action?.name && action.spec) {
      const move = moveFor(action.name);
      const swinging = moveUsesHand(move, i);
      const track = swinging ? move?.arm : move?.off;
      if (track) {
        const u = action.t / Math.max(1e-4, action.spec.dur);
        sampleTrack(track, u, overlay);
        /* A mirrored spin leads with the other edge. */
        const mirror = action.name === "meleeTurnCw" ? -1 : 1;
        out.x += side * overlay.out * mirror;
        out.y += overlay.up;
        out.z += overlay.fwd;
      }
    }
    if (isBastion && i === 0 && guard.blend > 0.001) {
      out.x += side * GUARD_OFFSET.out * guard.blend;
      out.y += GUARD_OFFSET.up * guard.blend;
      out.z += GUARD_OFFSET.fwd * guard.blend;
    }
  }

  function overlaySwingScale(i) {
    const action = player.actionState;
    let scale = 1;
    const move = moveFor(action?.name);
    if (move?.arm && moveUsesHand(move, i)) scale = 0.12;
    if (isBastion && i === 0 && guard.blend > 0.001) {
      scale = Math.min(scale, 1 - guard.blend * 0.95);
    }
    return scale;
  }

  const baseArmPose = ctx.loadout.armPose;
  const baseArmSwing = ctx.loadout.armSwing;
  ctx.loadout.armPose = (i, out, gait) => {
    baseArmPose?.(i, out, gait);
    overlayArm(i, out);
  };
  ctx.loadout.armSwing = (i) => {
    const base = baseArmSwing ? baseArmSwing(i) : 1;
    const carried = Number.isFinite(base) ? base : 1;
    return carried * overlaySwingScale(i);
  };

  /* THE GUARD DOES NOT TILT. The shield is welded into the palm, so
     raising the hand lets the wrist's rest solve pitch the plate
     with the forearm - measured in play as the shield facing the
     sky. While the guard is up, the palm BASIS is held at the
     orientation the carry gave it: captured every un-guarded frame
     in yaw-local space (so it tracks the live carry, walk sway and
     all), then played back rotated to the current body yaw and
     blended in by the guard's own weight. The raise then buys
     height and centring, never attitude. player.js re-orthonormalises
     whatever this hands back. */
  const baseHandBasis = ctx.loadout.handBasis;
  const guardRestY = new THREE.Vector3(0, 1, 0);
  const guardRestZ = new THREE.Vector3(0, 0, 1);
  const guardHoldY = new THREE.Vector3();
  const guardHoldZ = new THREE.Vector3();
  let guardBasisCaptured = false;
  const rotY = (v, a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x = v.x * c + v.z * s;
    const z = -v.x * s + v.z * c;
    v.x = x;
    v.z = z;
    return v;
  };
  const swingAxisWorld = new THREE.Vector3();
  ctx.loadout.handBasis = (i, yWorld, zWorld) => {
    baseHandBasis?.(i, yWorld, zWorld);
    const yaw = player.state.yaw;

    /* THE SWING TURNS THE WRIST, and that is what carries the weapon
       head through a full arc (see WRIST_TRACKS). Applied to the
       basis player.js is about to build the hand from, so the whole
       welded prop rotates with it and the grip is never disturbed. */
    const action = player.actionState;
    const move = moveFor(action?.name);
    if (move?.wrist && action?.spec && moveUsesHand(move, i)) {
      const u = action.t / Math.max(1e-4, action.spec.dur);
      const hand = i === 1 ? 1 : -1;
      const spin = action.name === "meleeTurnCw" ? -1 : 1;
      const angle = sampleAngle(move.wrist.keys, u) * hand * spin;
      if (Math.abs(angle) > 1e-4) {
        if (move.wrist.axis === "pitch") {
          /* The body's own right vector: forward x up. Rotating about
             it swings the weapon in the vertical plane - the overhead
             chop coming down through the front of the body. */
          swingAxisWorld.set(-Math.cos(yaw), 0, Math.sin(yaw));
        } else {
          swingAxisWorld.set(0, 1, 0);
        }
        yWorld.applyAxisAngle(swingAxisWorld, angle).normalize();
        zWorld.applyAxisAngle(swingAxisWorld, angle).normalize();
      }
    }

    if (!isBastion || i !== 0) return;
    if (guard.blend < 0.01) {
      guardRestY.copy(yWorld);
      rotY(guardRestY, -yaw);
      guardRestZ.copy(zWorld);
      rotY(guardRestZ, -yaw);
      guardBasisCaptured = true;
      return;
    }
    if (!guardBasisCaptured) return;
    guardHoldY.copy(guardRestY);
    rotY(guardHoldY, yaw);
    guardHoldZ.copy(guardRestZ);
    rotY(guardHoldZ, yaw);
    yWorld.lerp(guardHoldY, guard.blend).normalize();
    zWorld.lerp(guardHoldZ, guard.blend).normalize();
  };

  /* Which crescent a blow draws, read by player.js at the hit frame.
     The hand that swings decides the direction, so the Vigil's
     left-fist backhand asks for a mirrored sweep. */
  ctx.loadout.meleeSweep = (name) => {
    const move = moveFor(name);
    return move && Number.isFinite(move.sweep) ? move.sweep : null;
  };

  /* ----------------------------------------------------------
     THE VIGIL STEP.
     ---------------------------------------------------------- */
  /* THE DOCTRINE SEAM. Two calls, and the kit knows no talent ids:
     `tune` asks for a number it was going to use anyway, `rite`
     reports that something happened. Both optional-chained, so the
     kit is complete with no doctrine at all. */
  const tune = (key, fallback, detail) =>
    ctx.doctrine?.kit?.(key, fallback, detail) ?? fallback;
  const rite = (name, detail) => ctx.doctrine?.verb?.(name, detail);

  const blink = {
    charges: KIT.blink?.charges ?? 0,
    maxCharges: KIT.blink?.charges ?? 0,
    rechargeIn: 0,
    casts: 0,
    lastReason: null,
    lastDistance: 0,
  };
  const blinkFrom = new THREE.Vector3();

  function tryBlink() {
    if (!isVigil) return false;
    const ps = player.state;
    const reason = ctx.combat?.player?.dead ? "dead"
      : ps.free ? "free-camera"
        : (ps.stunFor || 0) > 0 ? "stunned"
          : player.action ? "busy"
            : ctx.jetpack?.state?.inFlight ? "flight"
              : ctx.boost?.state?.active ? "boosting"
                : ctx.slam?.state?.active ? "slam"
                  : !ps.grounded ? "airborne"
                    : blink.charges < 1 ? "no-charge" : null;
    if (reason) {
      blink.lastReason = reason;
      ctx.audio?.blip?.(220, 0.05, 0.07, "square");
      return false;
    }
    /* THE STEP GOES WHERE YOU ARE LOOKING. Always - the stick has no
       say in it. The first version stepped along the movement input
       whenever one was held and only fell back to the lens with a
       centred stick, which meant the same key sent the trooper three
       different places depending on which way they happened to be
       walking. A blink is an aimed instrument: `aimViewYaw` is the
       real camera ray (player.js takes it off the camera after the
       chase smoothing), so this is the bearing under the reticle.
       Horizontal by design - `drag` puts the feet back on the
       ground, and a step is a step, not a jump. */
    const aimYaw = Number.isFinite(ps.aimViewYaw) ? ps.aimViewYaw : ps.camYaw;
    const dx = Math.sin(aimYaw);
    const dz = Math.cos(aimYaw);
    blinkFrom.set(ps.x, ps.y, ps.z);
    /* `player.drag` is the one displacement primitive that already
       respects the collision field: it slides, refuses walls and
       impossible grades, and reports how far the body actually went.
       A step the world mostly refuses is not paid for. */
    const moved = player.drag?.(dx * KIT.blink.range, dz * KIT.blink.range) ?? 0;
    if (moved < 1.0) {
      blink.lastReason = "blocked";
      ctx.audio?.blip?.(220, 0.05, 0.07, "square");
      return false;
    }
    const gy = ctx.collide?.groundHeight?.(ps.x, ps.z);
    if (Number.isFinite(gy)) ps.y = gy;
    blink.charges -= 1;
    if (blink.rechargeIn <= 0) {
      blink.rechargeIn = tune("blinkRecharge", KIT.blink.recharge);
    }
    blink.casts += 1;
    blink.lastReason = null;
    blink.lastDistance = moved;
    /* Land facing the way the step went, or the trooper arrives
       walking sideways out of its own rite. */
    ps.yaw = aimYaw;
    ps.speed = Math.max(ps.speed || 0, KIT.blink.exitSpeed);
    ctx.vfx?.blinkFx?.(blinkFrom.x, blinkFrom.y, blinkFrom.z, ps.x, ps.y, ps.z);
    ctx.audio?.blinkCast?.(blinkFrom.x, blinkFrom.z);
    ctx.audio?.blinkArrive?.(ps.x, ps.z);
    player.punch?.(0.4);
    /* Did the line of the step pass through anybody? The Unbroken
       Vigil is paid for arriving THROUGH the swarm, not beside it. */
    let through = false;
    for (const inst of ctx.enemies?.live || []) {
      if (!inst || inst.state === "death" || inst.health <= 0) continue;
      const t = ((inst.x - blinkFrom.x) * dx + (inst.z - blinkFrom.z) * dz);
      if (t < 0 || t > moved) continue;
      const lat = Math.hypot(inst.x - (blinkFrom.x + dx * t),
        inst.z - (blinkFrom.z + dz * t));
      if (lat <= 2.2) { through = true; break; }
    }
    rite("blink", {
      fromX: blinkFrom.x, fromZ: blinkFrom.z, distance: moved, throughEnemy: through,
    });
    return true;
  }

  /* ----------------------------------------------------------
     THE STOOP - the White Vigil's aimed airborne thrust.

     This module owns the body for the length of the line, which is
     the established pattern here (bosses displace the player through
     `player.drag`, the Undercroft writes position outright during its
     collapse). It integrates AFTER the controller's own solve and
     overwrites the result, so the two never compound - and it carries
     the figure's root by the same delta, because that root is placed
     during the solve and would otherwise render a frame behind the
     collision the thrust is being tested against.
     ---------------------------------------------------------- */
  const thrust = {
    active: false,
    timer: 0,
    cooldown: 0,
    casts: 0,
    hits: 0,
    lastReason: null,
    distance: 0,
    pitch: 0,
  };
  const thrustDir = new THREE.Vector3();
  const thrustPos = new THREE.Vector3();
  const thrustWant = new THREE.Vector3();
  const thrustHits = new Set();

  function tryAerialThrust() {
    if (!isVigil) return false;
    const ps = player.state;
    /* FLYING IS THE POINT, NOT A REFUSAL. The first cut listed
       `inFlight` as a blocker - and the Augur is a pack that FLIES,
       so the stoop was refused in exactly the situation it exists
       for, and the press then died on the flight guard below without
       so much as a swing. (The direct-call probe missed it: it got
       airborne by writing `vy`, which never sets `inFlight`. A verb
       that has an input must be tested THROUGH that input.)

       Launching cuts the pack for free: `beginAction` below makes
       `player.action` truthy, which is already in the jetpack's own
       `blockedByAction` list, and the lunge clip outlasts the line. */
    const reason = ctx.combat?.player?.dead ? "dead"
      : ps.free ? "free-camera"
        : (ps.stunFor || 0) > 0 ? "stunned"
          : thrust.active ? "thrusting"
            : thrust.cooldown > 0 ? "cooldown"
              /* HIGH PASS. The doctrine can start the dive from
                 standing: the rite answers with a launch height, and
                 the Vigil is thrown up into its own line rather than
                 being told it is on the ground. */
              : ps.grounded && !(tune("stoopGroundLaunch", 0) > 0)
                ? "grounded" : null;
    if (reason) {
      thrust.lastReason = reason;
      return false;
    }
    /* THE RETICLE IS THE LINE. `aimViewPitch` is taken off the real
       camera ray by player.js, so this is exactly where the player
       is looking - clamped only at the top, so the stoop cannot be
       flown upward as a second pack. */
    const yaw = Number.isFinite(ps.aimViewYaw) ? ps.aimViewYaw : ps.camYaw;
    const pitch = clamp(Number.isFinite(ps.aimViewPitch) ? ps.aimViewPitch : 0,
      KIT.thrust.pitchDown, KIT.thrust.pitchUp);
    const cosP = Math.cos(pitch);
    thrustDir.set(Math.sin(yaw) * cosP, Math.sin(pitch), Math.cos(yaw) * cosP).normalize();
    /* High Pass: thrown from standing, the rite lifts the body into
       its own line first, so the dive has air to happen in. */
    const launch = ps.grounded ? tune("stoopGroundLaunch", 0) : 0;
    if (launch > 0) {
      ps.grounded = false;
      ps.vy = Math.max(ps.vy, launch);
      ps.y += 0.35;
      ctx.doctrine?.verb?.("stoopLaunchFromGround", { launch });
    }
    thrustPos.set(ps.x, ps.y, ps.z);
    thrustHits.clear();
    thrust.active = true;
    thrust.timer = KIT.thrust.seconds;
    thrust.cooldown = KIT.thrust.cooldown;
    thrust.distance = 0;
    thrust.pitch = pitch;
    thrust.casts += 1;
    thrust.lastReason = null;
    ps.yaw = yaw;
    /* The lunge clip carries the pose, its own hit window and its
       crescent; the line below carries the body. */
    player.beginAction?.("meleeLunge", yaw);
    ctx.audio?.meleePierceLaunch?.(ps.x, ps.z);
    /* Everything the stoop draws is expressed along its own axis -
       the Fall's trail rig is a column authored straight up, and
       borrowing it put an overhead beam on a horizontal lance. */
    ctx.vfx?.stoopLaunch?.(ps.x, ps.y + 1.0, ps.z,
      thrustDir.x, thrustDir.y, thrustDir.z);
    player.punch?.(0.45);
    return true;
  }

  function endThrust(landed) {
    if (!thrust.active) return;
    thrust.active = false;
    const ps = player.state;
    /* Carry out of the line rather than stopping dead in the air. */
    ps.speed = Math.max(ps.speed || 0, KIT.thrust.exitSpeed);
    ps.vy = landed ? 0 : Math.min(0, thrustDir.y * KIT.thrust.speed * 0.35);
    if (landed) {
      const g = ctx.collide?.groundHeight?.(ps.x, ps.z);
      const gy = Number.isFinite(g) ? g : ps.y;
      ctx.vfx?.slamImpact?.(ps.x, gy, ps.z, 4.6, thrust.hits);
      ctx.audio?.slamImpact?.(ps.x, ps.z, 0.4);
      ctx.combat?.shockwave?.(ps.x, gy, ps.z, {
        radius: 4.6, innerRadius: 1.8, damage: 70, edgeFalloff: 0.45,
        stun: 0.9, knockSpeed: 10, source: "stoop",
      });
      player.punch?.(1.1);
      rite("stoopEnd", { metres: thrust.distance, landed: true });
    } else {
      rite("stoopEnd", { metres: thrust.distance, landed: false });
      /* Spent in open air: the lance lets go rather than ending on
         nothing. */
      ctx.vfx?.stoopSpend?.(ps.x, ps.y + 1.0, ps.z,
        thrustDir.x, thrustDir.y, thrustDir.z);
    }
  }

  function updateThrust(dt) {
    if (!isVigil) return;
    thrust.cooldown = Math.max(0, thrust.cooldown - dt);
    if (!thrust.active) return;
    const ps = player.state;
    if (ctx.combat?.player?.dead || (ps.stunFor || 0) > 0 || ps.free) {
      endThrust(false);
      return;
    }
    const step = KIT.thrust.speed * dt;
    thrustWant.copy(thrustPos).addScaledVector(thrustDir, step);

    /* Damage along the segment, one creature per line. */
    if (ctx.combat?.raycastEnemies) {
      let from = 0;
      for (let guard = 0; guard < 5 && from < step; guard += 1) {
        const hit = ctx.combat.raycastEnemies(
          thrustPos.x + thrustDir.x * from,
          thrustPos.y + thrustDir.y * from + 1.0,
          thrustPos.z + thrustDir.z * from,
          thrustDir.x, thrustDir.y, thrustDir.z,
          step - from + KIT.thrust.radius);
        if (!hit || !hit.inst) break;
        from += Math.max(0.4, hit.t + 0.4);
        if (thrustHits.has(hit.inst)) continue;
        thrustHits.add(hit.inst);
        /* Falling Star pays by the metre of line already flown. */
        const before = hit.inst.health;
        ctx.combat.damageEnemy(hit.inst,
          tune("stoopDamage", KIT.thrust.damage, { metres: thrust.distance }), {
            source: "stoop", x: hit.x, y: hit.y, z: hit.z,
            head: !!hit.head, weak: !!hit.weak,
          });
        if (before > 0 && hit.inst.health <= 0) {
          rite("stoopKill", { refund: (share) => {
            thrust.cooldown = Math.max(0, thrust.cooldown * (1 - share));
          } });
        }
        ctx.enemies?.knockback?.(hit.inst, thrustDir.x, thrustDir.z,
          KIT.thrust.knockback);
        thrust.hits += 1;
        ctx.vfx?.spark?.(hit.x, hit.y, hit.z, 1.3, false, true);
        ctx.audio?.impact?.(hit.x, hit.z, "flesh");
      }
    }
    if (ctx.trials?.sweep) {
      const swept = ctx.trials.sweep(thrustPos.x, thrustPos.y + 1.0, thrustPos.z,
        thrustDir.x, thrustDir.y, thrustDir.z, step + KIT.thrust.radius, {
          damage: KIT.thrust.damage, knockdown: true, stun: 1.6,
          exclude: thrustHits,
        });
      if (swept) {
        for (const s of swept) {
          thrustHits.add(s.target);
          thrust.hits += 1;
          ctx.vfx?.spark?.(s.x, s.y, s.z, 1.3, false, true);
        }
      }
    }

    /* Through the world with the flight capsule - the one sweep that
       is built for a body moving through open air. */
    const swept = ctx.collide?.sweepFlightCapsule?.(
      thrustPos.x, thrustPos.y, thrustPos.z,
      thrustWant.x, thrustWant.y, thrustWant.z,
      ctx.collide.radius, 2.35, 0.20, false);
    const nextX = swept ? swept.x : thrustWant.x;
    const nextY = swept ? swept.y : thrustWant.y;
    const nextZ = swept ? swept.z : thrustWant.z;
    const ground = ctx.collide?.groundHeight?.(nextX, nextZ);
    const landed = Number.isFinite(ground) && nextY <= ground + 0.02;
    const travelled = Math.hypot(nextX - thrustPos.x, nextY - thrustPos.y,
      nextZ - thrustPos.z);
    thrust.distance += travelled;

    /* CARRY THE LINE FORWARD. `thrustPos` is the thrust's own
       authoritative position - it must advance here, or every frame
       re-launches from the same origin and the body travels one
       step and stays there while the odometer happily counts the
       whole flight (measured: 21.5m of "line", 0.57m of trooper). */
    thrustPos.set(nextX, landed ? ground : nextY, nextZ);
    const dx = nextX - ps.x;
    const dy = (landed ? ground : nextY) - ps.y;
    const dz = nextZ - ps.z;
    ps.x = nextX;
    ps.y = landed ? ground : nextY;
    ps.z = nextZ;
    ps.vy = 0;
    ps.grounded = landed;
    /* The root was placed during the controller's solve, from the
       position this call has just replaced. Carry it by the same
       delta so the drawn figure and the collided body agree on the
       frame the thrust is actually tested on. */
    if (player.figure?.root) player.figure.root.position.set(
      player.figure.root.position.x + dx,
      player.figure.root.position.y + dy,
      player.figure.root.position.z + dz);

    ctx.vfx?.stoopWake?.(ps.x, ps.y + 1.0, ps.z,
      thrustDir.x, thrustDir.y, thrustDir.z);
    thrust.timer -= dt;
    if (landed || thrust.timer <= 0 || (swept && swept.blocked && travelled < step * 0.2)) {
      endThrust(landed);
    }
  }

  /* ----------------------------------------------------------
     THE TOWER SHIELD - a ctx.shield-compatible module. The player
     controller gets its shield walk (slow, camera-faced) and
     combat.hurtPlayer gets its tryBlock for free; what changes
     from the Aegis is the economics (no drain, no cooldown, no
     charge floor) and the geometry (a wider frontal wall, never a
     dome).
     ---------------------------------------------------------- */
  const blockConfig = isBastion ? {
    drainRate: 0,
    moveSpeed: KIT.block.moveSpeed,
    frontDot: KIT.block.frontDot,
    distance: KIT.block.distance,
    centreY: KIT.block.centreY,
    perfectWindow: KIT.block.perfectWindow,
  } : null;
  const blockState = {
    active: false,
    requested: false,
    activeFor: 0,
    raises: 0,
    blocks: 0,
    absorbed: 0,
    perfectBlocks: 0,
    blockedReason: null,
    lastBlock: null,
    lastAttempt: null,
  };

  function blockBeginFrame(dt, ps, inputState) {
    blockState.requested = !!inputState.block;
    const reason = ctx.combat?.player?.dead ? "dead"
      : ps.free ? "free-camera"
        : !ps.grounded ? "airborne"
          : player.action ? "busy"
            : ctx.boost?.state?.active ? "boosting"
              : ctx.slam?.state?.active ? "slam"
                : (ps.stunFor || 0) > 0 ? "stunned" : null;
    const wasActive = blockState.active;
    blockState.active = blockState.requested && !reason;
    blockState.blockedReason = blockState.requested ? reason : null;
    if (blockState.active) {
      if (!wasActive) {
        blockState.raises += 1;
        blockState.activeFor = 0;
        ctx.audio?.blip?.(180, 0.06, 0.08, "triangle");
      }
      blockState.activeFor += dt;
    } else {
      blockState.activeFor = 0;
      /* Dropping the guard spends the Anvil Stance stacks. */
      if (wasActive) rite("guardDrop");
    }
    guard.blend += ((blockState.active ? 1 : 0) - guard.blend)
      * (1 - Math.exp(-(blockState.active ? 14 : 9) * Math.max(0, dt)));
    return {
      active: blockState.active,
      /* Immovable lets the wall walk. */
      moveSpeed: tune("guardMoveSpeed", blockConfig.moveSpeed),
    };
  }

  function blockVerdict(sourceX, sourceZ, guardType = GUARD_TYPES.FRONTAL) {
    if (!blockState.active) return { ok: false, reason: "inactive" };
    if (guardType === GUARD_TYPES.UNBLOCKABLE) return { ok: false, reason: "unblockable" };
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceZ)) {
      return { ok: false, reason: "no-origin" };
    }
    const ps = player.state;
    const dx = sourceX - ps.x;
    const dz = sourceZ - ps.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-5) return { ok: false, reason: "no-direction" };
    if (guardType === GUARD_TYPES.PERFECT_ONLY
      && blockState.activeFor > blockConfig.perfectWindow) {
      return { ok: false, reason: "perfect-timing" };
    }
    const dot = (dx * Math.sin(ps.yaw) + dz * Math.cos(ps.yaw)) / distance;
    return dot >= blockConfig.frontDot
      ? { ok: true, reason: "frontal", dot }
      : { ok: false, reason: "angle", dot };
  }

  function blockTryBlock(amount, detail = {}) {
    if (!(amount > 0)) return false;
    const normalized = normalizeGuardDetail(detail, player.state);
    const verdict = blockVerdict(normalized.originX, normalized.originZ,
      normalized.guardType);
    blockState.lastAttempt = {
      ok: verdict.ok,
      reason: verdict.reason,
      guardType: normalized.guardType,
      activeFor: blockState.activeFor,
    };
    if (!verdict.ok) return false;
    const perfect = blockState.activeFor <= blockConfig.perfectWindow;
    blockState.blocks += 1;
    blockState.absorbed += amount;
    rite("guardBlock", { amount, perfect });
    if (perfect) blockState.perfectBlocks += 1;
    blockState.lastBlock = {
      perfect,
      amount,
      timing: {
        elapsedSeconds: blockState.activeFor,
        windowSeconds: blockConfig.perfectWindow,
      },
    };
    const ps = player.state;
    const nx = Math.sin(ps.yaw);
    const nz = Math.cos(ps.yaw);
    const fx = ps.x + nx * blockConfig.distance;
    const fz = ps.z + nz * blockConfig.distance;
    if (ctx.vfx?.shieldBlock) {
      ctx.vfx.shieldBlock(fx, ps.y + blockConfig.centreY, fz, nx, nz,
        perfect, amount, false);
    } else {
      ctx.vfx?.spark?.(fx, ps.y + blockConfig.centreY, fz, 1.3, false, true);
    }
    ctx.audio?.blockImpact?.(ps.x, ps.z, perfect);
    player.doctrineKick?.(perfect ? 0.42 : 0.26, 0.85);
    return true;
  }

  const blockModule = isBastion ? {
    config: blockConfig,
    state: blockState,
    beginFrame: blockBeginFrame,
    blockVerdict,
    blocksFrom: (x, z, guardType) => blockVerdict(x, z, guardType).ok,
    tryBlock: blockTryBlock,
    lastBlock: () => blockState.lastBlock,
    lastAttempt: () => blockState.lastAttempt,
    updateVisual: () => {},
    reset: () => {
      blockState.active = false;
      blockState.requested = false;
      blockState.activeFor = 0;
      guard.blend = 0;
    },
    status: () => ({
      active: blockState.active,
      requested: blockState.requested,
      activeFor: Number(blockState.activeFor.toFixed(3)),
      raises: blockState.raises,
      blocks: blockState.blocks,
      absorbed: Math.round(blockState.absorbed),
      perfectBlocks: blockState.perfectBlocks,
      blockedReason: blockState.blockedReason,
      frontDot: blockConfig.frontDot,
      guardBlend: Number(guard.blend.toFixed(3)),
    }),
  } : null;

  /* ----------------------------------------------------------
     THE HAMMER CAST.
     ---------------------------------------------------------- */
  const hammer = {
    phase: "held",           // held | windup | out | return
    cooldown: 0,
    distance: 0,
    casts: 0,
    hits: 0,
    grounded: 0,             // flyers knocked down, lifetime
    catches: 0,
    lastReason: null,
    pendingLaunch: false,
    wakeAt: 0,
    spinPhase: 0,
  };
  const hammerPart = isBastion
    ? (loadout.parts || []).find((part) => part.spec.id === "bastion-hammer") || null
    : null;
  const hammerPos = new THREE.Vector3();
  const hammerVel = new THREE.Vector3();
  const hammerStep = new THREE.Vector3();
  const hammerAim = new THREE.Vector3();
  const handWorld = new THREE.Vector3();
  const spinAxis = new THREE.Vector3();
  const alignQ = new THREE.Quaternion();
  const spinQ = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0);
  let hammerVisual = null;
  const hammerHits = new Set();

  function buildHammerVisual() {
    if (hammerVisual || !hammerPart) return;
    const wrap = new THREE.Group();
    wrap.name = "kenosis-hammer-cast";
    const clone = hammerPart.asset.clone(true);
    clone.position.set(0, 0, 0);
    clone.quaternion.identity();
    /* THE MOUNTED SCALE IS A LOCAL NUMBER, NOT A SIZE. The prop hangs
       under a palm locator inside a centimetre armature (~0.01 world
       scale), so its local scale carries a ~100x compensation. Cloned
       into a bare scene group with that local scale, the hammer flew
       as a ten-metre monument (shipped bug, reported from play as
       "giant while flying"). The WORLD scale of the mounted asset is
       the truth - copy that. */
    hammerPart.asset.getWorldScale(clone.scale);
    wrap.add(clone);
    wrap.visible = false;
    ctx.scene.add(wrap);
    wrap.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrap);
    const centre = box.getCenter(new THREE.Vector3());
    clone.position.sub(centre);
    hammerVisual = wrap;
  }

  function handPosition(out) {
    const pivot = player.figure?.palmLocators?.[1] || player.figure?.handPivots?.[1];
    if (!pivot) return out.set(player.state.x, player.state.y + 1.2, player.state.z);
    return pivot.getWorldPosition(out);
  }

  function tryThrowHammer() {
    if (!isBastion || !hammerPart) return false;
    const ps = player.state;
    const reason = ctx.combat?.player?.dead ? "dead"
      : ps.free ? "free-camera"
        : (ps.stunFor || 0) > 0 ? "stunned"
          : hammer.phase !== "held" ? "hammer-away"
            : hammer.cooldown > 0 ? "cooldown"
              : blockState.active ? "guarding"
                : player.action ? "busy"
                  : ctx.slam?.state?.active ? "slam"
                    : ctx.boost?.state?.active ? "boosting" : null;
    if (reason) {
      hammer.lastReason = reason;
      ctx.audio?.blip?.(200, 0.05, 0.07, "square");
      return false;
    }
    player.beginAction?.("hammerThrow");
    hammer.phase = "windup";
    hammer.pendingLaunch = true;
    hammer.lastReason = null;
    return true;
  }

  function launchHammer() {
    buildHammerVisual();
    handPosition(handWorld);
    /* Aimed exactly like the crescents: at the camera's convergence
       point, so the reticle is the promise. Falls back to the body's
       own facing if the loadout cannot supply a camera. */
    const aimed = loadout.aimPoint?.(hammerAim) || null;
    if (aimed) {
      hammerVel.copy(hammerAim).sub(handWorld);
    } else {
      const ps = player.state;
      hammerVel.set(Math.sin(ps.yaw), 0, Math.cos(ps.yaw));
    }
    if (hammerVel.lengthSq() < 1e-8) hammerVel.set(0, 0, 1);
    hammerVel.normalize().multiplyScalar(KIT.hammer.speed);
    hammerPos.copy(handWorld);
    hammerHits.clear();
    hammer.phase = "out";
    hammer.distance = 0;
    hammer.casts += 1;
    hammer.cooldown = tune("castCooldown", KIT.hammer.cooldown);
    rite("castThrow", {});
    hammer.spinPhase = 0;
    if (hammerPart.asset) hammerPart.asset.visible = false;
    if (hammerVisual) hammerVisual.visible = true;
    ctx.audio?.hammerThrow?.(handWorld.x, handWorld.z);
    player.punch?.(0.5);
  }

  function hammerImpact(x, y, z, heavy) {
    ctx.vfx?.hammerImpactFx?.(x, y, z, heavy);
    ctx.audio?.hammerImpact?.(x, z, heavy);
    if (heavy) player.doctrineKick?.(0.4, 0.9);
  }

  /* One flight substep of at most `maxStep` metres: walls, enemies
     and trials targets, in that order. Returns false when the flight
     ended (wall) - enemies are pierced, not stopped. */
  function sweepHammer(stepLen, returning) {
    const dirX = hammerVel.x; const dirY = hammerVel.y; const dirZ = hammerVel.z;
    const mag = Math.hypot(dirX, dirY, dirZ) || 1;
    const ux = dirX / mag; const uy = dirY / mag; const uz = dirZ / mag;
    if (!returning) {
      /* rayBlock answers in METRES - the distance to the first wall,
         or Infinity for a clear line. */
      const wallAt = ctx.collide?.rayBlock?.(hammerPos.x, hammerPos.y, hammerPos.z,
        ux, uy, uz, stepLen) ?? Infinity;
      if (Number.isFinite(wallAt) && wallAt <= stepLen) {
        const d = Math.max(0.1, wallAt - 0.2);
        hammerImpact(hammerPos.x + ux * d, hammerPos.y + uy * d,
          hammerPos.z + uz * d, false);
        beginHammerReturn();
        return false;
      }
    }
    if (ctx.combat?.raycastEnemies) {
      /* March the ray past every body it finds inside the step - the
         cast goes THROUGH the line, that is the point of it. */
      let from = 0;
      for (let guardCount = 0; guardCount < 6 && from < stepLen; guardCount += 1) {
        const hit = ctx.combat.raycastEnemies(
          hammerPos.x + ux * from, hammerPos.y + uy * from, hammerPos.z + uz * from,
          ux, uy, uz, stepLen - from);
        if (!hit || !hit.inst) break;
        from += Math.max(0.35, hit.t + 0.35);
        if (hammerHits.has(hit.inst)) continue;
        hammerHits.add(hit.inst);
        /* True Return makes the homeward leg a real pass rather than
           a formality; without the rite it is the authored share. */
        const dmg = returning
          ? tune("castReturnDamage", KIT.hammer.returnDamage,
            { outbound: KIT.hammer.damage })
          : KIT.hammer.damage;
        ctx.combat.damageEnemy(hit.inst, dmg, {
          source: "hammer-cast", x: hit.x, y: hit.y, z: hit.z,
          head: !!hit.head, weak: !!hit.weak,
        });
        const downed = ctx.combat.groundFlyer?.(hit.inst,
          { stun: tune("castKnockdownStun", KIT.hammer.knockdownStun) });
        if (downed) hammer.grounded += 1;
        ctx.enemies?.knockback?.(hit.inst, ux, uz, KIT.hammer.knockback);
        hammer.hits += 1;
        hammerImpact(hit.x, hit.y, hit.z, true);
        rite("castHit", {
          inst: hit.inst, grounded: downed, x: hit.x, y: hit.y, z: hit.z,
        });
      }
    }
    if (ctx.trials?.sweep) {
      const swept = ctx.trials.sweep(hammerPos.x, hammerPos.y, hammerPos.z,
        ux, uy, uz, stepLen, {
          damage: returning ? KIT.hammer.returnDamage : KIT.hammer.damage,
          stun: KIT.hammer.knockdownStun,
          knockdown: true,
          exclude: hammerHits,
        });
      if (swept) {
        for (const swipe of swept) {
          hammerHits.add(swipe.target);
          hammer.hits += 1;
          hammerImpact(swipe.x, swipe.y, swipe.z, true);
          hammer.grounded += swipe.grounded ? 1 : 0;
        }
      }
    }
    return true;
  }

  function beginHammerReturn() {
    hammer.phase = "return";
    hammerHits.clear();
  }

  function catchHammer() {
    hammer.phase = "held";
    hammer.catches += 1;
    if (hammerVisual) hammerVisual.visible = false;
    if (hammerPart?.asset) hammerPart.asset.visible = true;
    const ps = player.state;
    ctx.audio?.hammerCatch?.(ps.x, ps.z);
    ctx.vfx?.spark?.(handWorld.x, handWorld.y, handWorld.z, 0.9, false, true);
    if (!player.action) player.beginAction?.("hammerCatch");
    player.punch?.(0.3);
  }

  function updateHammer(dt) {
    if (!isBastion) return;
    hammer.cooldown = Math.max(0, hammer.cooldown - dt);
    const action = player.actionState;
    if (hammer.pendingLaunch) {
      if (!action?.name || action.name !== "hammerThrow") {
        /* The wind-up was cut (stun, death): the cast never happened
           and the rite is not spent. */
        hammer.pendingLaunch = false;
        if (hammer.phase === "windup") hammer.phase = "held";
      } else {
        const releaseAt = action.spec?.throwAt ?? 0.40;
        if (action.t >= releaseAt) {
          hammer.pendingLaunch = false;
          launchHammer();
        }
      }
    }
    if (hammer.phase === "out") {
      const step = Math.max(1e-4, KIT.hammer.speed * dt);
      let remaining = step;
      let flying = true;
      while (flying && remaining > 1e-4) {
        const sub = Math.min(0.6, remaining);
        flying = sweepHammer(sub, false);
        if (!flying) break;
        hammerStep.copy(hammerVel).normalize().multiplyScalar(sub);
        hammerPos.add(hammerStep);
        hammer.distance += sub;
        remaining -= sub;
        const ground = ctx.collide?.groundHeight?.(hammerPos.x, hammerPos.z);
        if (Number.isFinite(ground) && hammerPos.y <= ground + 0.25) {
          hammerPos.y = ground + 0.3;
          hammerImpact(hammerPos.x, ground + 0.15, hammerPos.z, false);
          beginHammerReturn();
          flying = false;
        } else if (hammer.distance >= KIT.hammer.range) {
          beginHammerReturn();
          flying = false;
        }
      }
    } else if (hammer.phase === "return") {
      handPosition(handWorld);
      hammerVel.copy(handWorld).sub(hammerPos);
      const dist = hammerVel.length();
      const step = KIT.hammer.returnSpeed * dt;
      if (dist <= Math.max(1.4, step)) {
        hammerPos.copy(handWorld);
        catchHammer();
      } else {
        hammerVel.normalize().multiplyScalar(KIT.hammer.returnSpeed);
        sweepHammer(Math.min(0.6, step), true);
        hammerStep.copy(hammerVel).normalize().multiplyScalar(step);
        hammerPos.add(hammerStep);
      }
    }
    if ((hammer.phase === "out" || hammer.phase === "return") && hammerVisual) {
      hammer.spinPhase += dt * 17;
      hammerVisual.position.copy(hammerPos);
      /* End over end: aligned to the flight, spun about the lateral
         axis so the head leads twice a revolution. */
      const speed = hammerVel.length() || 1;
      alignQ.setFromUnitVectors(AX,
        hammerStep.copy(hammerVel).multiplyScalar(1 / speed));
      spinAxis.set(-hammerVel.z, 0, hammerVel.x).normalize();
      if (spinAxis.lengthSq() < 0.5) spinAxis.set(0, 0, 1);
      spinQ.setFromAxisAngle(spinAxis, hammer.spinPhase);
      hammerVisual.quaternion.copy(spinQ).multiply(alignQ);
      hammerVisual.updateMatrixWorld(true);
      hammer.wakeAt -= dt;
      if (hammer.wakeAt <= 0) {
        hammer.wakeAt = 0.05;
        ctx.vfx?.hammerWake?.(hammerPos.x, hammerPos.y, hammerPos.z,
          hammerVel.x / speed, hammerVel.y / speed, hammerVel.z / speed);
      }
    }
  }

  /* ----------------------------------------------------------
     INPUT. The kit is this level's one consumer of the player's
     buffered input events (the campaign's main.js is not here),
     plus edge-detection on the two held states that double as
     ability triggers: RMB for the Bastion's cast, E for the
     Vigil's step, LMB for the Bastion's swing.
     ---------------------------------------------------------- */
  let prevAds = false;
  let prevBlock = false;
  let prevFiring = false;

  function airborne() {
    return !player.state.grounded;
  }

  function routeMeleePress(aimYaw) {
    if (ctx.slam?.state?.active) return;
    if (isBastion && blockState.active) return;
    if (isBastion && hammer.phase !== "held") {
      hammer.lastReason = "hammer-away";
      ctx.audio?.blip?.(200, 0.05, 0.06, "square");
      return;
    }
    player.meleeSwing?.(aimYaw);
  }

  /* One press, two rites, decided by altitude - exactly the
     campaign's routing: a press in the air is the Fall, and a Fall
     that refuses falls back to the swing rather than eating the
     press. Shared by the melee keybind and the Vigil's right button. */
  function pressMelee(aimYaw) {
    if (airborne()) {
      /* Two operatives, two answers to being in the air. The scout
         throws an AIMED line (the stoop); the bulwark drops the
         Penitent's Fall, which only ever goes down. Both fall back
         to the ordinary swing if their rite refuses, rather than
         eating the press - which is what the flight guard used to
         do to the Vigil on every press made while flying. */
      if (isVigil) {
        if (tryAerialThrust()) return;
        if (thrust.active) return;
      } else {
        if (ctx.slam?.trigger?.()) return;
        if (ctx.jetpack?.state?.inFlight || ctx.slam?.state?.active) return;
      }
    }
    routeMeleePress(aimYaw);
  }

  function update(dt) {
    const dead = !!ctx.combat?.player?.dead;
    const stunned = (player.state.stunFor || 0) > 0;
    const events = player.input?.drain?.() || [];
    for (const ev of events) {
      if (dead || stunned || player.state.free) continue;
      if (ev.type === "boost") {
        if (!ctx.jetpack?.state?.inFlight) ctx.boost?.trigger?.();
        continue;
      }
      if (ev.type === "melee") pressMelee(ev.aimYaw);
    }
    const input = player.input?.state || {};
    if (!dead && !stunned && !player.state.free) {
      /* RIGHT BUTTON IS THE MELEE HAND on both operatives - the
         Bastion casts its reliquary with it, the Vigil turns its
         pistols on whatever is already inside their reach. (The
         Vigil's guns therefore no longer "focus" on the right
         button: aiming down a wrist blade was never the fantasy,
         and the button is worth more as a second attack.) */
      if (isBastion && input.ads && !prevAds) tryThrowHammer();
      if (isVigil && input.ads && !prevAds) pressMelee(player.state.aimViewYaw);
      if (isVigil && input.block && !prevBlock) tryBlink();
      if (isBastion && input.firing && !prevFiring) {
        pressMelee(player.state.aimViewYaw);
      }
    }
    prevAds = !!input.ads;
    prevBlock = !!input.block;
    prevFiring = !!input.firing;

    if (isVigil) {
      /* The doctrine may widen the step's magazine (Three Places at
         Once). Read every frame rather than cached, so buying the
         rite mid-session takes effect without a reload. */
      blink.maxCharges = Math.max(1, Math.round(
        tune("blinkCharges", KIT.blink?.charges ?? 2)));
      /* The magazine can SHRINK - refunding Three Places mid-session
         takes a charge away that may already be held, and a held
         count above the maximum is a negative remainder everywhere
         downstream (it crashed the HUD's pip row). */
      if (blink.charges > blink.maxCharges) blink.charges = blink.maxCharges;
      if (blink.charges < blink.maxCharges) {
        blink.rechargeIn -= dt;
        if (blink.rechargeIn <= 0) {
          blink.charges += 1;
          blink.rechargeIn = blink.charges < blink.maxCharges
            ? tune("blinkRecharge", KIT.blink.recharge) : 0;
          ctx.audio?.blip?.(660, 0.05, 0.05, "triangle");
        }
      }
    }
    updateHammer(dt);
    updateThrust(dt);
  }

  function reset() {
    blink.charges = blink.maxCharges;
    blink.rechargeIn = 0;
    thrust.active = false;
    thrust.timer = 0;
    thrust.cooldown = 0;
    if (isBastion) {
      hammer.cooldown = 0;
      hammer.pendingLaunch = false;
      if (hammer.phase !== "held") {
        hammer.phase = "held";
        if (hammerVisual) hammerVisual.visible = false;
        if (hammerPart?.asset) hammerPart.asset.visible = true;
      }
      blockModule?.reset();
    }
  }

  function status() {
    return {
      id,
      doctrine: KIT.doctrine,
      meleeSpec: { ...loadout.meleeSpec },
      blink: isVigil ? {
        charges: blink.charges,
        maxCharges: blink.maxCharges,
        rechargeIn: Number(blink.rechargeIn.toFixed(2)),
        rechargeSeconds: KIT.blink.recharge,
        rangeM: KIT.blink.range,
        casts: blink.casts,
        lastReason: blink.lastReason,
        lastDistance: Number(blink.lastDistance.toFixed(2)),
      } : null,
      hammer: isBastion ? {
        phase: hammer.phase,
        cooldown: Number(hammer.cooldown.toFixed(2)),
        cooldownSeconds: KIT.hammer.cooldown,
        casts: hammer.casts,
        hits: hammer.hits,
        grounded: hammer.grounded,
        catches: hammer.catches,
        distance: Number(hammer.distance.toFixed(2)),
        lastReason: hammer.lastReason,
        position: hammer.phase === "out" || hammer.phase === "return"
          ? hammerPos.toArray().map((value) => Number(value.toFixed(2))) : null,
      } : null,
      thrust: isVigil ? {
        active: thrust.active,
        cooldown: Number(thrust.cooldown.toFixed(2)),
        cooldownSeconds: KIT.thrust.cooldown,
        casts: thrust.casts,
        hits: thrust.hits,
        distance: Number(thrust.distance.toFixed(2)),
        pitchDeg: Number((thrust.pitch * 180 / Math.PI).toFixed(1)),
        speed: KIT.thrust.speed,
        seconds: KIT.thrust.seconds,
        lastReason: thrust.lastReason,
      } : null,
      block: blockModule ? blockModule.status() : null,
      discharge: isVigil ? { ...KIT.discharge } : null,
    };
  }

  return {
    id,
    doctrine: KIT.doctrine,
    dischargeSpec: isVigil ? { ...KIT.discharge } : null,
    blockModule,
    update,
    reset,
    status,
    /* Direct verbs for the harness - the same paths the inputs take. */
    tryBlink,
    tryThrowHammer,
    tryAerialThrust,
  };
}
