/**
 * Fair Incident Commander policy — uses observation only (no root-cause oracle).
 * Does NOT call the browser suggest() helper, which knows the true root cause.
 */

const ROOTS = [
  "credential_leak",
  "dependency_poison",
  "misconfigured_cdn",
  "ransomware",
  "insider_export",
  "botnet_ddos",
];

function topHypothesis(obs) {
  const list = Array.isArray(obs.hypotheses) ? obs.hypotheses.slice() : [];
  list.sort((a, b) => (b.evidenceScore || 0) - (a.evidenceScore || 0));
  return list[0] || null;
}

function degradedServices(obs) {
  return (obs.services || []).filter((s) => s.affected || s.status === "degraded" || s.status === "critical");
}

function suspectHosts(obs) {
  return (obs.hosts || []).filter((h) => ["suspect", "compromised"].includes(h.status) || h.id);
}

/**
 * @param {object} obs
 * @returns {string[]}
 */
export function chooseIcBatch(obs) {
  if (!obs || !obs.metrics) return ["WAIT"];
  if (obs.metrics.campaignComplete) return [];
  if (obs.metrics.failed) return ["RESTART_INCIDENT"];

  const rem = obs.remediation || {};
  const batch = [];
  const push = (cmd) => {
    if (cmd && batch.length < 8) batch.push(cmd);
  };

  const primaryFromIntake = (() => {
    // Prefer most critical affected service as investigation focus
    const degraded = degradedServices(obs).sort((a, b) => (a.health || 100) - (b.health || 100));
    return degraded[0]?.id || obs.services?.find((s) => s.status !== "nominal")?.id || "api";
  })();

  const top = topHypothesis(obs);
  const confidence = obs.metrics.confidence || 0;
  const evidenceCount = (obs.evidence || []).length;

  // Phase 1: gather evidence on worst service + its likely hosts
  const worst = degradedServices(obs)[0];
  const focusService = worst?.id || primaryFromIntake;

  if (evidenceCount < 2 || confidence < 25) {
    if (!worst?.queried) push(`QUERY logs ${focusService}`);
    if (!worst?.traced) push(`TRACE service ${focusService}`);
    const hostCandidates = (obs.hosts || [])
      .filter((h) => (h.services || []).includes(focusService) || h.status === "suspect" || h.status === "compromised")
      .sort((a, b) => {
        const rank = (h) => (h.status === "compromised" ? 0 : h.status === "suspect" ? 1 : h.scanned ? 3 : 2);
        return rank(a) - rank(b);
      });
    const host = hostCandidates.find((h) => !h.scanned) || hostCandidates[0];
    if (host && !host.scanned) push(`SCAN host ${host.id}`);
    if (batch.length) return batch;
  }

  // Infer primary host from compromised/suspect after scans
  const primaryHost =
    (obs.hosts || []).find((h) => h.status === "compromised")?.id ||
    (obs.hosts || []).find((h) => h.status === "suspect")?.id ||
    (obs.hosts || []).find((h) => h.scanned && (h.findings || []).some((f) => f.confidence >= 20))?.id ||
    null;

  const root = top && top.evidenceScore >= 18 ? top.rootCause : null;

  // Phase 2: remediate based on inferred root
  if (root === "botnet_ddos") {
    if (!(rem.throttledServices || []).includes(focusService)) push(`THROTTLE service ${focusService}`);
  } else if (root === "dependency_poison" || root === "misconfigured_cdn") {
    if (!(rem.patchedServices || []).includes(focusService)) push(`PATCH service ${focusService}`);
  } else if (root === "credential_leak" || root === "insider_export") {
    if (primaryHost && !(rem.isolatedHosts || []).includes(primaryHost)) push(`ISOLATE host ${primaryHost}`);
    if (!(rem.rotatedSecrets || []).includes(focusService)) push(`ROTATE secrets ${focusService}`);
    if (!(rem.restoredServices || []).includes(focusService)) push(`RESTORE service ${focusService}`);
  } else if (root === "ransomware") {
    if (primaryHost && !(rem.isolatedHosts || []).includes(primaryHost)) push(`ISOLATE host ${primaryHost}`);
    if (!(rem.restoredServices || []).includes(focusService)) push(`RESTORE service ${focusService}`);
  } else {
    // Unknown: gather more evidence broadly
    const unqueried = (obs.services || []).find((s) => s.affected && !s.queried);
    if (unqueried) push(`QUERY logs ${unqueried.id}`);
    const unscanned = (obs.hosts || []).find((h) => !h.scanned && (h.status === "suspect" || (h.services || []).some((sid) => degradedServices(obs).some((s) => s.id === sid))));
    if (unscanned) push(`SCAN host ${unscanned.id}`);
    if (!batch.length && primaryHost) push(`SCAN host ${primaryHost}`);
    if (!batch.length) push(`QUERY logs ${focusService}`);
  }

  // Phase 3: report when ready
  if (root && confidence >= 60 && rem.rootFixed && rem.recoveryReady) {
    push(`REPORT ${root}`);
  } else if (root && confidence >= 60 && rem.rootFixed && !rem.recoveryReady) {
    push(`RESTORE service ${focusService}`);
  }

  // Low budget / bad metrics: avoid WAIT thrash — focus remediation
  if (!batch.length) {
    if (obs.metrics.budget < 8) {
      // last ditch report if we somehow fixed things
      if (root && rem.rootFixed) push(`REPORT ${root}`);
      else if (primaryHost) push(`ISOLATE host ${primaryHost}`);
      else push(`PATCH service ${focusService}`);
    } else {
      push(`QUERY logs ${focusService}`);
      if (primaryHost) push(`SCAN host ${primaryHost}`);
    }
  }

  return batch.length ? batch : ["WAIT"];
}

export const POLICY_ID = "ic-heuristic-v1";
