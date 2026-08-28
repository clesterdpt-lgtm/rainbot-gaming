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
     GROUND. Outside `holdBand` it advances, inside it backs off,
     and in the band it circles. */
  holdBand: Object.freeze([5.6, 9.4]),

  /* HOW FAST: Fast, agile stalking and pursuit pace. */
  walkSpeed: 10.2,
  backSpeed: 4.2,
  strafeSpeed: 5.6,
  strafeFlipSeconds: 2.4,

  /* THE CHASE GEAR: Beyond the stand-off band it sprints at high velocity. */
  chaseSpeed: 14.5,
  chaseFrom: 12,
  chaseFull: 28,
  gaitCeiling: 15.5,
  holdAt: 6.3,
  bandGain: 1.6,

  /* Tracking rates and swing leading: tuned for direct charges and clean sidesteps */
  turnRate: 3.0,
  committedTurnRate: 0.55,
  leadLag: 0.65,
  leadMax: 7.0,
  lanceLead: 0.80,
  trackDamp: 18,
  trackCeiling: 34,

  arenaRadius: 84,

  /* ------------------------------------------------------------
     THE SCYTHE COMBO */
  comboReach: 6.6,
  comboWindup: 0.55,
  comboContact: 0.642,
  comboGap: 0.38,
  comboRecover: 0.40,
  comboDamage: 20,
  comboArc: 0.766,
  comboCadence: 2.0,

  /* ------------------------------------------------------------
     THE LANCE: Long-distance high-precision charge directly at the player. */
  lanceRange: Object.freeze([7.5, 95]),
  lanceCock: 0.78,
  lanceDash: 0.12,
  lanceDashMax: 1.65,
  lanceSpeed: 44,
  lanceDamage: 28,
  lanceReach: 6.8,
  lanceArc: 0.20,
  lanceCadence: 3.8,
  pursuitLanceCadence: 1.6,
  lanceTrack: 2.1,

  /* ------------------------------------------------------------
     THE CULL: Rear flank punishment whip. */
  cullRadius: 11.5,
  cullRearDot: -0.12,
  cullLoiter: 0.80,
  cullWindup: 0.40,
  cullSweep: 0.26,
  cullDamage: 18,
  cullReach: 7.5,
  cullSpin: 7.8,
  cullCadence: 3.4,

  /* ------------------------------------------------------------
     THE GRAB-SLAM: Close frontal punish. */
  grabReach: 5.6,
  grabArc: 0.32,
  grabAirClear: 1.8,
  grabWindup: 0.72,
  grabLift: 0.48,
  grabHold: 0.18,
  grabDrop: 0.28,
  grabRecover: 0.68,
  grabLiftHeight: 3.65,
  grabHoldForward: 3.7,
  grabSlamForward: 5.6,
  grabDamage: 55,
  grabSlamStun: 1.0,
  grabCadence: 7.0,

  /* ------------------------------------------------------------
     THE TREMOR RITE: Telegraphed ground shockwaves. */
  tremorEvery: 10.0,
  tremorEveryRoused: 7.0,
  tremorWindup: 1.30,
  tremorPulseGap: 0.60,
  tremorWaves: 3,
  tremorWavesRoused: 4,
  tremorRecover: 0.48,
  tremorRadius: 36,
  tremorSpeed: 21,
  tremorBand: 1.35,
  tremorDamage: 18,
  tremorAirClear: 0.40,
  tremorSlowFactor: 0.72,
  tremorSlowSeconds: 0.75,
  tremorWeakBonus: 1.25,

  /* ------------------------------------------------------------
     THE ROUSE */
  rouseAt: 0.45,
  rouseSeconds: 1.6,
  rouseRadius: 11,
  rouseDamage: 14,
  rouseSpeedScale: 1.2,
  rouseCadenceScale: 0.8,

  strikeCentre: 2.2,
  strikeHeight: 5.6,
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
      act: null,             // null | combo | lance | cull | grab | tremor | rouse
      actFor: 0,             // seconds left in the action as a whole
      pending: -1,           // seconds to the next contact, or -1
      step: 0,               // which scythe of the combo
      steps: 2,
      lockYaw: inst.yaw,
      comboTimer: C.comboCadence * 0.45,
      lanceTimer: C.lanceCadence * 0.5,
      cullTimer: C.cullCadence * 0.6,
      grabTimer: C.grabCadence * 0.55,
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
      grabs: 0,
      grabHits: 0,
      grabSlams: 0,
      grabbed: false,
      grabSlammed: false,
      grabOrigin: null,
      grabHoldPoint: null,
      grabTarget: null,
      playerCarryPose: false,
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

  function difficultyPaceScale() {
    return 1.0;
  }

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
    bus.emit("comboTell", {
      x: inst.x, z: inst.z, steps: brain.steps,
      impactIn: C.comboWindup, guardType: "frontal",
    });
  }

  function beginLance(inst, brain) {
    /* HOW FAR IT HAS DECIDED TO TRAVEL, fixed at the cock so the whole
       move has one duration that the tell, the contact and the
       interrupt window all agree on. Short of the player by half a
       reach, because it arrives swinging and should not finish the
       dash standing inside them. */
    let flight = C.lanceCock + C.lanceDash;
    const lanceV = C.lanceSpeed * difficultyPaceScale();
    for (let i = 0; i < 2; i += 1) {
      const travel = Math.max(0, reachIn(inst, flight) - C.lanceReach * 0.55);
      flight = C.lanceCock + Math.max(C.lanceDash,
        Math.min(C.lanceDashMax, travel / lanceV));
    }
    brain.dashFor = flight - C.lanceCock;
    brain.act = "lance";
    brain.actFor = C.lanceCock + brain.dashFor + C.comboRecover;
    brain.pending = C.lanceCock + brain.dashFor;
    brain.lockYaw = inst.yaw;
    const pursuit = bearing(inst, ctx.player.state.x, ctx.player.state.z).dist
      > C.tremorRadius;
    brain.lanceTimer = (pursuit ? C.pursuitLanceCadence : C.lanceCadence)
      * cadenceScale(brain);
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
    bus.emit("lanceTell", {
      x: inst.x, z: inst.z, impactIn: brain.pending, guardType: "frontal",
    });
  }

  function beginGrab(inst, brain) {
    brain.act = "grab";
    brain.actFor = C.grabWindup + C.grabLift + C.grabHold
      + C.grabDrop + C.grabRecover;
    brain.pending = C.grabWindup;
    brain.grabTimer = C.grabCadence * cadenceScale(brain);
    brain.grabbed = false;
    brain.grabSlammed = false;
    brain.grabOrigin = null;
    brain.grabHoldPoint = null;
    brain.grabTarget = null;
    brain.playerCarryPose = false;
    brain.grabs += 1;
    brain.tells += 1;
    inst.actionLocked = true;
    enemies.play?.(inst, "alert", 0.08);
    ctx.vfx?.slamCharge?.(inst.x + Math.sin(inst.yaw) * 3.2,
      groundAt(inst.x, inst.z) + 0.5, inst.z + Math.cos(inst.yaw) * 3.2, 3.8);
    ctx.audio?.slamCharge?.(inst.x, inst.z);
    bus.emit("grabTell", {
      x: inst.x, z: inst.z, impactIn: C.grabWindup, guardType: "unblockable",
    });
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
    bus.emit("cullTell", {
      x: inst.x, z: inst.z, impactIn: brain.pending, guardType: "frontal",
    });
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
      roused: brain.roused, impactIn: C.tremorWindup, guardType: "unblockable" });
  }

  function beginRouse(inst, brain) {
    brain.roused = true;
    brain.act = "rouse";
    brain.actFor = C.rouseSeconds;
    brain.pending = C.rouseSeconds * 0.42;
    inst.actionLocked = true;
    enemies.play?.(inst, "alert", 0.12);
    bus.emit("rouse", {
      x: inst.x, z: inst.z, impactIn: brain.pending, guardType: "unblockable",
    });
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
    const dx = ps.x - inst.x;
    const dz = ps.z - inst.z;
    const fx = Math.sin(inst.yaw);
    const fz = Math.cos(inst.yaw);
    const rx = fz;
    const rz = -fx;

    const along = dx * fx + dz * fz;
    const across = Math.abs(dx * rx + dz * rz);
    const dist = Math.hypot(dx, dz);

    if (source === "lance") {
      // Narrow charge box: direct frontal head impact
      if (along < 1.8 || along > (reach || C.lanceReach)) return miss(brain, "range");
      if (across > 2.0) return miss(brain, "arc");
    } else if (source === "combo") {
      // Frontal scythe sweep
      if (along < 1.2 || along > (reach || C.comboReach)) return miss(brain, "range");
      if (across > 2.8) return miss(brain, "arc");
    } else if (source === "cull") {
      // Rear whip sweep
      if (dist > (reach || C.cullReach)) return miss(brain, "range");
    } else {
      if (dist > reach) return miss(brain, "range");
      const dot = dist > 1e-4 ? along / dist : 1;
      if (dot < arc) return miss(brain, "arc");
    }

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
      originX: inst.x, originY: inst.y + C.strikeCentre, originZ: inst.z,
      guardType: "frontal",
    });
    brain.landed += 1;
    brain.lastMiss = null;
    ctx.player?.punch?.(1.35);
    ctx.player?.doctrineKick?.(0.85, 0.8);
    bus.emit(source, { x: ps.x, z: ps.z, damage });
    return true;
  }

  function tryGrab(inst, brain) {
    if (!ctx.combat || ctx.combat.player.dead) return false;
    const ps = ctx.player.state;
    const dx = ps.x - inst.x;
    const dz = ps.z - inst.z;
    const fx = Math.sin(inst.yaw);
    const fz = Math.cos(inst.yaw);
    const rx = fz;
    const rz = -fx;

    const along = dx * fx + dz * fz;
    const across = Math.abs(dx * rx + dz * rz);
    const dist = Math.hypot(dx, dz);

    if (along < 1.8 || along > C.grabReach) return miss(brain, "range");
    if (across > 1.6) return miss(brain, "arc");
    if (ps.y - groundAt(ps.x, ps.z) > C.grabAirClear) return miss(brain, "height");
    const inv = 1 / (dist || 1);
    if (ctx.collide?.rayBlock
      && ctx.collide.rayBlock(inst.x, inst.y + 2.5, inst.z,
        dx * inv, 0, dz * inv, dist) < dist - 0.2) return miss(brain, "sight");

    const holdX = inst.x + fx * C.grabHoldForward;
    const holdZ = inst.z + fz * C.grabHoldForward;
    const wantedX = inst.x + fx * C.grabSlamForward;
    const wantedZ = inst.z + fz * C.grabSlamForward;
    const wantedY = groundAt(wantedX, wantedZ);
    const radius = ctx.collide?.radius || 0.48;
    const open = ctx.collide?.findOpen?.(wantedX, wantedZ, wantedY,
      14, 3.0, radius);
    const targetX = open?.[0] ?? wantedX;
    const targetZ = open?.[1] ?? wantedZ;

    brain.grabbed = true;
    brain.grabHits += 1;
    brain.grabOrigin = { x: ps.x, y: ps.y, z: ps.z };
    brain.grabHoldPoint = {
      x: holdX,
      y: Math.max(inst.y + 3.2, groundAt(holdX, holdZ) + C.grabLiftHeight),
      z: holdZ,
    };
    brain.grabTarget = { x: targetX, y: groundAt(targetX, targetZ), z: targetZ };
    ctx.boost?.stop?.("matriarch-grab");
    ctx.slam?.abort?.("matriarch-grab");
    ctx.jetpack?.land?.(ps, 0);
    ctx.player?.applyStun?.(brain.actFor + C.grabSlamStun);
    /* The ordinary death timeline is purely a figure pose until
       `state.dying` is set. Sampling it here gives the caught trooper a
       progressive knees-give/topple silhouette instead of leaving them
       standing rigidly in mid-air; releaseGrab clears it before control
       returns, unless the slam actually killed them. */
    brain.playerCarryPose = !!ctx.player?.beginAction?.("death");
    ps.grounded = false;
    ps.vy = 0;
    ps.speed = 0;
    enemies.replay?.(inst, "strike", 0.06, C.comboContact,
      C.grabLift + C.grabHold + C.grabDrop);
    bus.emit("grab", { x: ps.x, y: ps.y, z: ps.z });
    return true;
  }

  function pinGrabbedPlayer(point) {
    if (!point) return;
    const ps = ctx.player.state;
    ps.x = point.x;
    ps.y = point.y;
    ps.z = point.z;
    ps.vy = 0;
    ps.speed = 0;
    ps.travelSpeed = 0;
    ps.grounded = false;
  }

  function slamGrab(inst, brain) {
    if (!brain.grabbed || brain.grabSlammed || !brain.grabTarget) return;
    const ps = ctx.player.state;
    const target = brain.grabTarget;
    ps.x = target.x;
    ps.y = target.y;
    ps.z = target.z;
    ps.vy = 0;
    ps.speed = 0;
    ps.travelSpeed = 0;
    ps.grounded = true;
    brain.grabbed = false;
    brain.grabSlammed = true;
    brain.grabSlams += 1;
    ctx.combat?.hurtPlayer?.(C.grabDamage * SURVIVAL_CONFIG.enemyDamageMultiplier, {
      source: "matriarch-grab-slam", enemyId: inst.id, enemyKey: inst.key,
      x: ps.x, y: ps.y + 1, z: ps.z,
      guardType: "unblockable",
    });
    ctx.player?.applyStun?.(C.grabSlamStun);
    ctx.player?.punch?.(2.0);
    ctx.player?.doctrineKick?.(1.25, 1.0);
    ctx.vfx?.slamImpact?.(ps.x, ps.y, ps.z, 1.8);
    ctx.vfx?.blast?.(ps.x, ps.y + 0.2, ps.z, 7.5);
    ctx.vfx?.sandSpray?.(ps.x, ps.y + 0.1, ps.z, 2.7, 0, 1);
    ctx.audio?.slamImpact?.(ps.x, ps.z, 1.35);
    bus.emit("grabSlam", { x: ps.x, y: ps.y, z: ps.z, damage: C.grabDamage });
  }

  function releaseGrab(inst, brain) {
    if (brain.grabbed) {
      const ps = ctx.player.state;
      const point = brain.grabTarget || brain.grabOrigin;
      if (point) {
        ps.x = point.x;
        ps.z = point.z;
        ps.y = groundAt(point.x, point.z);
      }
      ps.vy = 0;
      ps.grounded = true;
      brain.grabbed = false;
    }
    brain.grabOrigin = null;
    brain.grabHoldPoint = null;
    brain.grabTarget = null;
    if (brain.playerCarryPose && !ctx.player?.state?.dying) {
      ctx.player?.cancelTransientActions?.();
    }
    brain.playerCarryPose = false;
    if (inst.root) {
      inst.root.rotation.x = 0;
      inst.root.rotation.z = 0;
    }
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
        bus.emit("comboTell", {
          x: inst.x, z: inst.z, steps: brain.steps, step: brain.step + 1,
          impactIn: C.comboGap, guardType: "frontal",
        });
      }
      return;
    }
    if (brain.act === "grab") {
      if (!tryGrab(inst, brain)) brain.whiffed += 1;
      brain.pending = -1;
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
          guardType: "unblockable",
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
              guardType: "unblockable",
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

    if (brain.act === "grab") {
      const total = C.grabWindup + C.grabLift + C.grabHold
        + C.grabDrop + C.grabRecover;
      const elapsed = total - brain.actFor;
      if (elapsed < C.grabWindup) {
        const t = Math.max(0, Math.min(1, elapsed / C.grabWindup));
        inst.root.rotation.x = -0.17 * t * t * (3 - 2 * t);
        faceTowards(inst, ps.x, ps.z, C.committedTurnRate, dt);
      } else if (brain.grabbed) {
        const heldFor = elapsed - C.grabWindup;
        if (heldFor < C.grabLift) {
          const t = Math.max(0, Math.min(1, heldFor / C.grabLift));
          const u = t * t * (3 - 2 * t);
          const a = brain.grabOrigin;
          const b = brain.grabHoldPoint;
          pinGrabbedPlayer({
            x: a.x + (b.x - a.x) * u,
            y: a.y + (b.y - a.y) * u,
            z: a.z + (b.z - a.z) * u,
          });
          inst.root.rotation.x = -0.17 + 0.39 * u;
        } else if (heldFor < C.grabLift + C.grabHold) {
          pinGrabbedPlayer(brain.grabHoldPoint);
          inst.root.rotation.x = 0.22;
        } else {
          const t = Math.max(0, Math.min(1,
            (heldFor - C.grabLift - C.grabHold) / C.grabDrop));
          const u = t * t;
          const a = brain.grabHoldPoint;
          const b = brain.grabTarget;
          pinGrabbedPlayer({
            x: a.x + (b.x - a.x) * u,
            y: a.y + (b.y - a.y) * u,
            z: a.z + (b.z - a.z) * u,
          });
          inst.root.rotation.x = 0.22 - 0.54 * u;
          if (t >= 0.88) slamGrab(inst, brain);
        }
      } else {
        inst.root.rotation.x += (0 - inst.root.rotation.x) * Math.min(1, dt * 9);
      }
    } else if (brain.act === "cull") {
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
        const lanceV = C.lanceSpeed * difficultyPaceScale();
        moveBody(inst, brain, Math.sin(brain.lockYaw) * lanceV,
          Math.cos(brain.lockYaw) * lanceV, dt);
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
      if (brain.act === "grab") releaseGrab(inst, brain);
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
    if (armouredCheck && brain.act === "grab" && brain.grabbed) return false;
    /* Once the first seismic front has left the body the chain is
       committed. Before that, the first half of the long plant can be
       interrupted on the same contract as every other tell. */
    if (armouredCheck && brain.act === "tremor" && brain.step > 0) return false;
    if (armouredCheck && brain.pending > 0) {
      const total = brain.act === "combo" ? C.comboWindup
        : brain.act === "lance" ? C.lanceCock + brain.dashFor
          : brain.act === "cull" ? C.cullWindup + C.cullSweep * 0.5
            : brain.act === "grab" ? C.grabWindup
              : brain.act === "tremor" ? C.tremorWindup
            : brain.pending;
      if (brain.pending < total * C.interruptWindow) return false;
    }
    if (brain.act === "grab") releaseGrab(inst, brain);
    brain.act = null;
    brain.actFor = 0;
    brain.pending = -1;
    brain.spin = 0;
    inst.actionLocked = false;
    inst.weakBonus = 1;
    return true;
  }

  function chooseAction(inst, brain, dist, dot, sees) {
    /* Outside the seismic AOE there are no stationary attacks and no
       flank games: charge when ready, otherwise keep running inward. */
    if (dist > C.tremorRadius) {
      if (brain.lanceTimer <= 0 && sees) return beginLance(inst, brain);
      return null;
    }
    /* Order is priority, and the first entry is the point of the
       fight: everything else waits while the player is somewhere the
       gaster is not defended. */
    if (brain.cullTimer <= 0 && dist < C.cullRadius && dot < C.cullRearDot
      && brain.rearFor >= C.cullLoiter) return beginCull(inst, brain);
    if (brain.grabTimer <= 0 && sees && dot > C.grabArc
      && reachIn(inst, C.grabWindup) <= C.grabReach) return beginGrab(inst, brain);
    if (brain.tremorTimer <= 0 && sees && dist <= C.tremorRadius) {
      return beginTremor(inst, brain);
    }
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
    const paceScale = difficultyPaceScale();
    return Math.min(base * (brain.roused ? C.rouseSpeedScale : 1) * paceScale, C.gaitCeiling * paceScale);
  }

  function stepStalk(inst, brain, dt, dist) {
    const ps = ctx.player.state;
    faceTowards(inst, ps.x, ps.z, C.turnRate, dt);
    const scale = (brain.roused ? C.rouseSpeedScale : 1) * difficultyPaceScale();
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
      if (brain.grabbed || brain.act === "grab") releaseGrab(inst, brain);
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
      brain.grabTimer = C.grabCadence * 0.55;
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
    brain.grabTimer -= dt;
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
      grabs: brain?.grabs || 0,
      grabHits: brain?.grabHits || 0,
      grabSlams: brain?.grabSlams || 0,
      grabbed: !!brain?.grabbed,
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
      else if (kind === "grab") beginGrab(inst, brain);
      else if (kind === "tremor") beginTremor(inst, brain);
      else if (kind === "rouse") beginRouse(inst, brain);
      else return false;
      return true;
    },
    brainFor,
    tryLand,
  };
}
