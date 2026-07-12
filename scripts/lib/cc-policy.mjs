/**
 * Consensus Collapse policy v3
 * Goal: efficient score + best-effort ratification inside the turn budget.
 * Assembly 1 needs ~4 supporting factions (leverage math) — hard for pure heuristics.
 */

const ISSUES = ["safety", "speed", "privacy", "openness", "compute", "labor"];

function leanToIdeal(lean) {
  if (lean === "wants_more" || lean === "more") return 2;
  if (lean === "wants_less" || lean === "less") return -2;
  return 0;
}

function estimateIdeal(faction) {
  if (faction.revealedIdeal) return { ...faction.revealedIdeal };
  const out = {};
  for (const issue of ISSUES) out[issue] = leanToIdeal(faction.visibleLean?.[issue]);
  return out;
}

/**
 * @param {object} obs
 * @param {object} [ctx]
 * @returns {string[]}
 */
export function chooseCcBatch(obs, ctx = {}) {
  if (!obs || !obs.agent) return ["WAIT"];
  if (obs.agent.campaignComplete) return [];
  if (obs.agent.collapsed) return ["RESTART_ASSEMBLY"];

  const status = obs.ratifyStatus || {};
  if (status.ok) return ["RATIFY"];

  const factions = Array.isArray(obs.factions) ? obs.factions.slice() : [];
  const budget = obs.agent.budget || 0;
  const turn = obs.agent.round || 0;
  const turnBudget = obs.assembly?.turnBudget || 18;
  const contradiction = obs.agent.contradiction || 0;
  const limit = obs.assembly?.contradictionLimit || 70;
  const treaty = obs.treaty || {};
  const bridges = new Set(obs.bridges || []);
  const overtime = turn > Math.floor(turnBudget * 0.65);
  const batch = [];
  const push = (cmd) => {
    if (cmd && batch.length < 5) batch.push(cmd);
  };

  // Priority coalition: highest leverage first
  const byLev = factions.slice().sort((a, b) => (b.leverage || 0) - (a.leverage || 0));
  const blockers = factions.filter((f) => !f.supports).sort((a, b) => (a.satisfaction || 0) - (b.satisfaction || 0));

  // 1) Early: cheap treaty shaping toward high-leverage leans (no audit required)
  const treatyMoves = [];
  if (turn < 8) {
    // Target a moderate pro-growth / pro-safety compromise
    const desired = {
      safety: 1,
      speed: 1,
      privacy: 0,
      openness: 1,
      compute: 2,
      labor: 1,
    };
    for (const issue of ISSUES) {
      const gap = (desired[issue] || 0) - (treaty[issue] || 0);
      if (gap !== 0) treatyMoves.push({ issue, delta: gap > 0 ? 1 : -1, abs: Math.abs(gap) });
    }
    treatyMoves.sort((a, b) => b.abs - a.abs);
    for (const move of treatyMoves.slice(0, 2)) {
      if (budget >= 2) push(`PROPOSE ${move.issue} ${move.delta}`);
    }
    if (batch.length) return batch;
  }

  // 2) If contradiction hot, bridge top two leverage factions
  if (contradiction >= Math.max(20, limit - 25) || (obs.agent.quorum || 0) >= 20) {
    const a = byLev[0]?.id;
    const b = byLev[1]?.id;
    if (a && b) {
      const key = [a, b].sort().join(":");
      if (!bridges.has(key) && budget >= 6) {
        push(`BRIDGE ${a} ${b}`);
        return batch;
      }
    }
    // bridge supporter to blocker
    const sup = factions.find((f) => f.supports);
    const blk = blockers[0];
    if (sup && blk) {
      const key = [sup.id, blk.id].sort().join(":");
      if (!bridges.has(key) && budget >= 6) {
        push(`BRIDGE ${sup.id} ${blk.id}`);
        return batch;
      }
    }
  }

  // 3) Offers to near-miss factions first (satisfaction 40-51), then lowest
  const offerTargets = factions
    .filter((f) => !f.supports)
    .sort((a, b) => {
      const aNear = a.satisfaction >= 40 ? 0 : 1;
      const bNear = b.satisfaction >= 40 ? 0 : 1;
      if (aNear !== bNear) return aNear - bNear;
      return (b.leverage || 0) - (a.leverage || 0) || (a.satisfaction || 0) - (b.satisfaction || 0);
    });

  if (budget >= 5 && offerTargets.length) {
    for (const f of offerTargets.slice(0, 2)) {
      const ideal = estimateIdeal(f);
      const issue = ISSUES.slice().sort(
        (x, y) => Math.abs((ideal[y] || 0) - (treaty[y] || 0)) - Math.abs((ideal[x] || 0) - (treaty[x] || 0))
      )[0];
      push(`OFFER ${f.id} ${issue}`);
    }
    if (batch.length) return batch;
  }

  // 4) Budget recovery only if not deep into overtime and we still need actions
  if (budget < 5 && !overtime) {
    push("WAIT");
    return batch;
  }

  // 5) Late: one more propose toward biggest remaining blocker ideal
  if (blockers[0] && budget >= 2) {
    const ideal = estimateIdeal(blockers[0]);
    const issue = ISSUES.slice().sort(
      (a, b) => Math.abs((ideal[b] || 0) - (treaty[b] || 0)) - Math.abs((ideal[a] || 0) - (treaty[a] || 0))
    )[0];
    const gap = (ideal[issue] || 0) - (treaty[issue] || 0);
    if (gap !== 0) {
      push(`PROPOSE ${issue} ${gap > 0 ? 1 : -1}`);
      return batch;
    }
  }

  // 6) Attempt ratify if somehow close (status may flip after last offer)
  if ((obs.agent.quorum || 0) >= (obs.assembly?.quorumTarget || 60) - 1) {
    push("RATIFY");
    return batch;
  }

  if (budget < 5) push("WAIT");
  else if (offerTargets[0]) {
    const f = offerTargets[0];
    const ideal = estimateIdeal(f);
    const issue = ISSUES[0];
    push(`OFFER ${f.id} ${Object.keys(ideal).sort((a, b) => Math.abs(ideal[b]) - Math.abs(ideal[a]))[0] || issue}`);
  } else push("WAIT");

  return batch.length ? batch : ["WAIT"];
}

export const POLICY_ID = "cc-heuristic-v3";
