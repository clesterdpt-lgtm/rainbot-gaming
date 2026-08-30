/* ============================================================
   SAINTFALL - guard readability coordinator

   Combat domains already own their attacks. This module owns the one
   presentation question shared by all of them: which committed melee
   contact is about to land, and which attacker owns it?
   ============================================================ */

import { makeBus } from "saintfall/core.js";
import { GUARD_CUE_CONFIG, GUARD_TYPES, guardTypeOf } from "saintfall/guard-rules.js";

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
      kind: threat.kind,
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
    const guardType = guardTypeOf(detail.guardType);
    /* This is an Aegis read, not a universal attack alarm. Projectiles are
       already visible in flight and area/grab attacks own their world tells;
       adding the same HUD mark to either only teaches the wrong response. */
    if (guardType === GUARD_TYPES.UNBLOCKABLE || detail.kind === "ranged") return null;
    const duration = Math.max(0.05, Number(detail.impactIn) || 0.45);
    const id = String(detail.id || `${detail.source || "attack"}:${++serial}`);
    const x = Number.isFinite(detail.originX) ? detail.originX : Number(detail.x) || 0;
    const z = Number.isFinite(detail.originZ) ? detail.originZ : Number(detail.z) || 0;
    const groundY = ctx.terrain?.heightAt?.(x, z) ?? 0;
    const y = Number.isFinite(detail.originY) ? detail.originY
      : Number.isFinite(detail.y) ? detail.y
        : groundY + Math.max(0, Number(detail.anchorHeight) || 2.4);
    const threat = {
      id,
      source: detail.source || "attack",
      label: "MELEE",
      kind: "melee",
      guardType,
      x,
      y,
      z,
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

  /* Only committed, Aegis-readable body contacts join the shared omen. Boss
     projectiles, grabs and area attacks stay legible through their authored
     motion and VFX. Auto-expiry prevents a cancelled swing leaving a mark. */
  const bossTells = [
    [ctx.matriarch, "comboTell", "matriarch-combo", 5.2],
    [ctx.matriarch, "lanceTell", "matriarch-lance", 5.2],
    [ctx.matriarch, "cullTell", "matriarch-cull", 5.2],
    [ctx.winnower, "sweepTelegraph", "winnower-sweep", 6.4],
    [ctx.distaff, "biteTelegraph", "distaff-bite", 5.4],
    [ctx.abbess, "biteTelegraph", "abbess-bite", 5.6],
    [ctx.coulter, "bite", "coulter-bite", 0],
    [ctx.apostate, "meleeTelegraph", "apostate-melee", 2.6],
    [ctx.apostate, "boost", "apostate-boost", 2.6],
    [ctx.undercroft, "wind", "undercroft-lasher", 0],
  ];
  for (const [domain, event, source, anchorHeight] of bossTells) {
    on(domain, event, (e = {}) => telegraph({
      ...e,
      anchorHeight,
      id: `${source}:${source === "coulter-bite" ? (e.id ?? "active") : "active"}`,
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
