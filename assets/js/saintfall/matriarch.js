/* ============================================================
   SAINTFALL - the Matriarch

   The Gilded Reach's guardian, and everything about the fight that is
   not geometry: how it holds ground, what it does with the scythes,
   what it does when you get behind it, and what laying costs it.

   WHY THIS IS ITS OWN MODULE

   It was the last district boss still being driven entirely by
   `combat.stepEnemy`, which is the generic walker brain: close to
   reach and bite on a cadence. Against a 3600-health pool that
   produced a fight with exactly one decision in
   it, taken once: walk round the back, then hold the trigger. The
   animal never answered the flank, never covered the ground it lost,
   and never did anything a Harrow does not do, so the only thing its
   size changed was how long the same thirty seconds lasted.

   The parts of the encounter that were already right are kept and
   built on rather than replaced. The gaster is still the weak point,
   and it is still on the far side of nine metres of hostile animal.
   What this module adds is an OPPONENT for those rules.

   THE LOOP

     STALK      It holds a band rather than a point: outside it,
                closes; inside it, gives ground. Facing you the whole
                time, because facing you is what keeps the gaster
                away from you. It closes FASTER THE FURTHER IT HAS TO
                COME, up to a run - see `chaseSpeed`.
     COMBO      In reach, the fold opens: two scythes on separate
                beats, each its own tell, each dodgeable on its own.
                Three in the second phase. Aimed where you are GOING,
                which is what makes a held circle stop being immunity
                without making a sidestep stop working - `leadLag`.
     LANCE      The answer to being plinked from range. It cocks -
                arms drawn tight, body reared, a full second of it -
                and then crosses as much of the gap as it needs to
                and arrives swinging.
     CULL       THE FLANK, ANSWERED. Loiter in its rear arc inside ten
                metres and it whips round, dragging the gaster through
                the ground behind it. This is the move the whole
                encounter is built around: it does not stop you
                getting behind, it puts a clock on staying there.
     TREMOR     The summon is gone. It plants the ovipositor and sends
                three expanding ground waves across the Reach, four
                after rousing. Jump, boost or fly over each live ring;
                staying grounded is punished. Planting still holds the
                gaster low, turning the danger into an aimed damage
                window rather than another add-clear.

   And below 45% it rouses: faster, a third scythe on the combo, and
   a fourth tremor on a tighter clock.

   THE SPEED PASS. Everything above was true of the fight before this
   module was ever measured against a player who simply left. It was
   not: `saintfall-matriarch-pressure.mjs` drives four refusals - back
   away down the sights, back away hipfiring, hold a plinking range,
   hold a circle - and the animal answered NONE of them. A player who
   never once lowered their sights opened thirty-four metres on it in
   twenty-six seconds; twenty-four metres out it drew no move at all
   for the whole run; and inside its own reach for a third of an
   orbit it swung five times and hit nothing. The fixes are in
   `walkSpeed`/`chaseSpeed`, in `lanceRange`, and in `leadLag`, and
   each of those comments carries the number it was written against.

   NOTHING HERE IS SAVED, deliberately. Every field this module owns is
   a sub-second action timer or a cadence, and `districtBosses` already
   persists the three things that survive a reload - phase, position and
   health. Adding a `matriarch` snapshot would mean a seventh top-level
   save field and a seventh validator, to restore a wind-up that was
   0.3 seconds from resolving. A load drops the action and re-enters
   the stalk, which is also the only honest thing to show a player who
   was not there for the tell.
   ============================================================ */

import { SURVIVAL_CONFIG } from "saintfall/combat.js";
import { TAU, dampAngle, makeBus } from "saintfall/core.js";

export const MATRIARCH_CONFIG = Object.freeze({
  /* ------------------------------------------------------------
     GROUND. It holds a band, not a point. Outside `holdBand` it
     advances, inside it backs off, and in the band it circles - so
     the fight has a shape even in the seconds nobody is attacking.
     The band's inner edge is deliberately just inside scythe reach:
     a boss that stands exactly at the range of its own attack looks
     like it is waiting for a cooldown, which it is. */
  holdBand: Object.freeze([5.6, 9.4]),

  /* HOW FAST, and this is the number the fight was lost on.

     It was 2.55 m/s. A trooper moves at 8.6 hipfiring and 3.96 down
     the sights, so a player who NEVER STOPPED AIMING still opened
     ground on it at better than a metre a second - measured, in
     `saintfall-matriarch-pressure.mjs`: twelve metres to forty-six in
     twenty-six seconds, nought hits taken. The animal was not hard to
     dodge, it was impossible to be near. Every other number in this
     file - the arc, the tells, the cull's loiter clock - describes a
     fight that only exists inside nine metres, and nothing here could
     make a player stand there.

     The stalk now beats a WALK and the sighted pace outright and sits
     under a SPRINT, so the range is a live argument: keep the sights
     up and it closes on you, break into a run and you keep your
     distance and stop shooting for as long as you do. */
  walkSpeed: 6.65,
  backSpeed: 3.1,
  strafeSpeed: 4.0,
  strafeFlipSeconds: 2.4,

  /* THE CHASE GEAR. Beyond the band it winds up toward a run, so
     distance is a cost that grows rather than a switch that turns the
     encounter off - which is what twenty-four metres used to be: the
     probe held that mark for twenty-six seconds and drew NOTHING, no
     tell, no lance, no step taken.

     Capped below SPRINT deliberately, and `gaitCeiling` is where that
     cap is enforced after the rouse scale has been applied. A boss
     that outruns a sprinting player at all times has no counterplay
     left in its feet, and the bestiary already settled this argument
     the other way: Martyr's Thresher only beats a retreat with a
     committed POUNCE, not with its cruise. Here the lance is that
     pounce - a burst, on a cadence, with a tell in front of it.

     NOT A LIMIT OF THE LEG SOLVER, which was the first guess and is
     wrong. The arithmetic said a foot replants every `stance` metres
     over a fixed 0.18s swing and so would skate past about 7.8 m/s;
     measured, the duty cycle simply rises with pace - 13% of
     foot-frames mid-step at the old 2.55, 40% at this ceiling, 69%
     at thirteen - and a PLANTED foot never slides a millimetre at
     any of them. The ceiling stays because of the counterplay
     argument above, which is the honest reason for it. */
  chaseSpeed: 8.15,
  chaseFrom: 14,
  chaseFull: 30,
  gaitCeiling: 8.25,
  /* Where in the band it settles while circling, and how hard it is
     pulled there - see the strafe branch of `stepStalk`.

     `holdAt` IS NOT THE MIDDLE OF THE BAND, and the first version of
     this made it so: mid-band is 7.5m, `comboReach` is 7.4, so the
     animal held station exactly one decimetre outside the range of
     its own scythes and then never chose them. Measured as four
     forced combos whiffing with the aim error at ten to fourteen
     degrees inside a forty-degree arc - a miss on DISTANCE, by a
     boss that had walked itself out of its own reach. It settles
     inside the swing, with room for a player to drift during the
     wind-up and still be there for the contact frame.

     The gain is soft on purpose: a stiff one turns a stalking animal
     into a tethered one that snaps back to a radius, which reads as a
     leash rather than as a decision. */
  holdAt: 6.3,
  bandGain: 1.6,

  /* Free, and while committed to a tell. The committed rate is what
     decides whether a sidestep beats a scythe, and it is the same
     0.6 rad/s the ordinary castes were tuned to in the melee pass -
     see ENEMY_MELEE_CONFIG.windupTurnRate. A boss that tracks harder
     than its own bestiary makes the dodge the player just learned
     stop working, which reads as the boss cheating. THE COMMITTED
     RATE IS NOT RAISED HERE, for that reason - see `leadLag` for
     what answers a circle instead. */
  turnRate: 2.4,
  committedTurnRate: 0.6,

  /* ------------------------------------------------------------
     LEADING THE SWING, and the second half of "too easy to avoid".

     Speed explains why the player was never in reach. It does not
     explain the rest of the measurement: orbiting at six metres a
     second at nine metres, inside scythe reach for better than a
     third of the run, the animal drew five tells and landed NONE -
     and roused, six tells and fourteen whiffs. Not a near miss
     either way. Permanent immunity, and the arithmetic behind it is
     one line: six metres a second at nine metres is 0.67 rad/s of
     bearing, and `committedTurnRate` is 0.60. A player holding a
     circle simply out-rotates the swing, for ever, by 0.07 rad/s.

     Widening the arc or raising the committed rate would fix the
     number and break the contract - a sidestep is supposed to beat a
     swing, in this fight and in every other. So the animal LEADS
     instead: through a tell it turns toward where the player will be
     when the blade lands rather than where they are while it is
     drawn. A constant orbit is a prediction, and it is now predicted.
     A change of direction is not, and still beats it - which is the
     dodge the bestiary teaches, made sharper rather than removed.

     Contact is still resolved against the LIVE player. The lead moves
     where the body points, never where the hit is tested.

     HOW FAR AHEAD IS NOT A TIME, it is a fraction of the animal's own
     tracking lag - which is what made the first attempt at this fall
     0.05 rad short and change nothing. `dampAngle` is exponential:
     the rate is a time constant, not a cap on rad/s, so a body
     tracking a bearing that turns at w settles a STEADY w/rate behind
     it. At the orbit above that is 1.12 rad - 64 degrees - against a
     40-degree arc, and leading by the wind-up's own 0.58s only buys
     21 of it back. Leading by `leadLag / rate` seconds instead
     cancels that fraction of the lag whatever the rate is, so one
     constant sizes itself correctly for the scythes and for the
     lance, which tracks two and a half times harder. The lance then
     adds a second, separate term for its own flight - `lanceLead`.

     Below 1.0 ON PURPOSE. At 1.0 a held circle is perfectly predicted
     and the boss becomes unmissable, which is the same fight with the
     sign flipped. At 0.7 a circle is still the best a moving player
     can do - it just stops being immunity. And the cost of a
     direction CHANGE goes up rather than down: the aim point flips to
     the wrong side of the player, so the error at contact is the lag
     plus the lead instead of the lag minus it. */
  leadLag: 0.7,
  leadMax: 7.5,
  /* The lance's share of its own flight time. Same argument as
     `leadLag` and a separate number because it answers a separate
     failure: a charge aimed where the player stood at the cock lands
     a metre behind them and then whiffs on the ARC, which is how four
     lances at a plinking trooper came to draw nothing. */
  lanceLead: 0.75,
  /* The player's velocity is differenced by this module - see
     `trackPlayer`. `trackDamp` is the player's own travel easing, and
     `trackCeiling` is above the jetpack's 30 m/s cruise so that every
     way a trooper can legitimately travel is predicted and everything
     faster is read as the teleport it is. */
  trackDamp: 18,
  trackCeiling: 34,

  /* Its territory, measured from where districtBosses parked it. Well
     inside that controller's arena ring (145m as of m101) on purpose: a
     module leash that can fire outside the ring it is nested in never
     fires at all, which is how the Garner's disengage sat dead for a
     milestone. The fight itself also stays on the flattened pan
     terrain.js carves for it (MATRIARCH_ARENA, flat to 78m), so the
     leash keeps her strikes on measured, level ground. */
  arenaRadius: 84,

  /* ------------------------------------------------------------
     THE SCYTHE COMBO. Two hits, then three once it has roused.

     `windup` and `contact` are the same contract the ordinary melee
     castes got in the melee-viability pass: the strike clip is
     restarted at the tell and time-scaled so its own contact frame
     lands exactly on the wind-up, and the hit is resolved against
     where the player IS at that frame. Step out of reach, step
     outside the arc, or raise Aegis in time, and it whiffs. */
  comboReach: 7.4,
  /* THE TELL IS NOT SHORTENED. Reaction time is a melee tax, and the
     complaint this pass answers was positional - the player could not
     be reached, not that they read the swing too easily. What is cut
     is the DEAD AIR either side of it: the recovery it stands through
     and the cadence it waits out, both of which were long enough that
     an animal in reach still spent most of its time doing nothing. */
  comboWindup: 0.58,
  comboContact: 0.642,          // measured, matches the authored clip
  comboGap: 0.40,               // between one scythe and the next
  comboRecover: 0.52,
  comboDamage: 30,
  /* +-40 degrees at the contact frame. Wider and no lateral dodge
     ever succeeds against a nine-metre turning circle; narrower and
     the boss misses a stationary target on the second beat because
     its own committed turn cannot keep up with the first one's
     knock. */
  comboArc: 0.766,
  comboCadence: 2.3,

  /* ------------------------------------------------------------
     THE LANCE. A gap-closer, and the only reason standing at twenty
     metres is not a strategy. It is a long tell on purpose - almost a
     full second of a reared, cocked animal - because what follows is
     unavoidable once it starts, and an unavoidable move has to be
     answerable before it does. */
  /* THE BAND IS THE WHOLE STAND-OFF NOW, not a window inside it. It
     ended at 23m, and a player at 24 was not making a hard read - they
     were outside the encounter, which the pressure probe measured as
     twenty-six seconds of nothing at all. If a range is safe it has to
     be safe because getting there cost something. */
  lanceRange: Object.freeze([9.5, 34]),
  lanceCock: 0.95,
  /* THE DASH IS AS LONG AS THE GAP, between these bounds. A fixed
     0.40s at 27 m/s is a fixed eleven metres, so the far half of the
     old band was answered by a charge that stopped short and left the
     animal standing in the open having announced itself for nothing.
     It now commits to ARRIVING - which is also why the cock is not
     shortened to match: a longer journey has to be readable for
     longer, not less. */
  /* THE FLOOR IS A DEGENERATE GUARD, NOT A MINIMUM CHARGE. It was
     0.30s, which at 30 m/s is nine metres - so every lance thrown
     from inside about fourteen ran clean PAST the player and then
     whiffed on the arc, because a target the charge has overshot is
     behind it. Measured, range by range, in the pressure probe: five
     of six ranges missed and the two shortest ended further away than
     they started. Below `lanceRange[0]` the travel is 4.8m and the
     duration 0.16s, so this bound never binds in play. */
  lanceDash: 0.12,
  /* Long enough to cross the band's far edge. At 0.72s it covered
     21.6m of a 34m throw and arrived twelve metres short and aimed
     twenty-five degrees off - the one range in the sweep that still
     missed once the floor was fixed. */
  lanceDashMax: 0.95,
  lanceSpeed: 30,
  lanceDamage: 44,
  lanceReach: 8.6,              // it arrives swinging, so slightly long
  /* WIDER THAN A SCYTHE, because it is not one. The combo's +-40
     degrees is the arc a blade sweeps from a planted animal; this is
     nine metres of body arriving at thirty metres a second, and a
     player a couple of metres off the line of it has not dodged
     anything. Narrow enough that going round it still works. */
  lanceArc: 0.5,                // +-60 degrees
  lanceCadence: 5.2,
  /* THE LANCE TRACKS HARDER THAN THE SCYTHES, and it is the one place
     this animal is allowed to. `committedTurnRate` exists so that a
     SIDESTEP beats a swing, which is the contract the whole bestiary
     shares. A lance is not a swing: it is the move that exists
     because standing off and strafing was free, so letting the same
     strafe defeat it for nothing puts the hole straight back. At 1.5
     rad/s over a 0.95s cock it can follow a player circling at about
     six metres a second at ten metres - which is a player holding
     station - and cannot follow one who commits to a direction, gets
     behind cover, or simply runs. Measured against an orbiting probe
     in `saintfall-matriarch-fight.mjs`: at 0.6 it landed nought out
     of three. */
  lanceTrack: 1.5,

  /* ------------------------------------------------------------
     THE CULL, and the reason this animal is worth fighting.

     The gaster is behind it, so the encounter is "get behind it" -
     and before this the answer was to walk there and stay. Loiter in
     the rear arc inside `cullRadius` for `cullLoiter` seconds and it
     turns the long way round at speed, sweeping the gaster and the
     back four legs through everything at ground level.

     It is a POSITION move, not a damage one: the damage is a third of
     a scythe, and what it actually does is put the player back out in
     front where the fold is pointing. */
  cullRadius: 11.5,
  cullRearDot: -0.12,           // "behind" is anything past ~97 degrees
  /* The loiter clock is the move's whole promise - "staying here costs
     you" - and at 1.6s against a 6.0s cooldown the honest reading was
     that it cost you once every seven and a half seconds. Shortened
     with the cadence rather than instead of it: a clock that fires
     quickly and then cannot fire again is the same permission with a
     jump scare in front of it. */
  cullLoiter: 1.0,
  cullWindup: 0.44,
  cullSweep: 0.30,
  cullDamage: 24,
  cullReach: 9.4,
  cullSpin: 7.2,                // rad/s through the sweep - the whip
  cullCadence: 4.2,

  /* ------------------------------------------------------------
     THE TREMOR RITE. No adds. The ovipositor plants and three floor
     waves leave the animal on separate beats; after the rouse there
     are four. Each wave is a timing check against the player's jump,
     boost and jetpack rather than a second target list.

     The ring reaches the edge of the lance band in 1.62s. Its bright
     visual front is spawned from the same numbers as its damage front,
     and the 0.55m clearance matches the jump contract already taught by
     the Abbess slam. The Matriarch is planted through the sequence and
     presents the gaster, so damage pressure and opportunity are the
     same beat. */
  tremorEvery: 12.5,
  tremorEveryRoused: 9.0,
  tremorWindup: 1.45,
  tremorPulseGap: 0.68,
  tremorWaves: 3,
  tremorWavesRoused: 4,
  tremorRecover: 0.55,
  tremorRadius: 34,
  tremorSpeed: 21,
  tremorBand: 1.35,
  tremorDamage: 24,
  tremorAirClear: 0.55,
  tremorSlowFactor: 0.72,
  tremorSlowSeconds: 0.85,
  tremorWeakBonus: 1.25,

  /* ------------------------------------------------------------
     THE ROUSE. One beat, once, at 45% - and the only phase change in
     the fight. A boss with four phases on one health bar is four
     fights nobody finished; this is the same fight with the safety
     off. */
  rouseAt: 0.45,
  rouseSeconds: 1.7,
  rouseRadius: 11,
  rouseDamage: 18,
  /* The speed scale rides on top of a stalk that already runs, and is
     clamped by `gaitCeiling` before it reaches the feet - so rousing
     buys most of its pressure back through the cadences, where it can
     be read, rather than through a sprint the legs cannot animate. */
  rouseSpeedScale: 1.3,
  rouseCadenceScale: 0.7,

  /* The vertical half-reach of everything it swings, and where that
     reach is centred on the body - see `tryLand`. The model is 5.05m
     tall and the fold pivots high on it, so the sweep covers a band
     around mid-body rather than a band around its feet. Deliberately
     short of the ridge's full 20m swing: a player who has climbed
     eleven metres up the slope really is out of reach of a ground
     animal, and getting there is counterplay rather than a hole. */
  strikeCentre: 2.2,
  strikeHeight: 5.6,

  /* A lance sweep can cancel a tell in its first half and not after -
     the same armour window every other caste got, so the player's
     read of "I can interrupt that" transfers. */
  interruptWindow: 0.5,
});

const REST = new Set(["idle", "alert"]);

export function buildMatriarch(ctx) {
  const { enemies } = ctx;
  const bus = makeBus();
  const C = MATRIARCH_CONFIG;

  /* One brain per live Matriarch, keyed by the durable instance id.
     There is normally exactly one - the Gilded Reach's - but the
     Abbess lays a Matriarch at a third health, and a second copy of
     this animal running the OLD generic brain beside the new one
     would read as two different creatures wearing one model. */
  const brains = new Map();

  const groundAt = (x, z) => (ctx.collide?.groundHeight?.(x, z)
    ?? ctx.terrain.heightAt(x, z));

  function makeBrain(inst) {
    return {
      id: inst.id,
      lastHealth: inst.health,
      act: null,             // null | combo | lance | cull | tremor | rouse
      actFor: 0,             // seconds left in the action as a whole
      pending: -1,           // seconds to the next contact, or -1
      step: 0,               // which scythe of the combo
      steps: 2,
      lockYaw: inst.yaw,
      comboTimer: C.comboCadence * 0.45,
      lanceTimer: C.lanceCadence * 0.5,
      cullTimer: C.cullCadence * 0.6,
      tremorTimer: C.tremorEvery * 0.55,
      waves: [],
      rearFor: 0,
      dashFor: C.lanceDash,  // set per lance, from the gap it has to cross
      strafeDir: 1,
      strafeFor: C.strafeFlipSeconds,
      roused: false,
      spin: 0,               // the cull's whip, rad/s
      tells: 0,
      landed: 0,
      whiffed: 0,
      culls: 0,
      lances: 0,
      tremors: 0,
      tremorHits: 0,
      tremorClears: 0,
      lastMiss: null,
      misses: { range: 0, arc: 0, height: 0, sight: 0 },
    };
  }

  function brainFor(inst) {
    let brain = brains.get(inst.id);
    if (!brain) {
      brain = makeBrain(inst);
      brains.set(inst.id, brain);
    }
    return brain;
  }

  /* ============================================================
     THE ANIMAL'S OWN GEOMETRY
     ============================================================ */

  /** Where the player is relative to the animal's facing: distance,
   *  and the dot of its forward against the bearing to them. +1 is
   *  dead ahead and -1 is straight up the ovipositor. */
  function bearing(inst, px, pz) {
    const dx = px - inst.x;
    const dz = pz - inst.z;
    const dist = Math.hypot(dx, dz) || 1e-4;
    const fwd = Math.sin(inst.yaw) * (dx / dist) + Math.cos(inst.yaw) * (dz / dist);
    return { dx, dz, dist, dot: fwd };
  }

  function faceTowards(inst, x, z, rate, dt) {
    const dx = x - inst.x;
    const dz = z - inst.z;
    if (Math.hypot(dx, dz) < 1e-3) return;
    inst.yaw = dampAngle(inst.yaw, Math.atan2(dx, dz), rate, dt);
    inst.root.rotation.y = inst.yaw;
  }

  /* ------------------------------------------------------------
     WHERE THE PLAYER IS GOING, differenced here rather than read from
     `player.state.travelSpeed`.

     That field is the right idea and the wrong source. It is measured
     inside the player's own update from input-driven displacement,
     and `player.spawn` ZEROES IT - so every path that repositions the
     body without walking it there leaves a moving player reading as a
     stationary one. The first version of this leaned on it and the
     lead did nothing at all under the pressure probe, which drives
     the trooper by teleport: not a wrong number, a permanently absent
     one, and it looked exactly like the prediction being too weak.

     Differencing the position costs four lines and answers for every
     way a body can travel - walked, boosted, hauled, dragged by a
     line - because all of them move it. */
  const track = { x: 0, z: 0, vx: 0, vz: 0, seeded: false };

  function trackPlayer(dt) {
    const ps = ctx.player.state;
    if (!track.seeded || dt < 1e-5) {
      track.x = ps.x; track.z = ps.z; track.seeded = true;
      return;
    }
    const dx = ps.x - track.x;
    const dz = ps.z - track.z;
    track.x = ps.x;
    track.z = ps.z;
    /* A TELEPORT IS NOT A RUN. A spawn, a load or an arena reset moves
       the body further in one frame than any traversal tool can, and
       predicting from it would throw the swing across the district.
       Above the jetpack's own cruise the sample is discarded and the
       animal aims at the live position until the body reads honest
       again. */
    if (Math.hypot(dx, dz) / dt > C.trackCeiling) {
      track.vx = 0;
      track.vz = 0;
      return;
    }
    // The same easing the player's own travel measure uses, so a
    // change of direction is predicted from a settled heading rather
    // than from one frame's jitter.
    const k = 1 - Math.exp(-C.trackDamp * dt);
    track.vx += (dx / dt - track.vx) * k;
    track.vz += (dz / dt - track.vz) * k;
  }

  /** Where the player will be when the blade arrives - see `leadLag`.
   *  Led along their TRAVEL, which is not where the body is pointed: a
   *  trooper strafing round this animal is facing it the whole time,
   *  so reading their facing would lead every circle straight back
   *  into the boss and predict nothing.
   *
   *  `seconds` is how far ahead to predict, and the two callers derive
   *  it from different things because they are answering different
   *  questions. A SWING is beaten by the animal's turning lag, so it
   *  leads by a fraction of that lag - `leadLag / rate`. A LANCE is a
   *  committed charge along a bearing it cannot correct once thrown,
   *  so it leads by a fraction of its own FLIGHT TIME, the way anything
   *  that has to intercept a moving target does. A player standing
   *  still is led nowhere and the animal simply faces them. */
  function leadPoint(seconds) {
    const ps = ctx.player.state;
    const speed = Math.hypot(track.vx, track.vz);
    const ahead = Math.min(speed * Math.max(0, seconds), C.leadMax);
    if (!(ahead > 0.05)) return { x: ps.x, z: ps.z };
    const inv = ahead / speed;
    return { x: ps.x + track.vx * inv, z: ps.z + track.vz * inv };
  }

  /** How far away the player will be when a move started NOW resolves.
   *
   *  The animal aims where the player is going; it has to DECIDE there
   *  too. Choosing on the live distance meant committing to a swing at
   *  7.3m that resolved six tenths of a second later at 8.5, and the
   *  miss tally says so plainly - range was the single largest reason
   *  a live orbit drew nothing, ahead of the arc and the ridge put
   *  together. This is not the aiming lead and does not borrow its
   *  caps: it is a plain question about a distance. */
  function reachIn(inst, seconds) {
    const ps = ctx.player.state;
    const px = ps.x + track.vx * seconds;
    const pz = ps.z + track.vz * seconds;
    return Math.hypot(px - inst.x, pz - inst.z);
  }

  /** Advance the body, refusing masonry and its own territory.
   *  The leg solver does everything else - feet replant themselves
   *  once the body has dragged their rest pose far enough, which is
   *  why walking an eight-legged animal costs three lines here. */
  function moveBody(inst, brain, vx, vz, dt) {
    const speed = Math.hypot(vx, vz);
    if (speed < 1e-4) return;
    const ux = vx / speed;
    const uz = vz / speed;
    if (ctx.collide?.rayBlock) {
      const probe = ctx.collide.rayBlock(inst.x, groundAt(inst.x, inst.z) + 2.6,
        inst.z, ux, 0, uz, 6.5);
      if (probe < 6.5) {
        // Turned along the obstacle rather than stopped dead: a boss
        // that parks against a ruin is a boss the player shoots from
        // behind the ruin.
        const side = brain.strafeDir;
        inst.x += -uz * side * speed * dt;
        inst.z += ux * side * speed * dt;
        return;
      }
    }
    let nx = inst.x + vx * dt;
    let nz = inst.z + vz * dt;
    const home = inst.home;
    if (home) {
      const hx = nx - home.x;
      const hz = nz - home.z;
      const out = Math.hypot(hx, hz);
      if (out > C.arenaRadius) {
        nx = home.x + (hx / out) * C.arenaRadius;
        nz = home.z + (hz / out) * C.arenaRadius;
      }
    }
    inst.x = nx;
    inst.z = nz;
  }

  /* ============================================================
     ACTIONS

     Every one of them is the same three beats: a tell that commits
     the animal, a contact frame that resolves against the live
     player, and a recovery it cannot act out of. `brain.pending`
     is the contact; `brain.actFor` is the whole thing.
     ============================================================ */

  function cadenceScale(brain) {
    return brain.roused ? C.rouseCadenceScale : 1;
  }

  function beginCombo(inst, brain) {
    brain.act = "combo";
    brain.step = 0;
    brain.steps = brain.roused ? 3 : 2;
    brain.actFor = C.comboWindup + (brain.steps - 1) * C.comboGap + C.comboRecover;
    brain.pending = C.comboWindup;
    brain.lockYaw = inst.yaw;
    brain.comboTimer = C.comboCadence * cadenceScale(brain);
    brain.tells += 1;
    inst.actionLocked = true;
    // Time-scaled so the clip's own contact frame lands on the tell.
    enemies.replay?.(inst, "strike", 0.06, C.comboContact, C.comboWindup);
    ctx.audio?.hiss?.(inst.x, inst.z);
    bus.emit("comboTell", { x: inst.x, z: inst.z, steps: brain.steps });
  }

  function beginLance(inst, brain) {
    /* HOW FAR IT HAS DECIDED TO TRAVEL, fixed at the cock so the whole
       move has one duration that the tell, the contact and the
       interrupt window all agree on. Short of the player by half a
       reach, because it arrives swinging and should not finish the
       dash standing inside them.

       SIZED AGAINST THE GAP IT WILL FIND, not the one it can see. A
       charge measured at the cock and thrown a second and a half
       later is a charge aimed at a place the player has left: against
       a trooper holding a plinking range - who backs off the moment
       it commits - it crossed nineteen metres of the twenty-five it
       needed and stopped short, and the miss tally recorded three of
       four lances failing on RANGE alone. The flight time and the gap
       define each other, so it is solved rather than read: one pass
       to guess the flight, a second to size the dash against where
       the player will be at the end of it. */
    let flight = C.lanceCock + C.lanceDash;
    for (let i = 0; i < 2; i += 1) {
      const travel = Math.max(0, reachIn(inst, flight) - C.lanceReach * 0.55);
      flight = C.lanceCock + Math.max(C.lanceDash,
        Math.min(C.lanceDashMax, travel / C.lanceSpeed));
    }
    brain.dashFor = flight - C.lanceCock;
    brain.act = "lance";
    brain.actFor = C.lanceCock + brain.dashFor + C.comboRecover;
    brain.pending = C.lanceCock + brain.dashFor;
    brain.lockYaw = inst.yaw;
    brain.lanceTimer = C.lanceCadence * cadenceScale(brain);
    brain.lances += 1;
    brain.tells += 1;
    inst.actionLocked = true;
    /* The COCK is the alert pose - arms drawn in tight, gaster up -
       rather than a new clip, and deliberately: the player has
       already been taught that this shape means the animal is about
       to do something, on the beat it woke up. */
    enemies.play?.(inst, "alert", 0.08);
    ctx.vfx?.slamCharge?.(inst.x, groundAt(inst.x, inst.z) + 0.4, inst.z, 3.4);
    ctx.audio?.slamCharge?.(inst.x, inst.z);
    bus.emit("lanceTell", { x: inst.x, z: inst.z });
  }

  function beginCull(inst, brain) {
    brain.act = "cull";
    brain.actFor = C.cullWindup + C.cullSweep + 0.55;
    brain.pending = C.cullWindup + C.cullSweep * 0.5;
    brain.cullTimer = C.cullCadence * cadenceScale(brain);
    brain.rearFor = 0;
    brain.culls += 1;
    brain.tells += 1;
    inst.actionLocked = true;
    /* WHICH WAY IT TURNS is chosen once, here, and it is the LONG way
       round - the side the player is not on. Turning the short way
       would sweep them out of the arc it is trying to clear, which is
       a move that misses by design. */
    const ps = ctx.player.state;
    const rel = ((Math.atan2(ps.x - inst.x, ps.z - inst.z) - inst.yaw + Math.PI * 3) % TAU)
      - Math.PI;
    brain.spin = (rel >= 0 ? -1 : 1) * C.cullSpin;
    enemies.play?.(inst, "strike", 0.10);
    ctx.audio?.hiss?.(inst.x, inst.z);
    bus.emit("cullTell", { x: inst.x, z: inst.z });
  }

  function beginTremor(inst, brain) {
    brain.act = "tremor";
    brain.step = 0;
    brain.steps = brain.roused ? C.tremorWavesRoused : C.tremorWaves;
    brain.actFor = C.tremorWindup + (brain.steps - 1) * C.tremorPulseGap
      + C.tremorRecover;
    brain.pending = C.tremorWindup;
    brain.tremorTimer = (brain.roused ? C.tremorEveryRoused : C.tremorEvery)
      * cadenceScale(brain);
    brain.tremors += 1;
    brain.tells += 1;
    inst.actionLocked = true;
    /* THE WINDOW. Presented from the tell rather than from the first wave,
       so the reward starts when the animal commits and not when the
       player has already had to decide. */
    inst.weakBonus = C.tremorWeakBonus;
    enemies.play?.(inst, "brood", 0.16);
    const y = groundAt(inst.x, inst.z);
    ctx.vfx?.matriarchTremorTell?.(inst.x, y, inst.z, C.tremorRadius,
      brain.roused);
    bus.emit("tremorTell", { x: inst.x, z: inst.z, waves: brain.steps,
      roused: brain.roused });
  }

  function beginRouse(inst, brain) {
    brain.roused = true;
    brain.act = "rouse";
    brain.actFor = C.rouseSeconds;
    brain.pending = C.rouseSeconds * 0.42;
    inst.actionLocked = true;
    enemies.play?.(inst, "alert", 0.12);
    ctx.mission?.announce?.("THE MATRIARCH ROUSES", 2.8);
    bus.emit("rouse", { x: inst.x, z: inst.z });
  }

  /* ============================================================
     CONTACT

     One test, shared. A hit lands only if the player is inside the
     reach, inside the arc, and on the near side of a wall - all
     re-checked on the contact frame rather than assumed from the
     frame the tell began, which is the entire difference between a
     telegraph and a receipt.
     ============================================================ */

  /** WHY A SWING DREW NOTHING, tallied. `tryLand` rejects on four
   *  separate grounds and used to return the same bare false for all
   *  of them, so a boss landing none of eight tells could not say
   *  whether it was mis-aimed, out of range, or standing on the wrong
   *  side of a ridge - which are three different bugs with three
   *  different fixes, and the arena's answer turned out not to be the
   *  one being guessed at. Read through `status().misses`. */
  function miss(brain, why) {
    brain.misses[why] += 1;
    brain.lastMiss = why;
    return false;
  }

  function tryLand(inst, brain, reach, arc, damage, source) {
    const combat = ctx.combat;
    if (!combat || combat.player.dead) return false;
    const ps = ctx.player.state;
    const { dist, dot, dx, dz } = bearing(inst, ps.x, ps.z);
    if (dist > reach) return miss(brain, "range");
    if (dot < arc) return miss(brain, "arc");
    /* HOW FAR UP AND DOWN THE SCYTHES REACH. A capsule ten metres
       overhead is not in reach of a ground animal, whatever the plan
       view says - but this was +-3.4m around a metre off the ground,
       which is the ordinary bestiary's 2.8m barely widened, on an
       animal five metres tall with four-and-a-half-metre legs.

       IT MATTERS BECAUSE OF WHERE THIS FIGHT IS SITED. The Gilded
       Reach's marker sits on a ridge: measured, the ground within
       nine metres of the boss runs from 8.7m BELOW it to 11.2m above.
       With the old gate a player circling at scythe range passed the
       height check 42% of the time, so the majority of a correctly
       aimed, in-range swing simply could not resolve - which reads as
       exactly the complaint this pass is about, and is not something
       any amount of speed fixes. Centred on the middle of the body
       rather than on its feet, and sized to the body. */
    if (Math.abs(ps.y - (inst.y + C.strikeCentre)) > C.strikeHeight) {
      return miss(brain, "height");
    }
    const inv = 1 / (dist || 1);
    if (ctx.collide?.rayBlock
      && ctx.collide.rayBlock(inst.x, inst.y + C.strikeCentre, inst.z,
        dx * inv, 0, dz * inv, dist) < dist - 0.2) return miss(brain, "sight");
    combat.hurtPlayer(damage * SURVIVAL_CONFIG.enemyDamageMultiplier, {
      source: "enemy-melee",
      enemyId: inst.id,
      enemyKey: inst.key,
      x: ps.x, y: ps.y + 1.0, z: ps.z,
    });
    brain.landed += 1;
    brain.lastMiss = null;
    ctx.player?.punch?.(1.35);
    ctx.player?.doctrineKick?.(0.85, 0.8);
    bus.emit(source, { x: ps.x, z: ps.z, damage });
    return true;
  }

  function resolveContact(inst, brain) {
    const ps = ctx.player.state;
    const y = groundAt(inst.x, inst.z);
    if (brain.act === "combo") {
      // The blade arriving, drawn where the fold actually is - out
      // past the face rather than at the body origin.
      ctx.vfx?.meleeArc?.(inst.x + Math.sin(inst.yaw) * 4.2, inst.y + 2.4,
        inst.z + Math.cos(inst.yaw) * 4.2, inst.yaw, 3.4, 1.5);
      const hit = tryLand(inst, brain, C.comboReach, C.comboArc,
        C.comboDamage, "combo");
      if (!hit) brain.whiffed += 1;
      brain.step += 1;
      brain.pending = brain.step < brain.steps ? C.comboGap : -1;
      if (brain.pending > 0) {
        enemies.replay?.(inst, "strike", 0.05, C.comboContact, C.comboGap);
      }
      return;
    }
    if (brain.act === "lance") {
      ctx.vfx?.slamImpact?.(inst.x, y, inst.z, 1.0);
      ctx.audio?.slamImpact?.(inst.x, inst.z, 0.6);
      const hit = tryLand(inst, brain, C.lanceReach, C.lanceArc,
        C.lanceDamage, "lance");
      if (!hit) brain.whiffed += 1;
      brain.pending = -1;
      return;
    }
    if (brain.act === "cull") {
      /* Swept, not struck: no arc test, because the whole move is the
         animal turning THROUGH the player. Reach is the only gate,
         and it is long - this is nine metres of gaster travelling
         sideways at head height. */
      ctx.vfx?.blast?.(inst.x, y + 0.5, inst.z, C.cullReach * 0.7);
      ctx.audio?.rumble?.(inst.x, inst.z, 0.8);
      const hit = tryLand(inst, brain, C.cullReach, -1, C.cullDamage, "cull");
      if (!hit) brain.whiffed += 1;
      ctx.player?.punch?.(hit ? 1.6 : 0.5);
      brain.pending = -1;
      return;
    }
    if (brain.act === "tremor") {
      brain.step += 1;
      brain.waves.push({ x: inst.x, z: inst.z, radius: 0,
        resolved: false, index: brain.step });
      ctx.vfx?.matriarchTremorWave?.(inst.x, y, inst.z, C.tremorRadius,
        C.tremorRadius / C.tremorSpeed, brain.roused, brain.step);
      ctx.vfx?.sandSpray?.(inst.x - Math.sin(inst.yaw) * 4.8, y,
        inst.z - Math.cos(inst.yaw) * 4.8, 1.4);
      bus.emit("tremorPulse", { x: inst.x, z: inst.z, index: brain.step,
        waves: brain.steps, roused: brain.roused });
      brain.pending = brain.step < brain.steps ? C.tremorPulseGap : -1;
      return;
    }
    if (brain.act === "rouse") {
      ctx.vfx?.blast?.(inst.x, y + 1.2, inst.z, C.rouseRadius * 0.8);
      ctx.audio?.rumble?.(inst.x, inst.z, 1.0);
      ctx.player?.punch?.(1.2);
      const dist = Math.hypot(ps.x - inst.x, ps.z - inst.z);
      if (dist < C.rouseRadius && !ctx.combat.player.dead) {
        ctx.combat.hurtPlayer(C.rouseDamage * SURVIVAL_CONFIG.enemyDamageMultiplier, {
          source: "matriarch-rouse", enemyId: inst.id, enemyKey: inst.key,
          x: ps.x, y: ps.y + 1.0, z: ps.z,
        });
      }
      brain.pending = -1;
    }
  }

  /** Advance the damaging front separately from the planted action.
   *
   *  The last ring is still travelling when the recovery ends, so tying
   *  it to `brain.act` would make its outside half harmless. Each emitted
   *  front therefore owns its origin, radius and one player resolution.
   *  It never spawns an entity and is discarded once it clears the arena. */
  function stepTremorWaves(inst, brain, dt) {
    if (!brain.waves.length) return;
    const ps = ctx.player.state;
    for (let i = brain.waves.length - 1; i >= 0; i -= 1) {
      const wave = brain.waves[i];
      const before = wave.radius;
      wave.radius += C.tremorSpeed * dt;

      if (!wave.resolved && !ctx.combat.player.dead) {
        const dist = Math.hypot(ps.x - wave.x, ps.z - wave.z);
        const crossed = dist >= Math.max(0, before - C.tremorBand)
          && dist <= wave.radius + C.tremorBand;
        if (crossed && dist <= C.tremorRadius + C.tremorBand) {
          wave.resolved = true;
          const clearance = ps.y - groundAt(ps.x, ps.z);
          if (clearance > C.tremorAirClear) {
            brain.tremorClears += 1;
            ctx.player?.doctrineKick?.(0.52, 0.38);
            bus.emit("tremorCleared", { x: ps.x, z: ps.z,
              index: wave.index, clearance });
          } else {
            brain.tremorHits += 1;
            ctx.combat.hurtPlayer(C.tremorDamage
              * SURVIVAL_CONFIG.enemyDamageMultiplier, {
              source: "matriarch-tremor", enemyId: inst.id, enemyKey: inst.key,
              x: ps.x, y: ps.y + 1.0, z: ps.z,
            });
            ctx.player?.applySlow?.(C.tremorSlowFactor, C.tremorSlowSeconds);
            ctx.player?.punch?.(1.25);
            ctx.player?.doctrineKick?.(0.78, 0.65);
            bus.emit("tremorHit", { x: ps.x, z: ps.z,
              index: wave.index, damage: C.tremorDamage });
          }
        }
      }

      if (wave.radius > C.tremorRadius + C.tremorBand) brain.waves.splice(i, 1);
    }
  }

  /* ============================================================
     THE STEP
     ============================================================ */

  function stepAction(inst, brain, dt) {
    const ps = ctx.player.state;
    brain.actFor = Math.max(0, brain.actFor - dt);
    if (brain.pending > 0) {
      brain.pending -= dt;
      if (brain.pending <= 0) resolveContact(inst, brain);
    }

    if (brain.act === "cull") {
      // The whip. Free rotation at `cullSpin` for the length of the
      // sweep, then it settles back onto the player.
      const sweeping = brain.actFor > 0.55;
      if (sweeping) {
        inst.yaw = (inst.yaw + brain.spin * dt + TAU) % TAU;
        inst.root.rotation.y = inst.yaw;
      } else {
        faceTowards(inst, ps.x, ps.z, C.turnRate, dt);
      }
    } else if (brain.act === "lance") {
      const dashing = brain.actFor <= brain.dashFor + C.comboRecover
        && brain.actFor > C.comboRecover;
      if (dashing) {
        moveBody(inst, brain, Math.sin(brain.lockYaw) * C.lanceSpeed,
          Math.cos(brain.lockYaw) * C.lanceSpeed, dt);
        ctx.vfx?.slamTrail?.(inst.x, groundAt(inst.x, inst.z) + 0.3, inst.z);
      } else if (brain.actFor > brain.dashFor + C.comboRecover) {
        // Still cocking: it stands still and re-aims - see lanceTrack
        // for why this one move is allowed to follow a strafe, and
        // leadPoint for why it aims where the strafe is going.
        /* BOTH LEADS, and the second one is why a charge that arrived
           five metres away still missed by thirty-six degrees. The
           flight term alone left the animal carrying its own TRACKING
           lag into the dash - a couple of metres of lateral error
           measured at twenty-four, which is six degrees there and
           twenty-seven by the time it has closed to five. An error
           committed at range grows as the range shrinks. So it nulls
           the lag first, the way a swing does, and then leads the
           flight on top of it. */
        const aim = leadPoint(C.leadLag / C.lanceTrack + brain.pending * C.lanceLead);
        faceTowards(inst, aim.x, aim.z, C.lanceTrack, dt);
        brain.lockYaw = inst.yaw;
      }
    } else if (brain.act === "tremor") {
      // Planted. It does not even turn - that is what makes the
      // window a window.
    } else if (brain.act !== "rouse") {
      const aim = leadPoint(C.leadLag / C.committedTurnRate);
      faceTowards(inst, aim.x, aim.z, C.committedTurnRate, dt);
    }

    if (brain.actFor <= 0) {
      brain.act = null;
      brain.pending = -1;
      brain.spin = 0;
      inst.actionLocked = false;
      inst.weakBonus = 1;
      if (REST.has(inst.state) === false) enemies.play?.(inst, "alert", 0.2);
    }
  }

  /** Cancel whatever is in progress. A stagger costs the animal its
   *  swing, not its fight - and only in the tell's first half, the
   *  same armour window the ordinary castes carry. */
  function cancel(inst, brain, armouredCheck = true) {
    if (!brain.act) return false;
    /* Once the first seismic front has left the body the chain is
       committed. Before that, the first half of the long plant can be
       interrupted on the same contract as every other tell. */
    if (armouredCheck && brain.act === "tremor" && brain.step > 0) return false;
    if (armouredCheck && brain.pending > 0) {
      const total = brain.act === "combo" ? C.comboWindup
        : brain.act === "lance" ? C.lanceCock + brain.dashFor
          : brain.act === "cull" ? C.cullWindup + C.cullSweep * 0.5
            : brain.act === "tremor" ? C.tremorWindup
            : brain.pending;
      if (brain.pending < total * C.interruptWindow) return false;
    }
    brain.act = null;
    brain.actFor = 0;
    brain.pending = -1;
    brain.spin = 0;
    inst.actionLocked = false;
    inst.weakBonus = 1;
    return true;
  }

  function chooseAction(inst, brain, dist, dot, sees) {
    /* Order is priority, and the first entry is the point of the
       fight: everything else waits while the player is somewhere the
       gaster is not defended. */
    if (brain.cullTimer <= 0 && dist < C.cullRadius && dot < C.cullRearDot
      && brain.rearFor >= C.cullLoiter) return beginCull(inst, brain);
    if (brain.tremorTimer <= 0 && sees) return beginTremor(inst, brain);
    /* Both of these ask where the player will BE, not where they are.
       The combo looks one wind-up ahead; the lance looks over its cock
       plus the shortest dash it could throw, since the dash length is
       chosen from the gap it finds when it commits. */
    if (brain.comboTimer <= 0 && sees && dot > C.comboArc * 0.6
      && reachIn(inst, C.comboWindup) <= C.comboReach) return beginCombo(inst, brain);
    const at = reachIn(inst, C.lanceCock + C.lanceDash);
    if (brain.lanceTimer <= 0 && sees
      && at >= C.lanceRange[0] && at <= C.lanceRange[1]) return beginLance(inst, brain);
    return null;
  }

  /** How fast it closes, which depends on how far it is being made to
   *  come. At the band's edge it walks; by `chaseFull` it is running.
   *  Clamped to the gait ceiling AFTER the rouse scale, because the
   *  legs do not know the animal is angry - see `gaitCeiling`. */
  function closeSpeed(brain, dist) {
    const t = Math.max(0, Math.min(1,
      (dist - C.chaseFrom) / Math.max(0.1, C.chaseFull - C.chaseFrom)));
    const base = C.walkSpeed + (C.chaseSpeed - C.walkSpeed) * t;
    return Math.min(base * (brain.roused ? C.rouseSpeedScale : 1), C.gaitCeiling);
  }

  function stepStalk(inst, brain, dt, dist) {
    const ps = ctx.player.state;
    faceTowards(inst, ps.x, ps.z, C.turnRate, dt);
    const scale = brain.roused ? C.rouseSpeedScale : 1;
    const dx = ps.x - inst.x;
    const dz = ps.z - inst.z;
    const inv = 1 / (dist || 1);
    const ux = dx * inv;
    const uz = dz * inv;

    brain.strafeFor -= dt;
    if (brain.strafeFor <= 0) {
      brain.strafeFor = C.strafeFlipSeconds;
      brain.strafeDir = -brain.strafeDir;
    }

    if (dist > C.holdBand[1]) {
      const close = closeSpeed(brain, dist);
      moveBody(inst, brain, ux * close, uz * close, dt);
      if (inst.state !== "alert") enemies.play?.(inst, "alert", 0.22);
      return;
    }
    if (dist < C.holdBand[0]) {
      // Giving ground. A thing this size backing away from you is
      // worth more menace than a charge, and it re-opens the range
      // its own scythes want.
      moveBody(inst, brain, -ux * C.backSpeed * scale, -uz * C.backSpeed * scale, dt);
      if (inst.state !== "alert") enemies.play?.(inst, "alert", 0.22);
      return;
    }
    /* IN THE BAND, and the band is not a dead zone. It was: between
       the two edges the animal only strafed, so a player backing out
       of it at aiming pace left faster than it circled and the fight
       settled at twice the range it is written for - the stand-off
       scenario averaged 19.5m against a band that ends at 9.4. It
       still circles, and it now also HOLDS ITS RANGE while it does,
       pulled toward the middle of the band rather than released
       anywhere inside it. */
    const side = brain.strafeDir;
    const drift = Math.max(-C.backSpeed,
      Math.min(C.walkSpeed, (dist - C.holdAt) * C.bandGain)) * scale;
    moveBody(inst, brain,
      -uz * side * C.strafeSpeed * scale + ux * drift,
      ux * side * C.strafeSpeed * scale + uz * drift, dt);
    if (inst.state !== "alert") enemies.play?.(inst, "alert", 0.24);
  }

  function stepInstance(inst, dt) {
    const brain = brainFor(inst);

    if (inst.state === "death" || inst.health <= 0) {
      inst.actionLocked = false;
      inst.weakBonus = 1;
      brain.waves.length = 0;
      return;
    }
    /* Gated actors do not perceive, move or attack. districtBosses
       owns this gate for the Gilded Reach - dormant until its arena is
       entered, then a locked reveal beat - and this module must not
       start a fight the encounter controller has not started. */
    if (inst.encounterHidden || inst.encounterLocked) {
      if (brain.act) cancel(inst, brain, false);
      brain.waves.length = 0;
      return;
    }
    /* An arena reset teleports the animal home at full health with no
       message to anyone. Health going back UP is the only reliable
       sign of it from in here, and a brain left mid-combo would
       resolve a scythe against a player two hundred metres away. */
    if (inst.health > brain.lastHealth + 1) {
      cancel(inst, brain, false);
      brain.roused = false;
      brain.tremorTimer = C.tremorEvery * 0.55;
      brain.waves.length = 0;
    }
    brain.lastHealth = inst.health;
    stepTremorWaves(inst, brain, dt);

    /* STUNNED CREATURES DO NOTHING, and a stagger inside the first
       half of a tell takes the swing with it. The gate lives here
       because this module has taken ownership of the decisions
       `stepEnemy` would otherwise make - including this one. */
    if (inst.stunTime > 0) {
      inst.stunTime = Math.max(0, inst.stunTime - dt);
      inst.suspicion = 1;
      inst.alerted = true;
      cancel(inst, brain);
      return;
    }

    const combat = ctx.combat;
    const ps = ctx.player.state;
    const { dist, dot } = bearing(inst, ps.x, ps.z);
    const sees = !combat.player.dead;

    // How long they have been standing where the weak point is.
    if (dot < C.cullRearDot && dist < C.cullRadius) brain.rearFor += dt;
    else brain.rearFor = Math.max(0, brain.rearFor - dt * 1.6);

    brain.comboTimer -= dt;
    brain.lanceTimer -= dt;
    brain.cullTimer -= dt;
    if (sees) brain.tremorTimer -= dt;

    if (brain.act) { stepAction(inst, brain, dt); return; }

    if (!brain.roused && inst.maxHealth > 0
      && inst.health / inst.maxHealth <= C.rouseAt) {
      beginRouse(inst, brain);
      return;
    }
    if (combat.player.dead) {
      if (inst.state !== "idle") enemies.play?.(inst, "idle", 0.3);
      return;
    }
    if (chooseAction(inst, brain, dist, dot, sees)) return;
    stepStalk(inst, brain, dt, dist);
  }

  /* ============================================================
     ADOPTION

     `inst.selfDriven` is set per INSTANCE rather than on the species
     spec, and the difference matters: the spec flag would also claim
     any Matriarch the game spawns before this module has decided it
     owns it, and a claimed creature nobody is driving stands still
     for ever. Set on the frame it is first seen; released the frame
     it dies.
     ============================================================ */

  function adopt(inst) {
    if (inst.selfDriven) return;
    inst.selfDriven = true;
    inst.weakBonus = 1;
    const brain = brainFor(inst);
    brain.lastHealth = inst.health;
    if (!inst.home) inst.home = { x: inst.x, z: inst.z };
    bus.emit("adopted", { id: inst.id, x: inst.x, z: inst.z });
  }

  function update(dt) {
    const d = Math.min(0.1, Math.max(0, dt));
    if (!ctx.player?.state || !ctx.combat) return;
    // Once a frame, before any animal reads it, and whether or not one
    // is awake - a boss that starts tracking on the frame it wakes has
    // no velocity to predict from on the frame it first swings.
    trackPlayer(d);
    const seen = new Set();
    for (const inst of enemies.live) {
      if (inst.key !== "matriarch") continue;
      seen.add(inst.id);
      adopt(inst);
      stepInstance(inst, d);
    }
    // A dead or despawned animal's brain goes with it, or a long
    // session accumulates one per Matriarch the Abbess ever laid.
    for (const id of [...brains.keys()]) if (!seen.has(id)) brains.delete(id);
  }

  function instances() {
    return enemies.live.filter((inst) => inst.key === "matriarch");
  }

  /** What the fight is doing, for the HUD, the harnesses and QA.
   *
   *  WHICH ANIMAL, when there is more than one: the one that is
   *  actually fighting. There is normally a single Matriarch and the
   *  question does not arise, but the Abbess lays one at a third
   *  health, and a harness that spawns a probe copy gets a second the
   *  same way - and in both cases the Gilded Reach's own is still
   *  standing dormant behind its gate a kilometre away. Preferring it
   *  by district key made `status()` describe the sleeping one while
   *  the live one was mid-combo, which reads as the module doing
   *  nothing. Pass `only` to ask about a specific instance instead. */
  function status(only = null) {
    const live = instances();
    const inst = only
      || live.find((e) => !e.encounterHidden && !e.encounterLocked
        && e.state !== "death")
      || live.find((e) => e.districtBossKey === "reach")
      || live[0];
    if (!inst) return null;
    const brain = brains.get(inst.id);
    const ps = ctx.player.state;
    return {
      phase: inst.state === "death" ? "dead"
        : inst.encounterHidden ? "dormant"
          : inst.encounterLocked ? "alert"
            : brain?.act || "stalk",
      action: brain?.act || null,
      roused: !!brain?.roused,
      comboStep: brain?.step || 0,
      comboSteps: brain?.steps || 2,
      rearFor: Number((brain?.rearFor || 0).toFixed(2)),
      weakBonus: Number(inst.weakBonus || 1),
      tells: brain?.tells || 0,
      landed: brain?.landed || 0,
      whiffed: brain?.whiffed || 0,
      lastMiss: brain?.lastMiss || null,
      misses: { ...(brain?.misses || { range: 0, arc: 0, height: 0, sight: 0 }) },
      culls: brain?.culls || 0,
      lances: brain?.lances || 0,
      tremors: brain?.tremors || 0,
      tremorHits: brain?.tremorHits || 0,
      tremorClears: brain?.tremorClears || 0,
      activeWaves: brain?.waves?.length || 0,
      health: Math.max(0, Math.round(inst.health)),
      maxHealth: Math.round(inst.maxHealth),
      dist: Number(Math.hypot(ps.x - inst.x, ps.z - inst.z).toFixed(1)),
      x: Number(inst.x.toFixed(2)),
      z: Number(inst.z.toFixed(2)),
      dead: inst.state === "death",
    };
  }

  return {
    bus,
    config: C,
    update,
    status,
    instances,
    /** QA/harness reach-in: force the next decision. Nothing in the
     *  game calls these - a fight that can only be observed by
     *  waiting out an eight-second cadence is a fight nobody writes
     *  a check for. `only` picks the instance, for the same reason
     *  `status` takes one. */
    force(kind, only = null) {
      const inst = only || instances().find((e) => !e.encounterHidden
        && !e.encounterLocked && e.state !== "death") || instances()[0];
      if (!inst) return false;
      const brain = brainFor(inst);
      if (brain.act) cancel(inst, brain, false);
      if (kind === "combo") beginCombo(inst, brain);
      else if (kind === "lance") beginLance(inst, brain);
      else if (kind === "cull") beginCull(inst, brain);
      else if (kind === "tremor") beginTremor(inst, brain);
      else if (kind === "rouse") beginRouse(inst, brain);
      else return false;
      return true;
    },
  };
}
