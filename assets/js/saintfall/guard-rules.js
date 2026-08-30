/* ============================================================
   SAINTFALL - shared guard contract

   Every hostile contact declares what the Aegis can do about it.
   The same constants drive damage resolution, the timing cue, HUD,
   audio, touch feedback and deterministic QA.
   ============================================================ */

export const GUARD_TYPES = Object.freeze({
  FRONTAL: "frontal",
  PERFECT_ONLY: "perfect-only",
  UNBLOCKABLE: "unblockable",
});

export const GUARD_CUE_CONFIG = Object.freeze({
  perfectWindow: 0.25,
  minImpactSpacing: 0.15,
  maxTellExtension: 0.45,
  resultLinger: 0.32,
  /* The omen floats just above the authored contact point. It remains a
     world read attached to the attacker, never a reticle-sized HUD card. */
  meleeCueLift: 0.68,
});

export function guardTypeOf(value, fallback = GUARD_TYPES.FRONTAL) {
  return Object.values(GUARD_TYPES).includes(value) ? value : fallback;
}

/** Convert the many historical damage payload shapes into one contract. */
export function normalizeGuardDetail(detail = {}, player = null) {
  const originX = Number.isFinite(detail.originX) ? detail.originX : detail.x;
  const originY = Number.isFinite(detail.originY) ? detail.originY : detail.y;
  const originZ = Number.isFinite(detail.originZ) ? detail.originZ : detail.z;
  const hasOrigin = Number.isFinite(originX) && Number.isFinite(originZ);
  const distance = hasOrigin && player
    ? Math.hypot(originX - player.x, originZ - player.z) : Infinity;
  /* A legacy payload located exactly on the player is an area effect, not a
     direction. Preserve its old unguardable behaviour, but name it so the
     feedback can say DODGE instead of silently rejecting the plate. */
  const fallback = hasOrigin && distance > 1e-4
    ? GUARD_TYPES.FRONTAL : GUARD_TYPES.UNBLOCKABLE;
  return {
    ...detail,
    originX,
    originY,
    originZ,
    guardType: guardTypeOf(detail.guardType, fallback),
  };
}
