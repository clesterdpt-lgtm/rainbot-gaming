/* ============================================================
   SAINTFALL - Bloom breach progression

   A breach is a compulsory field event that follows the player.
   Each stage telegraphs a rupture, raises a deliberately authored
   caste mix, and waits for every member to die before it advances.
   The final stage is the Matriarch rather than another anonymous
   difficulty bump.
   ============================================================ */

import { TAU, clamp, makeBus, makeRng } from "saintfall/core.js";
import { BESTIARY } from "saintfall/enemies.js";

export const BREACH_CONFIG = Object.freeze({
  firstWarningAfter: 11,
  movementTrigger: 38,
  warningSeconds: 3.4,
  intermissionSeconds: 15,
  spawnDistanceMin: 38,
  spawnDistanceMax: 54,
  eventRadius: 92,
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
    name: "The Broodmother",
    subtitle: "Matriarch ascendant",
    healthScale: 1,
    damageScale: 1,
    clusters: 2,
    boss: true,
    roster: Object.freeze([
      { key: "matriarch", count: 1 },
      { key: "thresher", count: 4 },
    ]),
  }),
]);

const EMERGENCE = Object.freeze({
  thresher: Object.freeze({ depth: 1.35, duration: 1.18 }),
  gleaner: Object.freeze({ depth: 3.15, duration: 1.72 }),
  harrow: Object.freeze({ depth: 2.75, duration: 1.88 }),
  matriarch: Object.freeze({ depth: 5.6, duration: 2.85 }),
});

const isLiving = (inst) => !!inst && inst.state !== "death" && inst.health > 0;

export function buildBreaches(ctx) {
  const { enemies, collide, combat } = ctx;
  const bus = makeBus();
  const rng = makeRng((ctx.seed ^ 0xb10f0) >>> 0 || 17);
  const members = [];
  const startPoint = { x: ctx.player.state.x, z: ctx.player.state.z };
  let eventSerial = 0;

  const state = {
    phase: "dormant",       // dormant -> warning -> active -> intermission -> complete
    waveIndex: -1,
    waveCount: BREACH_WAVES.length,
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
  };

  function expandRoster(wave) {
    const roster = [];
    for (const entry of wave.roster) {
      for (let i = 0; i < entry.count; i += 1) roster.push(entry.key);
    }
    // The boss owns the centre and rises first. The remaining castes
    // alternate instead of surfacing as a row of identical copies.
    if (wave.boss) return roster.sort((a, b) => (a === "matriarch" ? -1 : b === "matriarch" ? 1 : 0));
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
    const distance = BREACH_CONFIG.spawnDistanceMin
      + rng() * (BREACH_CONFIG.spawnDistanceMax - BREACH_CONFIG.spawnDistanceMin);
    // Usually forward, sometimes on a flank. The warning has to be in
    // the player's visual problem space or the emergence is wasted.
    const angle = ps.camYaw + (rng() - 0.5) * 1.55;
    let x = clamp(ps.x + Math.sin(angle) * distance, -955, 955);
    let z = clamp(ps.z + Math.cos(angle) * distance, -955, 955);
    return flattenCentre(x, z, !!wave?.boss);
  }

  function spawnPoint(index, total, clusters, key, centre) {
    const cluster = index % Math.max(1, clusters);
    const clusterAngle = (cluster / Math.max(1, clusters)) * TAU + 0.46;
    const clusterRadius = clusters > 1 ? 7.5 : 0;
    const localAngle = index * 2.3999632297 + clusterAngle * 0.37;
    const localRadius = key === "matriarch" ? 0 : 2.8 + Math.sqrt(index + 0.4) * 2.35;
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
      if (inst.key === "matriarch") boss = inst;
    }
    state.remaining = remaining;
    state.boss = boss;
    return remaining;
  }

  function launchWave(index, options = {}) {
    const nextIndex = clamp(Math.round(index), 0, BREACH_WAVES.length - 1);
    const wave = BREACH_WAVES[nextIndex];
    const centre = chooseCentre(options, wave);
    const roster = expandRoster(wave);
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

    const ps = ctx.player.state;
    for (let i = 0; i < roster.length; i += 1) {
      const key = roster[i];
      const point = spawnPoint(i, roster.length, wave.clusters, key, centre);
      const emerge = EMERGENCE[key] || EMERGENCE.thresher;
      const baseHealth = BESTIARY[key]?.health || 100;
      const inst = enemies.spawn(key, point.x, point.z, {
        yaw: Math.atan2(ps.x - point.x, ps.z - point.z),
        health: Math.round(baseHealth * wave.healthScale),
        damageScale: wave.damageScale,
        eventId: id,
        eventWave: nextIndex,
        emerge: {
          delay: (options.immediate ? 0 : BREACH_CONFIG.warningSeconds)
            + i * BREACH_CONFIG.staggerSeconds,
          duration: emerge.duration,
          depth: emerge.depth,
          boss: key === "matriarch",
        },
      });
      if (!inst) continue;
      inst.home = { x: centre.x, z: centre.z };
      members.push(inst);
    }

    state.total = members.length;
    state.remaining = members.length;
    state.boss = members.find((inst) => inst.key === "matriarch") || null;
    bus.emit(wave.boss ? "bossWarning" : "warning", snapshot());
    return snapshot();
  }

  function start(index = 0, options = {}) {
    return launchWave(index, options);
  }

  function update(dt) {
    const missionPhase = ctx.mission?.state?.phase;
    if (state.complete || missionPhase === "won" || missionPhase === "lost") return;

    refreshCounts();
    if (combat.player.dead) return;

    if (state.phase === "dormant") {
      if (!state.auto) return;
      state.timer = Math.max(0, state.timer - dt);
      const moved = Math.hypot(
        ctx.player.state.x - startPoint.x,
        ctx.player.state.z - startPoint.z
      );
      if (state.timer <= 0 || moved >= BREACH_CONFIG.movementTrigger) launchWave(0);
      return;
    }

    if (state.phase === "warning") {
      state.timer = Math.max(0, state.timer - dt);
      if (state.timer <= 0) {
        state.phase = "active";
        bus.emit("opened", snapshot());
      }
      return;
    }

    if (state.phase === "active") {
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
        state.name = "Bloom severed";
        state.subtitle = "All breach signatures extinguished";
        state.timer = 0;
        bus.emit("complete", snapshot());
      } else {
        state.phase = "intermission";
        state.name = "Breach sealed";
        state.subtitle = "Next pressure front forming";
        state.timer = BREACH_CONFIG.intermissionSeconds;
      }
      return;
    }

    if (state.phase === "intermission") {
      state.timer = Math.max(0, state.timer - dt);
      if (state.timer <= 0) launchWave(state.waveIndex + 1);
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
        : state.boss ? "SLAY THE MATRIARCH" : `PURGE ${state.name}`,
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
      waveCount: state.waveCount,
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
      boss: boss ? {
        health: Math.max(0, Math.round(boss.health)),
        maxHealth: Math.round(boss.maxHealth || boss.health),
      } : null,
    };
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
  };
}
