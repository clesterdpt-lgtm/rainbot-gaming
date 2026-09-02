/* ============================================================
   SAINTFALL - confirmed melee contact

   One connected sweep owns one impact beat. Combat remains the
   authority for whether anything was hit; this observer only shapes
   the tiny pause and camera response that make that answer readable.
   ============================================================ */

export const MELEE_FEEDBACK_CONFIG = Object.freeze({
  /* Seconds of WORLD time withheld after a confirmed contact. These
     are deliberately below a tenth of a second: long enough to put a
     visual full stop on the blade, too short to feel like latency. */
  pause: Object.freeze({
    strike: 0.030,
    killBonus: 0.006,
    finisher: 0.050,
    pierce: 0.020,
    max: 0.056,
    reducedMotionScale: 0.45,
  }),
});

function reducedMotion() {
  return (typeof window !== "undefined"
      && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)
    || (typeof document !== "undefined"
      && !!document.body?.classList?.contains("sf-reduced-motion"));
}

export function buildMeleeFeedback(ctx) {
  let remaining = 0;
  let requests = 0;
  let frozenSeconds = 0;
  let last = null;

  function onMelee(event = {}) {
    /* Whiffs already carry a light weapon/camera follow-through. They
       must never stop the world: the pause itself is confirmation. */
    if (!(event.hits > 0)) return false;

    const reduced = reducedMotion();
    const pause = MELEE_FEEDBACK_CONFIG.pause;
    let duration = event.isPierce
      ? pause.pierce
      : event.slam ? pause.finisher : pause.strike;
    if (event.kills > 0 && !event.slam) duration += pause.killBonus;
    duration = Math.min(pause.max, duration)
      * (reduced ? pause.reducedMotionScale : 1);

    /* Max, not addition: a single broad sweep can connect with a pack,
       yet it is still one authored contact frame and one pause. */
    remaining = Math.max(remaining, duration);
    requests += 1;
    ctx.player?.meleeContactKick?.(event);

    const target = event.targets?.[0] || null;
    last = {
      duration,
      hits: event.hits,
      kills: event.kills || 0,
      slam: !!event.slam,
      isPierce: !!event.isPierce,
      reducedMotion: reduced,
      target: target ? { x: target.x, y: target.y, z: target.z } : null,
    };
    return true;
  }

  ctx.combat?.bus?.on?.("melee", onMelee);

  /** Spend real frame time on the pause and return only the remainder
   *  that gameplay may simulate. This keeps a 100ms recovery frame from
   *  becoming a 100ms freeze, and makes deterministic QA exact. */
  function simulationDelta(realDt) {
    const dt = Number.isFinite(realDt) ? Math.max(0, Math.min(0.1, realDt)) : 0;
    if (remaining <= 0 || dt <= 0) return dt;
    const frozen = Math.min(remaining, dt);
    remaining = Math.max(0, remaining - frozen);
    frozenSeconds += frozen;
    return Math.max(0, dt - frozen);
  }

  function status() {
    return {
      active: remaining > 0,
      remaining,
      requests,
      frozenSeconds,
      last: last ? { ...last, target: last.target ? { ...last.target } : null } : null,
    };
  }

  function reset() {
    remaining = 0;
    requests = 0;
    frozenSeconds = 0;
    last = null;
  }

  return { simulationDelta, status, reset };
}
