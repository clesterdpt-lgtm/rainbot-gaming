/* ============================================================
   SAINTFALL - guard readability coordinator

   Combat domains already own their attacks. This module owns the one
   presentation question shared by all of them: what is about to land,
   from where, and should the player guard or dodge?
   ============================================================ */

import { makeBus } from "saintfall/core.js";
import { GUARD_CUE_CONFIG, GUARD_TYPES, guardTypeOf } from "saintfall/guard-rules.js";

const DEFAULT_LABELS = Object.freeze({
  [GUARD_TYPES.FRONTAL]: "GUARD",
  [GUARD_TYPES.PERFECT_ONLY]: "PERFECT",
  [GUARD_TYPES.UNBLOCKABLE]: "DODGE",
});

export function buildGuardReadability(ctx) {
  const bus = makeBus();
  const threats = new Map();
  const unsubs = [];
  let clock = 0;
  let serial = 0;
  let frozen = false;

  function publicThreat(threat) {
    const remaining = threat.impactAt - clock;
    return {
      id: threat.id,
      source: threat.source,
      label: threat.label,
      guardType: threat.guardType,
      x: threat.x,
      y: threat.y,
      z: threat.z,
      remaining: Number(remaining.toFixed(3)),
      duration: threat.duration,
      progress: Math.max(0, Math.min(1, 1 - remaining / Math.max(0.01, threat.duration))),
      ready: remaining <= GUARD_CUE_CONFIG.perfectWindow,
      training: threat.training,
    };
  }

  function telegraph(detail = {}) {
    const duration = Math.max(0.05, Number(detail.impactIn) || 0.45);
    const id = String(detail.id || `${detail.source || "attack"}:${++serial}`);
    const threat = {
      id,
      source: detail.source || "attack",
      label: detail.label || DEFAULT_LABELS[guardTypeOf(detail.guardType)],
      guardType: guardTypeOf(detail.guardType),
      x: Number.isFinite(detail.originX) ? detail.originX : Number(detail.x) || 0,
      y: Number.isFinite(detail.originY) ? detail.originY : Number(detail.y) || 0,
      z: Number.isFinite(detail.originZ) ? detail.originZ : Number(detail.z) || 0,
      duration,
      impactAt: clock + duration,
      readySent: false,
      training: !!detail.training,
    };
    threats.set(id, threat);
    bus.emit("threatTelegraph", publicThreat(threat));
    return id;
  }

  function resolve(id, detail = {}) {
    const threat = threats.get(String(id));
    if (!threat) return false;
    threats.delete(threat.id);
    bus.emit("threatResolved", { ...publicThreat(threat), ...detail });
    return true;
  }

  function on(domain, event, fn) {
    if (!domain?.bus?.on) return;
    unsubs.push(domain.bus.on(event, fn));
  }

  /* Ordinary castes have authoritative IDs and resolution events. */
  on(ctx.combat, "enemyStrikeTelegraph", (e = {}) => telegraph({
    id: `enemy:${e.enemyId}`,
    source: `enemy-${e.key || "melee"}`,
    label: "GUARD",
    guardType: e.guardType || GUARD_TYPES.FRONTAL,
    originX: e.originX ?? e.x, originY: e.originY ?? e.y, originZ: e.originZ ?? e.z,
    impactIn: e.windup,
  }));
  on(ctx.combat, "enemyStrikeResolved", (e = {}) => resolve(`enemy:${e.enemyId}`, e));
  on(ctx.combat, "enemyProjectileLaunched", (e = {}) => telegraph({
    id: `projectile:${e.id}`,
    source: `enemy-${e.enemyKey || "projectile"}`,
    label: "GUARD",
    guardType: GUARD_TYPES.FRONTAL,
    originX: e.x, originY: e.y, originZ: e.z,
    impactIn: Math.max(0.05, (Number(e.targetDistance) || 0) / Math.max(1, Number(e.speed) || 1)),
  }));
  on(ctx.combat, "enemyProjectileResolved", (e = {}) => resolve(`projectile:${e.id}`, e));

  /* Boss modules publish this same compact metadata on their existing tells.
     Auto-expiry is intentional: their resolution events differ by phase, but
     the indicator must never outlive the advertised contact beat. */
  const bossTells = [
    [ctx.matriarch, "comboTell", "matriarch-combo"],
    [ctx.matriarch, "lanceTell", "matriarch-lance"],
    [ctx.matriarch, "cullTell", "matriarch-cull"],
    [ctx.matriarch, "grabTell", "matriarch-grab"],
    [ctx.matriarch, "tremorTell", "matriarch-tremor"],
    [ctx.matriarch, "rouse", "matriarch-rouse"],
    [ctx.winnower, "sweepTelegraph", "winnower-sweep"],
    [ctx.winnower, "bombardTelegraph", "winnower-bombard"],
    [ctx.distaff, "biteTelegraph", "distaff-bite"],
    [ctx.distaff, "slamTelegraph", "distaff-slam"],
    [ctx.distaff, "webCastTelegraph", "distaff-web"],
    [ctx.abbess, "biteTelegraph", "abbess-bite"],
    [ctx.abbess, "slamTelegraph", "abbess-slam"],
    [ctx.garner, "lash", "garner-lash"],
    [ctx.garner, "inhaleTelegraph", "garner-inhale"],
    [ctx.stylite, "stoopTelegraph", "stylite-stoop"],
    [ctx.coulter, "bite", "coulter-bite"],
    [ctx.apostate, "meleeTelegraph", "apostate-melee"],
    [ctx.apostate, "boost", "apostate-boost"],
    [ctx.apostate, "slamTelegraph", "apostate-slam"],
    [ctx.undercroft, "wind", "undercroft-lasher"],
  ];
  for (const [domain, event, source] of bossTells) {
    on(domain, event, (e = {}) => telegraph({
      ...e,
      id: `${source}:${source === "garner-lash" ? (e.index ?? "arm")
        : source === "coulter-bite" ? (e.id ?? "active") : "active"}`,
      source,
    }));
  }

  function update(dt) {
    if (frozen) return;
    clock += Math.max(0, Number(dt) || 0);
    for (const threat of [...threats.values()]) {
      const remaining = threat.impactAt - clock;
      if (!threat.readySent && remaining <= GUARD_CUE_CONFIG.perfectWindow) {
        threat.readySent = true;
        bus.emit("threatReady", publicThreat(threat));
      }
      if (remaining < -GUARD_CUE_CONFIG.resultLinger) threats.delete(threat.id);
    }
  }

  function status() {
    const active = [...threats.values()]
      .map(publicThreat)
      .sort((a, b) => a.remaining - b.remaining);
    return { clock: Number(clock.toFixed(3)), primary: active[0] || null, active };
  }

  function preview(options = {}) {
    for (const threat of [...threats.values()]) {
      if (threat.training) threats.delete(threat.id);
    }
    const ps = ctx.player?.state || { x: 0, y: 0, z: 0, yaw: 0 };
    const distance = Number(options.distance) || 8;
    return telegraph({
      id: "guard-training",
      source: "training",
      label: options.label || "GUARD",
      training: true,
      guardType: options.guardType || GUARD_TYPES.FRONTAL,
      originX: ps.x + Math.sin(ps.yaw) * distance,
      originY: ps.y + 1,
      originZ: ps.z + Math.cos(ps.yaw) * distance,
      impactIn: Number(options.impactIn) || 1.1,
    });
  }

  return {
    bus,
    config: GUARD_CUE_CONFIG,
    telegraph,
    resolve,
    preview,
    setFrozen(value) {
      if (!ctx.qa) return false;
      frozen = !!value;
      return frozen;
    },
    update,
    status,
    dispose() { for (const off of unsubs) off?.(); threats.clear(); },
  };
}
