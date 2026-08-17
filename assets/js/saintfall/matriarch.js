/* ============================================================
   SAINTFALL - the Matriarch

   The Gilded Reach's guardian, and everything about the fight that is
   not geometry: how it holds ground, what it does with the scythes,
   what it does when you get behind it, and what laying costs it.

   WHY THIS IS ITS OWN MODULE

   It was the last district boss still being driven entirely by
   `combat.stepEnemy`, which is the generic walker brain: close to
   reach, bite on a cadence, and - uniquely for this key - stop every
   fourteen seconds and lay. Four numbers and one timer. Against a
   3600-health pool that produced a fight with exactly one decision in
   it, taken once: walk round the back, then hold the trigger. The
   animal never answered the flank, never covered the ground it lost,
   and never did anything a Harrow does not do, so the only thing its
   size changed was how long the same thirty seconds lasted.

   The parts of the encounter that were already right are kept and
   built on rather than replaced. The gaster is still the weak point;
   it is still on the far side of nine metres of hostile animal; the
   brood is still the clock that says stop shooting the armour. What
   this module adds is an OPPONENT for those rules.

   THE LOOP

     STALK      It holds a band rather than a point: outside it,
                closes; inside it, gives ground. Facing you the whole
                time, because facing you is what keeps the gaster
                away from you.
     COMBO      In reach, the fold opens: two scythes on separate
                beats, each its own tell, each dodgeable on its own.
                Three in the second phase.
     LANCE      The answer to being plinked from twenty metres. It
                cocks - arms drawn tight, body reared, a full second
                of it - and then covers the gap in a third of that
                and arrives swinging.
     CULL       THE FLANK, ANSWERED. Loiter in its rear arc inside ten
                metres and it whips round, dragging the gaster through
                the ground behind it. This is the move the whole
                encounter is built around: it does not stop you
                getting behind, it puts a clock on staying there.
     BROOD      Unchanged in what it spawns (see `combat.brood`) and
                inverted in what it means. It plants, the ovipositor
                goes down, and for those seconds the gaster is held
                still and low and is worth HALF AGAIN what it is worth
                at any other time. The boss's own cadence now tells
                the player when to take the risk.

   And below 45% it rouses: faster, a third scythe on the combo, and
   a brood clock two-thirds as long.

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
  holdBand: Object.freeze([6.2, 11.5]),
  walkSpeed: 2.55,
  backSpeed: 1.45,
  strafeSpeed: 1.60,
  strafeFlipSeconds: 3.2,
  /* Free, and while committed to a tell. The committed rate is what
     decides whether a sidestep beats a scythe, and it is the same
     0.6 rad/s the ordinary castes were tuned to in the melee pass -
     see ENEMY_MELEE_CONFIG.windupTurnRate. A boss that tracks harder
     than its own bestiary makes the dodge the player just learned
     stop working, which reads as the boss cheating. */
  turnRate: 1.55,
  committedTurnRate: 0.6,

  /* Its territory, measured from where districtBosses parked it. Well
     inside that controller's 102m arena ring on purpose: a module leash
     that can fire outside the ring it is nested in never fires at all,
     which is how the Garner's disengage sat dead for a milestone. */
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
  comboWindup: 0.58,
  comboContact: 0.642,          // measured, matches the authored clip
  comboGap: 0.46,               // between one scythe and the next
  comboRecover: 0.75,
  comboDamage: 30,
  /* +-40 degrees at the contact frame. Wider and no lateral dodge
     ever succeeds against a nine-metre turning circle; narrower and
     the boss misses a stationary target on the second beat because
     its own committed turn cannot keep up with the first one's
     knock. */
  comboArc: 0.766,
  comboCadence: 3.2,

  /* ------------------------------------------------------------
     THE LANCE. A gap-closer, and the only reason standing at twenty
     metres is not a strategy. It is a long tell on purpose - almost a
     full second of a reared, cocked animal - because what follows is
     unavoidable once it starts, and an unavoidable move has to be
     answerable before it does. */
  lanceRange: Object.freeze([10.5, 23]),
  lanceCock: 0.95,
  lanceDash: 0.40,
  lanceSpeed: 27,
  lanceDamage: 44,
  lanceReach: 8.6,              // it arrives swinging, so slightly long
  lanceCadence: 8.5,
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
  cullRadius: 10.5,
  cullRearDot: -0.12,           // "behind" is anything past ~97 degrees
  cullLoiter: 1.6,
  cullWindup: 0.52,
  cullSweep: 0.34,
  cullDamage: 24,
  cullReach: 9.4,
  cullSpin: 5.6,                // rad/s through the sweep - the whip
  cullCadence: 6.0,

  /* ------------------------------------------------------------
     BROODING, and the window it opens. `broodEvery` is the Bloom's
     own fourteen seconds, unchanged; what is new is that laying
     PRESENTS the weak point - the ovipositor is down, the animal is
     planted, and the sacs are held still and low. Worth half again
     for that window, which is what turns the brood timer from a
     nuisance into an invitation. */
  broodEvery: 14,
  broodEveryRoused: 9.5,
  broodPlant: 1.9,              // planted, from the tell to the clutch
  broodHold: 1.1,               // and held after it, gaster presented
  broodWeakBonus: 1.5,

  /* ------------------------------------------------------------
     THE ROUSE. One beat, once, at 45% - and the only phase change in
     the fight. A boss with four phases on one health bar is four
     fights nobody finished; this is the same fight with the safety
     off. */
  rouseAt: 0.45,
  rouseSeconds: 1.7,
  rouseRadius: 11,
  rouseDamage: 18,
  rouseSpeedScale: 1.22,
  rouseCadenceScale: 0.76,

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
      act: null,             // null | combo | lance | cull | brood | rouse
      actFor: 0,             // seconds left in the action as a whole
      pending: -1,           // seconds to the next contact, or -1
      step: 0,               // which scythe of the combo
      steps: 2,
      lockYaw: inst.yaw,
      comboTimer: C.comboCadence * 0.45,
      lanceTimer: C.lanceCadence * 0.5,
      cullTimer: C.cullCadence * 0.6,
      broodTimer: C.broodEvery * 0.55,
      rearFor: 0,
      strafeDir: 1,
      strafeFor: C.strafeFlipSeconds,
      roused: false,
      spin: 0,               // the cull's whip, rad/s
      tells: 0,
      landed: 0,
      whiffed: 0,
      culls: 0,
      lances: 0,
      clutches: 0,
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
    brain.act = "lance";
    brain.actFor = C.lanceCock + C.lanceDash + C.comboRecover;
    brain.pending = C.lanceCock + C.lanceDash;
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

  function beginBrood(inst, brain) {
    brain.act = "brood";
    brain.actFor = C.broodPlant + C.broodHold;
    brain.pending = C.broodPlant;
    brain.broodTimer = (brain.roused ? C.broodEveryRoused : C.broodEvery)
      * cadenceScale(brain);
    inst.actionLocked = true;
    /* THE WINDOW. Presented from the tell rather than from the clutch,
       so the reward starts when the animal commits and not when the
       player has already had to decide. */
    inst.weakBonus = C.broodWeakBonus;
    enemies.play?.(inst, "brood", 0.16);
    bus.emit("broodTell", { x: inst.x, z: inst.z });
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

  function tryLand(inst, brain, reach, arc, damage, source) {
    const combat = ctx.combat;
    if (!combat || combat.player.dead) return false;
    const ps = ctx.player.state;
    const { dist, dot, dx, dz } = bearing(inst, ps.x, ps.z);
    if (dist > reach) return false;
    if (dot < arc) return false;
    // A capsule ten metres overhead is not in reach of a ground
    // animal, whatever the plan view says.
    if (Math.abs(ps.y - (inst.y + 1.2)) > 3.4) return false;
    const inv = 1 / (dist || 1);
    if (ctx.collide?.rayBlock
      && ctx.collide.rayBlock(inst.x, inst.y + 2.2, inst.z,
        dx * inv, 0, dz * inv, dist) < dist - 0.2) return false;
    combat.hurtPlayer(damage * SURVIVAL_CONFIG.enemyDamageMultiplier, {
      source: "enemy-melee",
      enemyId: inst.id,
      enemyKey: inst.key,
      x: ps.x, y: ps.y + 1.0, z: ps.z,
    });
    brain.landed += 1;
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
      const hit = tryLand(inst, brain, C.lanceReach, C.comboArc,
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
    if (brain.act === "brood") {
      ctx.combat?.brood?.(inst);
      brain.clutches += 1;
      ctx.vfx?.sandSpray?.(inst.x - Math.sin(inst.yaw) * 5.5, y,
        inst.z - Math.cos(inst.yaw) * 5.5, 2.2);
      brain.pending = -1;
      bus.emit("brood", { x: inst.x, z: inst.z });
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
      const dashing = brain.actFor <= C.lanceDash + C.comboRecover
        && brain.actFor > C.comboRecover;
      if (dashing) {
        moveBody(inst, brain, Math.sin(brain.lockYaw) * C.lanceSpeed,
          Math.cos(brain.lockYaw) * C.lanceSpeed, dt);
        ctx.vfx?.slamTrail?.(inst.x, groundAt(inst.x, inst.z) + 0.3, inst.z);
      } else if (brain.actFor > C.lanceDash + C.comboRecover) {
        // Still cocking: it stands still and re-aims - see lanceTrack
        // for why this one move is allowed to follow a strafe.
        faceTowards(inst, ps.x, ps.z, C.lanceTrack, dt);
        brain.lockYaw = inst.yaw;
      }
    } else if (brain.act === "brood") {
      // Planted. It does not even turn - that is what makes the
      // window a window.
    } else if (brain.act !== "rouse") {
      faceTowards(inst, ps.x, ps.z, C.committedTurnRate, dt);
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
    if (armouredCheck && brain.pending > 0) {
      const total = brain.act === "combo" ? C.comboWindup
        : brain.act === "lance" ? C.lanceCock + C.lanceDash
          : brain.act === "cull" ? C.cullWindup + C.cullSweep * 0.5
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
    if (brain.broodTimer <= 0 && sees) return beginBrood(inst, brain);
    if (brain.comboTimer <= 0 && dist <= C.comboReach && sees
      && dot > C.comboArc * 0.6) return beginCombo(inst, brain);
    if (brain.lanceTimer <= 0 && sees
      && dist >= C.lanceRange[0] && dist <= C.lanceRange[1]) return beginLance(inst, brain);
    return null;
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
      moveBody(inst, brain, ux * C.walkSpeed * scale, uz * C.walkSpeed * scale, dt);
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
    const side = brain.strafeDir;
    moveBody(inst, brain, -uz * side * C.strafeSpeed * scale,
      ux * side * C.strafeSpeed * scale, dt);
    if (inst.state !== "alert") enemies.play?.(inst, "alert", 0.24);
  }

  function stepInstance(inst, dt) {
    const brain = brainFor(inst);

    if (inst.state === "death" || inst.health <= 0) {
      inst.actionLocked = false;
      inst.weakBonus = 1;
      return;
    }
    /* Gated actors do not perceive, move or attack. districtBosses
       owns this gate for the Gilded Reach - dormant until its arena is
       entered, then a locked reveal beat - and this module must not
       start a fight the encounter controller has not started. */
    if (inst.encounterHidden || inst.encounterLocked) {
      if (brain.act) cancel(inst, brain, false);
      return;
    }
    /* An arena reset teleports the animal home at full health with no
       message to anyone. Health going back UP is the only reliable
       sign of it from in here, and a brain left mid-combo would
       resolve a scythe against a player two hundred metres away. */
    if (inst.health > brain.lastHealth + 1) {
      cancel(inst, brain, false);
      brain.roused = false;
      brain.broodTimer = C.broodEvery * 0.55;
    }
    brain.lastHealth = inst.health;

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
    if (sees) brain.broodTimer -= dt;

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
      culls: brain?.culls || 0,
      lances: brain?.lances || 0,
      clutches: brain?.clutches || 0,
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
      else if (kind === "brood") beginBrood(inst, brain);
      else if (kind === "rouse") beginRouse(inst, brain);
      else return false;
      return true;
    },
  };
}
