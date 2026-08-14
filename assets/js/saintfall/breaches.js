/* ============================================================
   SAINTFALL - Bloom breach progression

   A breach is a compulsory field event that follows the player.
   Each stage telegraphs a rupture, raises a deliberately authored
   caste mix, and waits for every member to die before it advances.
   Waves are intermittent pressure between the six district hunts. Bosses
   live permanently in their own arenas now, so the roaming cycle contains
   only field castes and rebuilds after a long recovery window.
   ============================================================ */

import { TAU, clamp, makeBus, makeRng } from "saintfall/core.js";
import { BESTIARY } from "saintfall/enemies.js";
import { APOSTATE_CONFIG } from "saintfall/apostate.js";
import { DISTRICT_BOSS_SITES } from "saintfall/district-bosses.js";

export const BREACH_CONFIG = Object.freeze({
  firstWarningAfter: 180,
  warningSeconds: 3.4,
  intermissionSeconds: 60,
  cycleCooldownSeconds: 180,
  spawnDistanceMin: 38,
  spawnDistanceMax: 54,
  eventRadius: 110,
  retreatGraceSeconds: 4,
  recoverySeconds: 60,
  bossArenaPadding: 18,
  staggerSeconds: 0.14,
});

export const BREACH_WAVES = Object.freeze([
  Object.freeze({
    name: "First Stirring",
    subtitle: "Skitter caste",
    healthScale: 0.82,
    damageScale: 0.72,
    clusters: 1,
    roster: Object.freeze([{ key: "thresher", count: 4 }]),
  }),
  Object.freeze({
    name: "Needle Brood",
    subtitle: "Ranged caste detected",
    healthScale: 0.92,
    damageScale: 0.82,
    clusters: 2,
    roster: Object.freeze([
      { key: "thresher", count: 6 },
      { key: "gleaner", count: 1 },
    ]),
  }),
  Object.freeze({
    name: "Breaker Brood",
    subtitle: "Heavy caste detected",
    healthScale: 1,
    damageScale: 0.92,
    clusters: 2,
    roster: Object.freeze([
      { key: "thresher", count: 7 },
      { key: "gleaner", count: 2 },
      { key: "harrow", count: 1 },
    ]),
  }),
  Object.freeze({
    name: "Crowned Surge",
    subtitle: "Full brood pressure",
    healthScale: 1.06,
    damageScale: 1,
    clusters: 3,
    roster: Object.freeze([
      { key: "thresher", count: 9 },
      { key: "gleaner", count: 3 },
      { key: "harrow", count: 2 },
    ]),
  }),
  Object.freeze({
    name: "Raptor Front",
    subtitle: "Fast caste pressure",
    healthScale: 1.02,
    damageScale: 0.96,
    clusters: 2,
    roster: Object.freeze([
      { key: "thresher", count: 8 },
      { key: "gleaner", count: 2 },
      { key: "harrow", count: 2 },
    ]),
  }),
  Object.freeze({
    name: "Last Pressure",
    subtitle: "Brood front at full strength",
    healthScale: 1.06,
    damageScale: 1,
    clusters: 3,
    roster: Object.freeze([
      { key: "thresher", count: 10 },
      { key: "gleaner", count: 3 },
      { key: "harrow", count: 2 },
    ]),
  }),
]);

/* Which keys can hold a boss bar. A set rather than a string compare
   against "matriarch", which is what the whole file used to do in four
   places - and each of those was a place a second boss would have been
   silently demoted to an ordinary member of its own wave. */
/* Legacy field saves can contain either former wave boss. New cycles never
   spawn them, but retaining their identities lets an in-progress schema-2
   fight finish cleanly instead of invalidating the save. */
const BOSS_KEYS = new Set(["matriarch", "coulter"]);

/* The field order each boss gets. Named rather than generic, because
   "SLAY THE MATRIARCH" is the line that tells a player the thing on the
   ridge is the thing they are here for - and the Coulter's names what
   the fight actually asks, which is not killing it but finding it. */
const BOSS_ORDERS = Object.freeze({});

const EMERGENCE = Object.freeze({
  thresher: Object.freeze({ depth: 1.35, duration: 1.18 }),
  gleaner: Object.freeze({ depth: 3.15, duration: 1.72 }),
  harrow: Object.freeze({ depth: 2.75, duration: 1.88 }),
});

const isLiving = (inst) => !!inst && inst.state !== "death" && inst.health > 0;

export function buildBreaches(ctx) {
  const { enemies, collide, combat } = ctx;
  const bus = makeBus();
  const rng = makeRng((ctx.seed ^ 0xb10f0) >>> 0 || 17);
  const members = [];
  const buriedRoster = [];
  let eventSerial = 0;

  const state = {
    phase: "dormant",       // dormant -> warning -> active -> intermission -> complete -> warning
    waveIndex: -1,
    waveCount: BREACH_WAVES.length,
    cycle: 1,
    cyclesCleared: 0,
    name: "Bloom pressure",
    subtitle: "Signal quiet",
    timer: BREACH_CONFIG.firstWarningAfter,
    x: 0,
    z: 0,
    total: 0,
    remaining: 0,
    complete: false,
    boss: null,
    serial: 0,
    auto: !ctx.qa,
    recovering: false,
    retreatFor: 0,
    recoveries: 0,
    blockedByBoss: null,
  };

  /** Undefeated district bosses own their arenas. A roaming Bloom wave
   *  can wait outside, but it cannot turn a boss introduction into an
   *  accidental two-encounter pile-up. The padding catches the arena
   *  threshold before a pursuing creature crosses it behind the player. */
  function protectedBossAreaAt(x, z) {
    for (const site of DISTRICT_BOSS_SITES) {
      const missionBoss = ctx.mission?.bosses?.find((boss) => boss.key === site.key);
      const runtime = site.key === "scar" ? ctx.distaff?.status?.()
        : site.key === "censer" ? ctx.winnower?.status?.()
          : ctx.districtBosses?.status?.(site.key);
      if (missionBoss?.done || runtime?.dead || runtime?.defeated || runtime?.phase === "dead") continue;
      const radius = site.arenaRadius + BREACH_CONFIG.bossArenaPadding;
      if (Math.hypot(x - site.x, z - site.z) <= radius) {
        return { key: site.key, name: site.district };
      }
    }

    const apostateDead = ctx.apostate?.status?.()?.defeated === true;
    const apostateRadius = APOSTATE_CONFIG.arenaRadius + BREACH_CONFIG.bossArenaPadding;
    if (!apostateDead && Math.hypot(x - APOSTATE_CONFIG.arenaX,
      z - APOSTATE_CONFIG.arenaZ) <= apostateRadius) {
      return { key: "apostate", name: "Vault-Cathedral" };
    }
    return null;
  }

  function currentBossArea() {
    const ps = ctx.player.state;
    const area = protectedBossAreaAt(ps.x, ps.z);
    state.blockedByBoss = area?.key || null;
    return area;
  }

  function expandRoster(wave) {
    const roster = [];
    for (const entry of wave.roster) {
      for (let i = 0; i < entry.count; i += 1) roster.push(entry.key);
    }
    // The boss owns the centre and rises first. The remaining castes
    // alternate instead of surfacing as a row of identical copies.
    if (wave.boss) {
      const boss = wave.bossKey;
      return roster.sort((a, b) => (a === boss ? -1 : b === boss ? 1 : 0));
    }
    const arranged = [];
    while (roster.length) {
      const last = arranged[arranged.length - 1];
      let pick = roster.findIndex((key) => key !== last);
      if (pick < 0) pick = 0;
      arranged.push(roster.splice(pick, 1)[0]);
    }
    return arranged;
  }

  function flattenCentre(x, z, boss = false) {
    const footprint = boss ? 6.4 : 3.4;
    let best = { x, z, score: Infinity };
    const bearings = 12;
    const rings = boss ? [0, 7, 14, 21, 28] : [0, 6, 12, 18];
    for (const distance of rings) {
      for (let i = 0; i < (distance ? bearings : 1); i += 1) {
        const angle = (i / bearings) * TAU + distance * 0.071;
        let cx = clamp(x + Math.cos(angle) * distance, -955, 955);
        let cz = clamp(z + Math.sin(angle) * distance, -955, 955);
        const open = collide.findOpen(cx, cz, collide.groundHeight(cx, cz), 18, 7,
          boss ? 2.5 : 1.4);
        if (!open) continue;
        cx = open[0]; cz = open[1];
        let lo = collide.groundHeight(cx, cz);
        let hi = lo;
        for (let b = 0; b < 8; b += 1) {
          const a = (b / 8) * TAU;
          const y = collide.groundHeight(
            cx + Math.cos(a) * footprint,
            cz + Math.sin(a) * footprint
          );
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
        const score = (hi - lo) + distance * 0.006;
        if (score < best.score) best = { x: cx, z: cz, score };
      }
    }
    return best;
  }

  function chooseCentre(options = {}, wave = null) {
    const ps = ctx.player.state;
    if (Number.isFinite(options.x) && Number.isFinite(options.z)) {
      return { x: options.x, z: options.z };
    }
    // Usually forward, sometimes on a flank. If that direction would
    // rupture inside protected boss ground, walk the candidate around
    // the player until the event has an arena of its own.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const distance = BREACH_CONFIG.spawnDistanceMin
        + rng() * (BREACH_CONFIG.spawnDistanceMax - BREACH_CONFIG.spawnDistanceMin);
      const angle = ps.camYaw + (rng() - 0.5) * 1.55 + attempt * 2.3999632297;
      const x = clamp(ps.x + Math.sin(angle) * distance, -955, 955);
      const z = clamp(ps.z + Math.cos(angle) * distance, -955, 955);
      const centre = flattenCentre(x, z, !!wave?.boss);
      if (!protectedBossAreaAt(centre.x, centre.z)) return centre;
    }
    return null;
  }

  function spawnPoint(index, total, clusters, key, centre) {
    const cluster = index % Math.max(1, clusters);
    const clusterAngle = (cluster / Math.max(1, clusters)) * TAU + 0.46;
    const clusterRadius = clusters > 1 ? 7.5 : 0;
    const localAngle = index * 2.3999632297 + clusterAngle * 0.37;
    // A boss owns the centre of its own event; everything else is
    // fanned out around it.
    const localRadius = BOSS_KEYS.has(key) ? 0 : 2.8 + Math.sqrt(index + 0.4) * 2.35;
    let x = centre.x + Math.cos(clusterAngle) * clusterRadius + Math.cos(localAngle) * localRadius;
    let z = centre.z + Math.sin(clusterAngle) * clusterRadius + Math.sin(localAngle) * localRadius;
    const radius = BESTIARY[key]?.collisionRadius || 0.7;
    const open = collide.findOpen(x, z, collide.groundHeight(x, z), 28, 10, radius);
    if (open) { x = open[0]; z = open[1]; }
    void total;
    return { x, z };
  }

  function refreshCounts() {
    let remaining = 0;
    let boss = null;
    for (const inst of members) {
      if (!enemies.live.includes(inst) || !isLiving(inst)) continue;
      remaining += 1;
      if (BOSS_KEYS.has(inst.key)) boss = inst;
    }
    state.remaining = remaining;
    state.boss = boss;
    return remaining;
  }

  function rosterRecord(inst) {
    return {
      key: inst.key,
      health: Math.max(1, Number(inst.health) || 1),
      maxHealth: Math.max(1, Number(inst.maxHealth) || Number(inst.health) || 1),
      damageScale: Number.isFinite(inst.damageScale) ? inst.damageScale : 1,
    };
  }

  /** Pull a pursuing wave out of the simulation while the player gets
   *  breathing room. Remaining health is retained; this is a respite,
   *  not a free heal or a silently discarded encounter. */
  function submergeWave(reason = "distance") {
    if (state.phase !== "warning" && state.phase !== "active") return false;
    buriedRoster.length = 0;
    const remove = new Set();
    for (const inst of members) {
      if (!enemies.live.includes(inst) || !isLiving(inst)) continue;
      buriedRoster.push(rosterRecord(inst));
      remove.add(inst);
      for (const kid of inst.broodKids || []) {
        if (enemies.live.includes(kid) && isLiving(kid)) remove.add(kid);
      }
    }
    if (!buriedRoster.length) return false;

    for (const inst of remove) {
      const radius = Math.max(2.4, (inst.spec?.collisionRadius || 0.7) * 3.2);
      ctx.vfx?.breach?.(inst.x, inst.y, inst.z, radius, 0.75);
      enemies.remove?.(inst);
    }
    members.length = 0;
    combat.clearProjectiles?.();
    if (buriedRoster.some((record) => record.key === "coulter")) {
      ctx.coulter?.clearHazards?.();
    }

    state.phase = "intermission";
    state.recovering = true;
    state.retreatFor = 0;
    state.recoveries += 1;
    state.timer = BREACH_CONFIG.recoverySeconds;
    state.remaining = 0;
    state.boss = null;
    state.subtitle = reason === "boss"
      ? "Brood submerged beyond protected territory"
      : "Brood submerged — recovery window";
    bus.emit("withdrew", snapshot());
    return true;
  }

  function launchWave(index, options = {}) {
    const nextIndex = clamp(Math.round(index), 0, BREACH_WAVES.length - 1);
    const wave = BREACH_WAVES[nextIndex];
    const centre = chooseCentre(options, wave);
    if (!centre) return null;
    const roster = Array.isArray(options.roster) && options.roster.length
      ? options.roster.map((record) => ({ ...record }))
      : expandRoster(wave).map((key) => ({ key }));
    const id = `breach-${++eventSerial}`;

    members.length = 0;
    state.phase = "warning";
    state.waveIndex = nextIndex;
    state.name = wave.name;
    state.subtitle = wave.subtitle;
    state.timer = options.immediate ? 0.05 : BREACH_CONFIG.warningSeconds;
    state.x = centre.x;
    state.z = centre.z;
    state.total = 0;
    state.remaining = 0;
    state.complete = false;
    state.boss = null;
    state.serial = eventSerial;
    state.recovering = false;
    state.retreatFor = 0;
    state.blockedByBoss = null;
    buriedRoster.length = 0;

    const ps = ctx.player.state;
    for (let i = 0; i < roster.length; i += 1) {
      const record = roster[i];
      const key = record.key;
      const point = spawnPoint(i, roster.length, wave.clusters, key, centre);
      const emerge = EMERGENCE[key] || EMERGENCE.thresher;
      const baseHealth = BESTIARY[key]?.health || 100;
      const maxHealth = Math.max(1, Number(record.maxHealth)
        || Math.round(baseHealth * wave.healthScale));
      const inst = enemies.spawn(key, point.x, point.z, {
        yaw: Math.atan2(ps.x - point.x, ps.z - point.z),
        health: maxHealth,
        damageScale: Number.isFinite(record.damageScale)
          ? record.damageScale : wave.damageScale,
        eventId: id,
        eventWave: nextIndex,
        emerge: {
          delay: (options.immediate ? 0 : BREACH_CONFIG.warningSeconds)
            + i * BREACH_CONFIG.staggerSeconds,
          duration: emerge.duration,
          depth: emerge.depth,
          boss: BOSS_KEYS.has(key),
        },
      });
      if (!inst) continue;
      inst.maxHealth = maxHealth;
      inst.health = Math.max(1, Math.min(maxHealth,
        Number(record.health) || maxHealth));
      inst.home = { x: centre.x, z: centre.z };
      members.push(inst);
    }

    state.total = Math.max(members.length, Math.round(Number(options.total) || 0));
    state.remaining = members.length;
    state.boss = members.find((inst) => BOSS_KEYS.has(inst.key)) || null;
    if (!options.silent) bus.emit(wave.boss ? "bossWarning" : "warning", snapshot());
    return snapshot();
  }

  function start(index = 0, options = {}) {
    if (state.phase === "complete") {
      state.cycle = Math.max(state.cycle + 1, state.cyclesCleared + 1);
    }
    return launchWave(index, options);
  }

  function update(dt) {
    const missionPhase = ctx.mission?.state?.phase;
    if (missionPhase === "won" || missionPhase === "lost") return;

    refreshCounts();
    if (combat.player.dead) return;
    const bossArea = currentBossArea();

    if (state.phase === "dormant") {
      if (!state.auto) return;
      state.timer = Math.max(0, state.timer - dt);
      if (state.timer <= 0 && !bossArea) launchWave(0);
      return;
    }

    if (state.phase === "warning") {
      if (bossArea && submergeWave("boss")) return;
      state.timer = Math.max(0, state.timer - dt);
      if (state.timer <= 0) {
        state.phase = "active";
        bus.emit("opened", snapshot());
      }
      return;
    }

    if (state.phase === "active") {
      if (bossArea && submergeWave("boss")) return;
      const crossedBossBoundary = members.some((inst) => isLiving(inst)
        && protectedBossAreaAt(inst.x, inst.z));
      if (crossedBossBoundary && submergeWave("boss")) return;
      const distance = Math.hypot(ctx.player.state.x - state.x,
        ctx.player.state.z - state.z);
      if (distance > BREACH_CONFIG.eventRadius) state.retreatFor += dt;
      else state.retreatFor = Math.max(0, state.retreatFor - dt * 2);
      if (state.retreatFor >= BREACH_CONFIG.retreatGraceSeconds
        && submergeWave("distance")) return;

      // Event units remain committed to the player even if a static
      // garrison nearby loses interest. The event is a fight, not a POI.
      for (const inst of members) {
        if (!isLiving(inst) || inst.emerging) continue;
        inst.suspicion = 1;
        inst.alerted = true;
      }
      if (state.remaining > 0) return;

      const cleared = snapshot();
      bus.emit("cleared", cleared);
      if (state.waveIndex >= BREACH_WAVES.length - 1) {
        state.phase = "complete";
        state.complete = true;
        state.cyclesCleared = Math.max(state.cyclesCleared, state.cycle);
        state.name = "Brood cycle broken";
        state.subtitle = "Bloom pressure rebuilding";
        state.timer = BREACH_CONFIG.cycleCooldownSeconds;
        bus.emit("complete", snapshot());
      } else {
        state.phase = "intermission";
        state.recovering = false;
        state.name = "Breach sealed";
        state.subtitle = "Next pressure front forming";
        state.timer = BREACH_CONFIG.intermissionSeconds;
      }
      return;
    }

    if (state.phase === "intermission") {
      state.timer = Math.max(0, state.timer - dt);
      if (state.timer > 0 || bossArea) return;
      if (state.recovering) {
        launchWave(state.waveIndex, {
          roster: buriedRoster,
          total: state.total,
        });
      } else {
        launchWave(state.waveIndex + 1);
      }
      return;
    }

    if (state.phase === "complete") {
      if (!state.auto) return;
      state.timer = Math.max(0, state.timer - dt);
      if (state.timer <= 0 && !bossArea) {
        state.cycle = state.cyclesCleared + 1;
        launchWave(0);
      }
    }
  }

  function objective() {
    if (state.phase !== "warning" && state.phase !== "active") return null;
    const ps = ctx.player.state;
    const dist = Math.hypot(ps.x - state.x, ps.z - state.z);
    const boss = state.boss;
    const bossProgress = boss && boss.health > 0
      ? 1 - boss.health / Math.max(1, boss.maxHealth || boss.health)
      : 0;
    return {
      name: state.phase === "warning"
        ? `BLOOM BREACH ${state.waveIndex + 1} INCOMING`
        : state.boss
          ? (BOSS_ORDERS[state.boss.key] || "SLAY THE BOSS")
          : `PURGE ${state.name}`,
      x: state.x,
      z: state.z,
      dist,
      progress: boss ? bossProgress : (state.total ? 1 - state.remaining / state.total : 0),
      event: true,
    };
  }

  function snapshot() {
    refreshCounts();
    const boss = state.boss;
    const ps = ctx.player?.state;
    return {
      phase: state.phase,
      wave: state.waveIndex + 1,
      waveIndex: state.waveIndex,
      waveCount: state.waveCount,
      cycle: state.cycle,
      cyclesCleared: state.cyclesCleared,
      name: state.name,
      subtitle: state.subtitle,
      timer: Number(state.timer.toFixed(2)),
      x: Number(state.x.toFixed(2)),
      z: Number(state.z.toFixed(2)),
      distance: ps ? Number(Math.hypot(ps.x - state.x, ps.z - state.z).toFixed(1)) : null,
      total: state.total,
      remaining: state.remaining,
      complete: state.complete,
      auto: state.auto,
      serial: state.serial,
      recovering: state.recovering,
      retreatFor: Number(state.retreatFor.toFixed(2)),
      recoveries: state.recoveries,
      blockedByBoss: state.blockedByBoss,
      buried: buriedRoster.map((record) => ({
        key: record.key,
        health: Number(record.health.toFixed(3)),
        maxHealth: Number(record.maxHealth.toFixed(3)),
        damageScale: Number(record.damageScale.toFixed(4)),
      })),
      memberIds: members.filter((inst) => isLiving(inst) && inst.id).map((inst) => inst.id),
      bossId: boss?.id || null,
      rng: rng.getState?.() || null,
      boss: boss ? {
        health: Math.max(0, Math.round(boss.health)),
        maxHealth: Math.round(boss.maxHealth || boss.health),
      } : null,
    };
  }

  function restore(saved = {}) {
    members.length = 0;
    buriedRoster.length = 0;
    const phase = ["dormant", "warning", "active", "intermission", "complete"]
      .includes(saved.phase) ? saved.phase : "dormant";
    const waveIndex = clamp(Math.round((Number(saved.wave) || 0) - 1),
      -1, BREACH_WAVES.length - 1);
    const hasSavedTimer = saved.timer !== null && saved.timer !== undefined
      && Number.isFinite(Number(saved.timer));
    const timer = Math.max(0, Number(saved.timer) || 0);
    const x = Number.isFinite(Number(saved.x)) ? Number(saved.x) : 0;
    const z = Number.isFinite(Number(saved.z)) ? Number(saved.z) : 0;
    const savedComplete = phase === "complete" || !!saved.complete;
    state.cyclesCleared = Math.max(0, Math.round(Number(saved.cyclesCleared)
      || (savedComplete ? 1 : 0)));
    state.cycle = Math.max(1, Math.round(Number(saved.cycle)
      || (savedComplete ? state.cyclesCleared : state.cyclesCleared + 1)));
    state.auto = saved.auto === undefined ? !ctx.qa : !!saved.auto;
    state.complete = savedComplete;
    state.waveIndex = waveIndex;
    state.timer = timer;
    state.x = x;
    state.z = z;
    state.total = 0;
    state.remaining = 0;
    state.boss = null;
    state.recovering = !!saved.recovering && phase === "intermission";
    state.retreatFor = Math.max(0, Number(saved.retreatFor) || 0);
    state.recoveries = Math.max(0, Math.round(Number(saved.recoveries) || 0));
    state.blockedByBoss = typeof saved.blockedByBoss === "string"
      ? saved.blockedByBoss : null;
    if (state.recovering && Array.isArray(saved.buried)) {
      for (const record of saved.buried) {
        if (!record || !BESTIARY[record.key]) continue;
        const maxHealth = Math.max(1, Number(record.maxHealth)
          || BESTIARY[record.key].health || 1);
        buriedRoster.push({
          key: record.key,
          health: Math.max(1, Math.min(maxHealth, Number(record.health) || maxHealth)),
          maxHealth,
          damageScale: Number.isFinite(Number(record.damageScale))
            ? Number(record.damageScale) : 1,
        });
      }
    }
    eventSerial = Math.max(eventSerial, Math.round(Number(saved.serial) || 0));

    if (state.complete) {
      state.phase = "complete";
      state.waveIndex = BREACH_WAVES.length - 1;
      state.cycle = Math.max(state.cycle, state.cyclesCleared);
      state.name = saved.name || "Brood cycle broken";
      state.subtitle = saved.subtitle || "Bloom pressure rebuilding";
      state.timer = hasSavedTimer ? timer : BREACH_CONFIG.cycleCooldownSeconds;
    } else if ((phase === "warning" || phase === "active") && waveIndex >= 0) {
      const byId = new Map(enemies.live.filter((inst) => inst?.id)
        .map((inst) => [inst.id, inst]));
      const savedMemberIds = Array.isArray(saved.memberIds) ? saved.memberIds : [];
      const restoredMembers = savedMemberIds
        .map((id) => byId.get(id)).filter((inst) => isLiving(inst));
      const savedRemaining = Number(saved.remaining);
      /* A strike can kill the last member after breaches.update() and before
         mission.update() in the same frame. Empty+zero is an exact active
         roster, not a legacy payload that needs a replacement wave. */
      const exactEmpty = savedMemberIds.length === 0
        && Number.isFinite(savedRemaining) && Math.round(savedRemaining) === 0;
      if (restoredMembers.length) members.push(...restoredMembers);
      else if (!exactEmpty) launchWave(waveIndex, { x, z, immediate: true, silent: true });
      state.phase = phase;
      state.timer = phase === "warning" ? timer : 0;

      const targetRemaining = Math.max(0, Math.min(members.length,
        Number.isFinite(savedRemaining) ? Math.round(savedRemaining) : members.length));
      if (!restoredMembers.length && !exactEmpty) {
        while (members.length > targetRemaining) {
          const inst = members.pop();
          enemies.remove?.(inst);
        }
      }
      state.total = Math.max(targetRemaining,
        Math.round(Number(saved.total) || targetRemaining));
      state.remaining = members.filter(isLiving).length;
      state.name = saved.name || BREACH_WAVES[waveIndex].name;
      state.subtitle = saved.subtitle || BREACH_WAVES[waveIndex].subtitle;
      state.boss = byId.get(saved.bossId)
        || members.find((inst) => BOSS_KEYS.has(inst.key)) || null;
      if (state.boss && saved.boss) {
        const maxHealth = Math.max(1, Number(saved.boss.maxHealth) || state.boss.maxHealth);
        state.boss.maxHealth = maxHealth;
        state.boss.health = Math.max(1, Math.min(maxHealth,
          Number(saved.boss.health) || maxHealth));
      }
    } else if (phase === "intermission" && waveIndex >= 0) {
      const wave = BREACH_WAVES[waveIndex];
      state.phase = "intermission";
      state.name = saved.name || (state.recovering ? wave.name : "Breach sealed");
      state.subtitle = saved.subtitle || (state.recovering
        ? "Brood submerged — recovery window" : "Next pressure front forming");
      state.timer = timer;
      state.total = Math.max(0, Math.round(Number(saved.total) || 0));
      state.remaining = 0;
      if (!state.recovering && wave?.boss) state.waveIndex = Math.max(0, waveIndex - 1);
    } else {
      state.phase = "dormant";
      state.waveIndex = -1;
      state.name = "Bloom pressure";
      state.subtitle = "Signal quiet";
      state.timer = hasSavedTimer ? timer : BREACH_CONFIG.firstWarningAfter;
      state.cycle = Math.max(1, state.cyclesCleared + 1);
    }

    rng.setState?.(saved.rng);
    state.serial = ++eventSerial;
    bus.emit("restored", snapshot());
    return snapshot();
  }

  return {
    bus,
    state,
    members,
    waves: BREACH_WAVES,
    config: BREACH_CONFIG,
    start,
    setAuto(enabled = true) { state.auto = !!enabled; return state.auto; },
    update,
    objective,
    status: snapshot,
    restore,
  };
}
