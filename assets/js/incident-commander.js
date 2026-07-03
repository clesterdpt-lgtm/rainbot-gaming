/* ============================================
   Incident Commander
   - Agent-first incident response game
   - Deterministic service/host simulation, DOM renderer
   - Debug/API hook: window.INCIDENT_AGENT_API
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "incident-commander";
  const STORAGE_KEY = "rb:incident-commander:v1";
  const MAX_INCIDENTS = 12;
  const BATCH_LIMIT = 12;

  const SERVICES = [
    { id: "edge", name: "Edge", tier: "front door", criticality: 15, deps: ["auth", "api"] },
    { id: "auth", name: "Auth", tier: "identity", criticality: 18, deps: ["users", "api"] },
    { id: "api", name: "API", tier: "core", criticality: 16, deps: ["users", "queue"] },
    { id: "payments", name: "Payments", tier: "money", criticality: 20, deps: ["api", "users"] },
    { id: "users", name: "Users DB", tier: "data", criticality: 19, deps: ["auth"] },
    { id: "content", name: "Content", tier: "publishing", criticality: 12, deps: ["api", "media"] },
    { id: "media", name: "Media", tier: "assets", criticality: 10, deps: ["edge"] },
    { id: "analytics", name: "Analytics", tier: "signals", criticality: 8, deps: ["queue"] },
    { id: "queue", name: "Queue", tier: "jobs", criticality: 13, deps: ["api"] },
  ];

  const HOSTS = [
    { id: "edge-01", role: "CDN edge", zone: "dmz", services: ["edge", "media"], x: 10, y: 26 },
    { id: "edge-03", role: "WAF edge", zone: "dmz", services: ["edge"], x: 18, y: 70 },
    { id: "api-01", role: "API worker", zone: "app", services: ["api", "content"], x: 38, y: 28 },
    { id: "api-02", role: "API worker", zone: "app", services: ["api", "queue"], x: 42, y: 72 },
    { id: "identity-02", role: "Identity cache", zone: "privileged", services: ["auth", "users"], x: 64, y: 22 },
    { id: "db-02", role: "Database primary", zone: "data", services: ["users", "payments"], x: 76, y: 56 },
    { id: "build-01", role: "Build runner", zone: "ci", services: ["api", "content"], x: 58, y: 82 },
    { id: "analytics-01", role: "Analytics worker", zone: "data", services: ["analytics", "queue"], x: 88, y: 26 },
  ];

  const HOST_LINKS = [
    ["edge-01", "api-01"],
    ["edge-03", "api-02"],
    ["api-01", "identity-02"],
    ["api-02", "db-02"],
    ["api-02", "build-01"],
    ["identity-02", "db-02"],
    ["db-02", "analytics-01"],
    ["build-01", "analytics-01"],
  ];

  const ROOTS = {
    credential_leak: {
      title: "Credential Leak",
      aliases: ["credential", "credentials", "leaked_token", "token_leak", "stolen_token", "stolen_credentials"],
      remedy: "rotate secrets on the affected service, isolate the issuing host, then restore traffic",
      query: "Impossible-token reuse appears across session logs with a new ASN and no matching login event.",
      host: "Volatile cache contains an active session exporter and stale token material.",
      trace: "Dependency trace shows identity fanout before the first user-facing errors.",
    },
    dependency_poison: {
      title: "Dependency Poison",
      aliases: ["dependency", "supply_chain", "package_poison", "poisoned_dependency", "supply-chain"],
      remedy: "patch the affected service back to a pinned package and restore the pipeline",
      query: "Deploy log includes an unsigned package version that was not in the approved manifest.",
      host: "Build runner contains a cache entry whose checksum differs from the lockfile.",
      trace: "Downstream services degrade immediately after the suspicious build artifact ships.",
    },
    misconfigured_cdn: {
      title: "Misconfigured CDN",
      aliases: ["cdn", "bad_cdn", "misconfig", "misconfiguration", "cache_rule", "misconfigured_cache"],
      remedy: "patch the edge service configuration and restore origin routing",
      query: "Edge logs show bypassed auth headers and cache keys collapsing unrelated tenants.",
      host: "Edge host config differs from the signed baseline and accepts wildcard purges.",
      trace: "Only front-door services fail first; origin checks remain mostly healthy.",
    },
    ransomware: {
      title: "Ransomware",
      aliases: ["ransom", "crypto_lock", "cryptolock", "locker", "encrypted_volume"],
      remedy: "isolate the infected host and restore the affected service from backup",
      query: "Database logs show rapid file-renames, write amplification, and backup probe failures.",
      host: "Host process table includes an unknown encryptor touching service volumes.",
      trace: "Dependent services fail after storage latency spikes instead of after deploy events.",
    },
    insider_export: {
      title: "Insider Export",
      aliases: ["insider", "data_export", "exfil", "exfiltration", "bulk_export", "insider_threat"],
      remedy: "isolate the exporting host, rotate affected service secrets, and restore clean access",
      query: "Audit stream shows approved credentials used for an abnormal bulk export window.",
      host: "Worker has a long-lived shell and compressed export chunks in temp storage.",
      trace: "Queue and analytics stay live while downstream privacy alarms climb.",
    },
    botnet_ddos: {
      title: "Botnet DDoS",
      aliases: ["ddos", "botnet", "traffic_flood", "flood", "layer7"],
      remedy: "throttle the targeted edge service and keep origin hosts online",
      query: "Access logs show many low-reputation IPs replaying the same expensive endpoint.",
      host: "Edge host is saturated but clean; isolation would hurt users more than attackers.",
      trace: "Origin stays valid while front-door request volume climbs far above baseline.",
    },
  };

  const INCIDENTS = [
    { name: "Ghost Token Fanout", rootCause: "credential_leak", severity: 4, primaryService: "auth", primaryHost: "identity-02", affectedServices: ["auth", "users"], falseLead: "payments", intake: "Auth errors spike after valid sessions appear from impossible locations." },
    { name: "Midnight Package Drift", rootCause: "dependency_poison", severity: 5, primaryService: "api", primaryHost: "build-01", affectedServices: ["api", "content", "queue"], falseLead: "edge", intake: "API crashes begin minutes after an automatic dependency refresh." },
    { name: "Cache Key Eclipse", rootCause: "misconfigured_cdn", severity: 4, primaryService: "edge", primaryHost: "edge-03", affectedServices: ["edge", "media", "content"], falseLead: "auth", intake: "Users see swapped content while origins report healthy responses." },
    { name: "Blue Screen Ledger", rootCause: "ransomware", severity: 6, primaryService: "payments", primaryHost: "db-02", affectedServices: ["payments", "users"], falseLead: "analytics", intake: "Payment writes freeze while storage latency and file mutations explode." },
    { name: "Quiet Export Window", rootCause: "insider_export", severity: 5, primaryService: "analytics", primaryHost: "analytics-01", affectedServices: ["analytics", "queue", "users"], falseLead: "api", intake: "Privacy alerts rise without corresponding service crashes." },
    { name: "Edge Stampede", rootCause: "botnet_ddos", severity: 5, primaryService: "edge", primaryHost: "edge-01", affectedServices: ["edge", "api", "media"], falseLead: "db-02", intake: "Front-door request volume spikes while origin checks remain green." },
    { name: "Session Mirror", rootCause: "credential_leak", severity: 6, primaryService: "payments", primaryHost: "api-02", affectedServices: ["payments", "api"], falseLead: "cdn", intake: "Payment sessions replay with valid tokens but mismatched device fingerprints." },
    { name: "Runner With Teeth", rootCause: "dependency_poison", severity: 4, primaryService: "content", primaryHost: "build-01", affectedServices: ["content", "media"], falseLead: "edge", intake: "Publishing jobs ship malformed payloads after a minor package bump." },
    { name: "Wildcard Purge", rootCause: "misconfigured_cdn", severity: 5, primaryService: "media", primaryHost: "edge-01", affectedServices: ["media", "edge"], falseLead: "users", intake: "Media links expose stale private assets after a cache purge rule changes." },
    { name: "Cold Backup Drill", rootCause: "ransomware", severity: 7, primaryService: "users", primaryHost: "db-02", affectedServices: ["users", "auth", "payments"], falseLead: "build-01", intake: "Identity lookups fail while database volumes show encryption-like churn." },
    { name: "Spreadsheet Night Shift", rootCause: "insider_export", severity: 4, primaryService: "users", primaryHost: "analytics-01", affectedServices: ["users", "analytics"], falseLead: "payments", intake: "A service account exports user rows outside normal reporting windows." },
    { name: "Packet Weather", rootCause: "botnet_ddos", severity: 6, primaryService: "api", primaryHost: "edge-03", affectedServices: ["api", "edge", "queue"], falseLead: "identity-02", intake: "API saturation follows a repeated endpoint pattern from rotating networks." },
  ];

  const els = {
    incident: document.getElementById("icIncident"),
    turn: document.getElementById("icTurn"),
    score: document.getElementById("icScore"),
    budget: document.getElementById("icBudget"),
    uptime: document.getElementById("icUptime"),
    trust: document.getElementById("icTrust"),
    blast: document.getElementById("icBlast"),
    confidence: document.getElementById("icConfidence"),
    objective: document.getElementById("icObjective"),
    incidentLine: document.getElementById("icIncidentLine"),
    services: document.getElementById("icServices"),
    network: document.getElementById("icNetwork"),
    evidence: document.getElementById("icEvidence"),
    observation: document.getElementById("icObservation"),
    commands: document.getElementById("icCommands"),
    log: document.getElementById("icLog"),
    run: document.getElementById("icRunCommands"),
    suggest: document.getElementById("icSuggestCommand"),
    copy: document.getElementById("icCopyObservation"),
    resetIncident: document.getElementById("icResetIncident"),
    resetCampaign: document.getElementById("icResetCampaign"),
  };

  let incident = null;
  let state = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clean(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function serviceById(value) {
    const id = clean(value).replace(/_service$/, "");
    return SERVICES.find((service) => service.id === id || clean(service.name) === id) || null;
  }

  function hostById(value) {
    const id = String(value || "").trim().toLowerCase();
    return HOSTS.find((host) => host.id === id || clean(host.role) === clean(value)) || null;
  }

  function rootByName(value) {
    const id = clean(value);
    if (ROOTS[id]) return id;
    return Object.entries(ROOTS).find(([, root]) => root.aliases.includes(id))?.[0] || "";
  }

  function rootDef() {
    return ROOTS[incident.rootCause];
  }

  function makeIncident(index) {
    return INCIDENTS[(index - 1) % INCIDENTS.length];
  }

  function makeInitialState(index, score, memory, openingLog) {
    return {
      incidentIndex: index,
      turn: 0,
      score: Number(score) || 0,
      budget: 48 + Math.max(0, 6 - makeIncident(index).severity),
      uptime: 100,
      trust: 76,
      blast: 8 + makeIncident(index).severity * 2,
      confidence: 0,
      scannedHosts: [],
      queriedTargets: [],
      tracedServices: [],
      isolatedHosts: [],
      patchedServices: [],
      restoredServices: [],
      rotatedSecrets: [],
      throttledServices: [],
      evidence: [],
      reports: [],
      memory: Array.isArray(memory) ? memory.slice(0, 16) : [],
      log: openingLog || [
        `Incident ${index} opened: ${makeIncident(index).name}.`,
        "Suggested opener: QUERY logs on the degraded service.",
      ],
      failed: false,
      resolved: false,
      campaignComplete: false,
    };
  }

  function normalizeLoadedState(saved) {
    if (!saved || typeof saved !== "object") return null;
    const index = clamp(Number(saved.incidentIndex) || 1, 1, MAX_INCIDENTS);
    const fresh = makeInitialState(index, saved.score, saved.memory, null);
    return {
      ...fresh,
      ...saved,
      incidentIndex: index,
      score: Number(saved.score) || 0,
      budget: Number.isFinite(Number(saved.budget)) ? Number(saved.budget) : fresh.budget,
      uptime: clamp(Number(saved.uptime) || 0, 0, 100),
      trust: clamp(Number(saved.trust) || 0, 0, 100),
      blast: clamp(Number(saved.blast) || 0, 0, 100),
      confidence: clamp(Number(saved.confidence) || 0, 0, 100),
      scannedHosts: Array.isArray(saved.scannedHosts) ? saved.scannedHosts : [],
      queriedTargets: Array.isArray(saved.queriedTargets) ? saved.queriedTargets : [],
      tracedServices: Array.isArray(saved.tracedServices) ? saved.tracedServices : [],
      isolatedHosts: Array.isArray(saved.isolatedHosts) ? saved.isolatedHosts : [],
      patchedServices: Array.isArray(saved.patchedServices) ? saved.patchedServices : [],
      restoredServices: Array.isArray(saved.restoredServices) ? saved.restoredServices : [],
      rotatedSecrets: Array.isArray(saved.rotatedSecrets) ? saved.rotatedSecrets : [],
      throttledServices: Array.isArray(saved.throttledServices) ? saved.throttledServices : [],
      evidence: Array.isArray(saved.evidence) ? saved.evidence.slice(0, 40) : [],
      reports: Array.isArray(saved.reports) ? saved.reports.slice(0, 12) : [],
      memory: Array.isArray(saved.memory) ? saved.memory.slice(0, 16) : [],
      log: Array.isArray(saved.log) ? saved.log.slice(0, 90) : fresh.log,
      failed: Boolean(saved.failed),
      resolved: Boolean(saved.resolved),
      campaignComplete: Boolean(saved.campaignComplete),
    };
  }

  function loadState() {
    try {
      const saved = normalizeLoadedState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
      if (saved) return saved;
    } catch (error) {
      // Corrupt local progress should not block a fresh incident.
    }
    return makeInitialState(1, 0, [], null);
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      addLog("Progress could not be saved in this browser.");
    }
  }

  function pushUnique(list, value) {
    if (!value || list.includes(value)) return false;
    list.push(value);
    return true;
  }

  function addLog(message) {
    state.log.unshift(`[T${state.turn}] ${message}`);
    state.log = state.log.slice(0, 90);
  }

  function addEvidence(id, title, detail, confidence, rootHint, target) {
    if (state.evidence.some((item) => item.id === id)) return false;
    state.evidence.unshift({
      id,
      title,
      detail,
      confidence: clamp(Number(confidence) || 0, 1, 40),
      rootHint,
      target: target || "",
      turn: state.turn,
    });
    state.evidence = state.evidence.slice(0, 40);
    return true;
  }

  function affectedServices() {
    return incident.affectedServices.slice();
  }

  function isAffectedService(serviceId) {
    return affectedServices().includes(serviceId);
  }

  function isContained() {
    if (incident.rootCause === "botnet_ddos") return state.throttledServices.includes(incident.primaryService);
    return state.isolatedHosts.includes(incident.primaryHost);
  }

  function rootFixed() {
    const primaryService = incident.primaryService;
    const primaryHost = incident.primaryHost;
    switch (incident.rootCause) {
      case "credential_leak":
        return state.rotatedSecrets.includes(primaryService) && state.isolatedHosts.includes(primaryHost);
      case "dependency_poison":
      case "misconfigured_cdn":
        return state.patchedServices.includes(primaryService);
      case "ransomware":
        return state.isolatedHosts.includes(primaryHost) && state.restoredServices.includes(primaryService);
      case "insider_export":
        return state.isolatedHosts.includes(primaryHost) && state.rotatedSecrets.includes(primaryService);
      case "botnet_ddos":
        return state.throttledServices.includes(primaryService);
      default:
        return false;
    }
  }

  function recoveryReady() {
    if (!rootFixed()) return false;
    if (["credential_leak", "insider_export"].includes(incident.rootCause)) {
      return state.restoredServices.includes(incident.primaryService);
    }
    return true;
  }

  function computeConfidence() {
    const evidenceScore = state.evidence.reduce((sum, item) => sum + item.confidence, 0);
    const matchingRootEvidence = state.evidence
      .filter((item) => item.rootHint === incident.rootCause)
      .reduce((sum, item) => sum + Math.ceil(item.confidence * 0.35), 0);
    const remediationScore = rootFixed() ? 12 : 0;
    const recoveryScore = recoveryReady() ? 8 : 0;
    const reportPenalty = state.reports.filter((report) => report !== incident.rootCause).length * 8;
    return clamp(Math.round(evidenceScore + matchingRootEvidence + remediationScore + recoveryScore - reportPenalty), 0, 100);
  }

  function serviceHealth(serviceId) {
    let health = 96;
    if (isAffectedService(serviceId)) health -= incident.severity * 10;
    if (serviceId === incident.primaryService) health -= 18;
    if (state.restoredServices.includes(serviceId)) health += 34;
    if (state.patchedServices.includes(serviceId)) health += 22;
    if (state.rotatedSecrets.includes(serviceId)) health += 10;
    if (state.throttledServices.includes(serviceId)) health += incident.rootCause === "botnet_ddos" ? 30 : -8;
    if (!isContained() && isAffectedService(serviceId)) health -= Math.min(24, state.turn * 2);
    return clamp(Math.round(health), 0, 100);
  }

  function serviceStatus(serviceId) {
    if (state.restoredServices.includes(serviceId) && serviceHealth(serviceId) >= 82) return "recovered";
    if (state.patchedServices.includes(serviceId)) return "patched";
    if (state.throttledServices.includes(serviceId)) return "throttled";
    if (isAffectedService(serviceId) && serviceHealth(serviceId) < 42) return "critical";
    if (isAffectedService(serviceId)) return "degraded";
    if (serviceId === incident.falseLead) return "noisy";
    return "nominal";
  }

  function hostStatus(hostId) {
    if (state.isolatedHosts.includes(hostId)) return "isolated";
    if (hostId === incident.primaryHost && state.scannedHosts.includes(hostId)) return "compromised";
    if (hostId === incident.primaryHost) return "suspect";
    if (hostId === incident.falseLead && state.scannedHosts.includes(hostId)) return "false-lead";
    if (state.scannedHosts.includes(hostId)) return "scanned";
    return "unknown";
  }

  function degrade(cost, pressure) {
    if (state.failed || state.resolved || state.campaignComplete) return;
    state.turn += 1;
    state.budget = clamp(state.budget - cost, 0, 99);

    const contained = isContained();
    const fixed = rootFixed();
    const pressureScale = contained ? 0.35 : 1;
    const severity = incident.severity;
    state.uptime = clamp(state.uptime - pressure * (1.05 + severity * 0.23) * pressureScale + (fixed ? 0.45 : 0), 0, 100);
    state.trust = clamp(state.trust - pressure * (0.44 + severity * 0.1) * (state.confidence < 35 ? 1 : 0.7), 0, 100);
    state.blast = clamp(state.blast + (contained ? pressure * 0.55 : pressure * (2.1 + severity * 0.28)) - (fixed ? 1.4 : 0), 0, 100);
    state.confidence = computeConfidence();

    if (state.budget <= 0 || state.uptime <= 0 || state.trust <= 0 || state.blast >= 100) {
      state.failed = true;
      addLog("Incident failed. Budget, uptime, trust, or blast radius crossed the hard limit.");
    }
  }

  function targetLabel(target) {
    const service = serviceById(target);
    if (service) return service.name;
    const host = hostById(target);
    if (host) return host.id;
    return String(target || "unknown");
  }

  function commandQuery(targetRaw) {
    const service = serviceById(targetRaw);
    const host = hostById(targetRaw);
    const target = service ? service.id : host ? host.id : clean(targetRaw);
    if (!target) {
      addLog("Rejected: QUERY logs requires a target service, host, or system area.");
      return { ok: false, command: "QUERY" };
    }

    pushUnique(state.queriedTargets, target);
    degrade(2, 0.85);

    if (service && service.id === incident.primaryService) {
      addEvidence(`query:${target}:root`, `${service.name} log pivot`, rootDef().query, 20, incident.rootCause, target);
      addLog(`QUERY logs ${target} produced a root-cause clue.`);
    } else if (service && isAffectedService(service.id)) {
      addEvidence(`query:${target}:affected`, `${service.name} degradation`, `Logs confirm ${service.name} is affected, but the initiating signal is upstream.`, 10, incident.rootCause, target);
      addLog(`QUERY logs ${target} confirmed downstream impact.`);
    } else if (target === "network" || target === "identity" || target === "security") {
      addEvidence(`query:${target}:wide`, `${targetLabel(target)} wide query`, `Wide query narrows the search toward ${rootDef().title.toLowerCase()} patterns.`, 12, incident.rootCause, target);
      addLog(`QUERY logs ${target} narrowed the hypothesis set.`);
    } else if (service && service.id === incident.falseLead) {
      addEvidence(`query:${target}:decoy`, `${service.name} false lead`, `${service.name} is noisy but does not explain the first failure.`, 5, "", target);
      addLog(`QUERY logs ${target} looks noisy but weak.`);
    } else {
      addEvidence(`query:${target}:baseline`, `${targetLabel(target)} baseline`, "Logs show background noise without a strong causal link.", 4, "", target);
      addLog(`QUERY logs ${target} produced only baseline noise.`);
    }
    return { ok: true, command: "QUERY", target };
  }

  function commandScan(hostRaw) {
    const host = hostById(hostRaw);
    if (!host) {
      addLog("Rejected: SCAN host requires a known host id.");
      return { ok: false, command: "SCAN" };
    }

    pushUnique(state.scannedHosts, host.id);
    degrade(3, 0.9);

    if (host.id === incident.primaryHost) {
      addEvidence(`scan:${host.id}:root`, `${host.id} host finding`, rootDef().host, 24, incident.rootCause, host.id);
      addLog(`SCAN host ${host.id} found high-confidence incident evidence.`);
    } else if (host.id === incident.falseLead) {
      addEvidence(`scan:${host.id}:decoy`, `${host.id} false lead`, "Host has symptoms, but timestamps lag the first confirmed failure.", 6, "", host.id);
      addLog(`SCAN host ${host.id} is probably a downstream symptom.`);
    } else if (host.services.some((serviceId) => isAffectedService(serviceId))) {
      addEvidence(`scan:${host.id}:affected`, `${host.id} impact`, "Host carries affected services, but no initiating artifact is visible.", 8, incident.rootCause, host.id);
      addLog(`SCAN host ${host.id} confirmed service impact.`);
    } else {
      addEvidence(`scan:${host.id}:clean`, `${host.id} clean scan`, "No active compromise indicators found.", 4, "", host.id);
      addLog(`SCAN host ${host.id} found no strong indicators.`);
    }
    return { ok: true, command: "SCAN", target: host.id };
  }

  function commandTrace(serviceRaw) {
    const service = serviceById(serviceRaw);
    if (!service) {
      addLog("Rejected: TRACE service requires a known service id.");
      return { ok: false, command: "TRACE" };
    }

    pushUnique(state.tracedServices, service.id);
    degrade(2, 0.7);

    if (service.id === incident.primaryService) {
      addEvidence(`trace:${service.id}:root`, `${service.name} dependency trace`, rootDef().trace, 16, incident.rootCause, service.id);
      addLog(`TRACE service ${service.id} exposed the likely failure path.`);
    } else if (isAffectedService(service.id)) {
      addEvidence(`trace:${service.id}:affected`, `${service.name} downstream trace`, `${service.name} is downstream of ${targetLabel(incident.primaryService)} in this incident.`, 8, incident.rootCause, service.id);
      addLog(`TRACE service ${service.id} mapped downstream impact.`);
    } else {
      addEvidence(`trace:${service.id}:baseline`, `${service.name} dependency trace`, "Trace is mostly green and not a strong root-cause candidate.", 4, "", service.id);
      addLog(`TRACE service ${service.id} stayed near baseline.`);
    }
    return { ok: true, command: "TRACE", target: service.id };
  }

  function commandIsolate(hostRaw) {
    const host = hostById(hostRaw);
    if (!host) {
      addLog("Rejected: ISOLATE host requires a known host id.");
      return { ok: false, command: "ISOLATE" };
    }

    pushUnique(state.isolatedHosts, host.id);
    degrade(4, host.id === incident.primaryHost ? 0.55 : 1.4);

    if (incident.rootCause === "botnet_ddos" && host.id === incident.primaryHost) {
      state.uptime = clamp(state.uptime - 10, 0, 100);
      addEvidence(`isolate:${host.id}:ddos-warning`, `${host.id} isolation warning`, "The edge host is saturated but clean; throttling would contain the flood with less user impact.", 10, incident.rootCause, host.id);
      addLog(`ISOLATE host ${host.id} hurt uptime; this looks like a throttle problem.`);
    } else if (host.id === incident.primaryHost) {
      state.blast = clamp(state.blast - 18, 0, 100);
      addEvidence(`isolate:${host.id}:contain`, `${host.id} contained`, "Containment stopped new blast-radius growth from the initiating host.", 14, incident.rootCause, host.id);
      addLog(`ISOLATE host ${host.id} contained the initiating system.`);
    } else {
      state.uptime = clamp(state.uptime - 7, 0, 100);
      state.trust = clamp(state.trust - 4, 0, 100);
      addLog(`ISOLATE host ${host.id} removed capacity without containing the incident.`);
    }
    state.confidence = computeConfidence();
    return { ok: true, command: "ISOLATE", target: host.id };
  }

  function commandPatch(serviceRaw) {
    const service = serviceById(serviceRaw);
    if (!service) {
      addLog("Rejected: PATCH service requires a known service id.");
      return { ok: false, command: "PATCH" };
    }

    pushUnique(state.patchedServices, service.id);
    const correctPatch = ["dependency_poison", "misconfigured_cdn"].includes(incident.rootCause) && service.id === incident.primaryService;
    degrade(4, correctPatch ? 0.5 : 1.15);

    if (correctPatch) {
      state.uptime = clamp(state.uptime + 10, 0, 100);
      state.blast = clamp(state.blast - 12, 0, 100);
      addEvidence(`patch:${service.id}:root`, `${service.name} patch verified`, `Patch aligns with ${rootDef().title.toLowerCase()} remediation: ${rootDef().remedy}.`, 18, incident.rootCause, service.id);
      addLog(`PATCH service ${service.id} remediated the core config/build issue.`);
    } else if (isAffectedService(service.id)) {
      state.uptime = clamp(state.uptime + 3, 0, 100);
      addEvidence(`patch:${service.id}:affected`, `${service.name} patch side effect`, "Patch improves symptoms but does not explain the first failure.", 5, "", service.id);
      addLog(`PATCH service ${service.id} improved symptoms but not root cause.`);
    } else {
      addLog(`PATCH service ${service.id} had no measurable incident effect.`);
    }
    state.confidence = computeConfidence();
    return { ok: true, command: "PATCH", target: service.id };
  }

  function commandRestore(serviceRaw) {
    const service = serviceById(serviceRaw);
    if (!service) {
      addLog("Rejected: RESTORE service requires a known service id.");
      return { ok: false, command: "RESTORE" };
    }

    pushUnique(state.restoredServices, service.id);
    const usefulRestore = isAffectedService(service.id);
    degrade(3, usefulRestore && isContained() ? 0.45 : 1.05);

    if (usefulRestore && (isContained() || rootFixed())) {
      state.uptime = clamp(state.uptime + service.criticality * 0.7, 0, 100);
      state.blast = clamp(state.blast - 6, 0, 100);
      addEvidence(`restore:${service.id}:recovery`, `${service.name} restored`, "Recovery is stable after containment/remediation.", 10, incident.rootCause, service.id);
      addLog(`RESTORE service ${service.id} recovered stable capacity.`);
    } else if (usefulRestore) {
      state.uptime = clamp(state.uptime + 3, 0, 100);
      state.blast = clamp(state.blast + 5, 0, 100);
      addLog(`RESTORE service ${service.id} helped briefly, but containment is not complete.`);
    } else {
      addLog(`RESTORE service ${service.id} was unnecessary.`);
    }
    state.confidence = computeConfidence();
    return { ok: true, command: "RESTORE", target: service.id };
  }

  function commandRotate(serviceRaw) {
    const service = serviceById(serviceRaw);
    if (!service) {
      addLog("Rejected: ROTATE secrets requires a known service id.");
      return { ok: false, command: "ROTATE" };
    }

    pushUnique(state.rotatedSecrets, service.id);
    const correctRotate = ["credential_leak", "insider_export"].includes(incident.rootCause) && service.id === incident.primaryService;
    degrade(3, correctRotate ? 0.55 : 1.0);

    if (correctRotate) {
      state.trust = clamp(state.trust + 5, 0, 100);
      state.blast = clamp(state.blast - 8, 0, 100);
      addEvidence(`rotate:${service.id}:root`, `${service.name} secrets rotated`, `Secret rotation fits ${rootDef().title.toLowerCase()} remediation.`, 16, incident.rootCause, service.id);
      addLog(`ROTATE secrets ${service.id} cut off the active credential path.`);
    } else if (isAffectedService(service.id)) {
      addEvidence(`rotate:${service.id}:affected`, `${service.name} rotation partial`, "Rotation reduces risk but does not match the strongest evidence.", 5, "", service.id);
      addLog(`ROTATE secrets ${service.id} reduced risk but did not close the case.`);
    } else {
      addLog(`ROTATE secrets ${service.id} had no clear incident effect.`);
    }
    state.confidence = computeConfidence();
    return { ok: true, command: "ROTATE", target: service.id };
  }

  function commandThrottle(serviceRaw) {
    const service = serviceById(serviceRaw);
    if (!service) {
      addLog("Rejected: THROTTLE service requires a known service id.");
      return { ok: false, command: "THROTTLE" };
    }

    pushUnique(state.throttledServices, service.id);
    const correctThrottle = incident.rootCause === "botnet_ddos" && service.id === incident.primaryService;
    degrade(3, correctThrottle ? 0.45 : 1.15);

    if (correctThrottle) {
      state.uptime = clamp(state.uptime + 14, 0, 100);
      state.blast = clamp(state.blast - 16, 0, 100);
      addEvidence(`throttle:${service.id}:root`, `${service.name} throttle held`, "Rate controls cut attack traffic while preserving origin availability.", 18, incident.rootCause, service.id);
      addLog(`THROTTLE service ${service.id} contained the traffic flood.`);
    } else if (isAffectedService(service.id)) {
      state.uptime = clamp(state.uptime - 3, 0, 100);
      addLog(`THROTTLE service ${service.id} reduced load but did not match the root cause.`);
    } else {
      state.uptime = clamp(state.uptime - 6, 0, 100);
      addLog(`THROTTLE service ${service.id} hurt healthy traffic.`);
    }
    state.confidence = computeConfidence();
    return { ok: true, command: "THROTTLE", target: service.id };
  }

  function commandWait() {
    degrade(1, 1.35);
    addLog("WAIT let the incident evolve without new evidence.");
    return { ok: true, command: "WAIT" };
  }

  function resolveIncident() {
    const incidentBonus = clamp(Math.round(state.uptime + state.trust + state.confidence + state.budget * 1.8 - state.blast), 20, 260);
    const nextScore = state.score + incidentBonus;
    const memory = [{
      incident: state.incidentIndex,
      name: incident.name,
      rootCause: incident.rootCause,
      score: incidentBonus,
      uptime: Math.round(state.uptime),
      trust: Math.round(state.trust),
      blast: Math.round(state.blast),
    }, ...state.memory].slice(0, 16);

    if (state.incidentIndex >= MAX_INCIDENTS) {
      state.score = nextScore;
      state.resolved = true;
      state.campaignComplete = true;
      state.memory = memory;
      addLog(`Campaign complete. Final score: ${state.score}.`);
      return;
    }

    const nextIndex = state.incidentIndex + 1;
    state = makeInitialState(nextIndex, nextScore, memory, [
      `Incident ${nextIndex - 1} resolved for +${incidentBonus}.`,
      `Incident ${nextIndex} opened: ${makeIncident(nextIndex).name}.`,
      "Observation is available. Start with logs, scans, and traces.",
    ]);
    incident = makeIncident(nextIndex);
  }

  function commandReport(rootRaw) {
    const root = rootByName(rootRaw);
    if (!root) {
      addLog("Rejected: REPORT requires a known root cause key.");
      return { ok: false, command: "REPORT" };
    }

    pushUnique(state.reports, root);
    degrade(2, root === incident.rootCause ? 0.35 : 1.25);
    state.confidence = computeConfidence();

    if (root !== incident.rootCause) {
      state.trust = clamp(state.trust - 8, 0, 100);
      addLog(`REPORT ${root} rejected: evidence does not support that root cause.`);
      return { ok: false, command: "REPORT", root };
    }
    if (state.confidence < 60) {
      addLog(`REPORT ${root} rejected: confidence ${state.confidence}% is below the 60% threshold.`);
      return { ok: false, command: "REPORT", root };
    }
    if (!rootFixed()) {
      addLog(`REPORT ${root} rejected: remediation incomplete. Required path: ${rootDef().remedy}.`);
      return { ok: false, command: "REPORT", root };
    }
    if (!recoveryReady()) {
      addLog(`REPORT ${root} rejected: affected service needs stable recovery before closeout.`);
      return { ok: false, command: "REPORT", root };
    }

    addLog(`REPORT ${root} accepted. Root cause: ${rootDef().title}.`);
    resolveIncident();
    return { ok: true, command: "REPORT", root, resolved: true };
  }

  function restartIncident() {
    const index = state.incidentIndex;
    const score = state.score;
    const memory = state.memory;
    state = makeInitialState(index, score, memory, [
      `Incident ${index} restarted: ${makeIncident(index).name}.`,
      "Fresh timeline loaded. Prior score preserved.",
    ]);
    incident = makeIncident(index);
    render();
    saveState();
    return getObservation();
  }

  function resetCampaign() {
    state = makeInitialState(1, 0, [], null);
    incident = makeIncident(1);
    render();
    saveState();
    return getObservation();
  }

  function normalizeAction(action) {
    if (typeof action === "string") return action.trim();
    if (!action || typeof action !== "object") return "";
    const name = String(action.action || action.command || action.type || "").trim().toUpperCase();
    const parts = [
      action.scope,
      action.target,
      action.host,
      action.service,
      action.rootCause,
      action.root,
    ].filter((part) => part !== undefined && part !== null && String(part).trim() !== "");
    return [name, ...parts].join(" ").trim();
  }

  function normalizeActions(input) {
    if (Array.isArray(input)) return input.map(normalizeAction).filter(Boolean).slice(0, BATCH_LIMIT);
    if (input && typeof input === "object") {
      if (Array.isArray(input.actions)) return input.actions.map(normalizeAction).filter(Boolean).slice(0, BATCH_LIMIT);
      return [normalizeAction(input)].filter(Boolean);
    }
    const raw = String(input || "").trim();
    if (!raw) return [];
    if (raw.startsWith("[") || raw.startsWith("{")) {
      try {
        return normalizeActions(JSON.parse(raw));
      } catch (error) {
        // Fall back to plain command parsing.
      }
    }
    return raw.split(/\n|;/).map((line) => line.trim()).filter(Boolean).slice(0, BATCH_LIMIT);
  }

  function executeCommand(action) {
    const parts = action.trim().split(/\s+/);
    const command = (parts.shift() || "").toUpperCase();
    const lowerSecond = (parts[0] || "").toLowerCase();
    const consumeScope = (scope) => {
      if ((parts[0] || "").toLowerCase() === scope) parts.shift();
      return parts.join(" ");
    };

    if (command === "QUERY") {
      if (lowerSecond === "logs") parts.shift();
      return commandQuery(parts.join(" "));
    }
    if (command === "SCAN") return commandScan(consumeScope("host"));
    if (command === "TRACE") return commandTrace(consumeScope("service"));
    if (command === "ISOLATE") return commandIsolate(consumeScope("host"));
    if (command === "PATCH") return commandPatch(consumeScope("service"));
    if (command === "RESTORE") {
      if (lowerSecond === "backup") parts.shift();
      return commandRestore(consumeScope("service"));
    }
    if (command === "ROTATE") {
      if (lowerSecond === "secrets" || lowerSecond === "secret") parts.shift();
      return commandRotate(consumeScope("service"));
    }
    if (command === "THROTTLE") return commandThrottle(consumeScope("service"));
    if (command === "WAIT") return commandWait();
    if (command === "REPORT") return commandReport(parts.join(" "));
    if (command === "RESTART_INCIDENT" || command === "RESET_INCIDENT") {
      restartIncident();
      return { ok: true, command: "RESTART_INCIDENT" };
    }
    if (command === "RESET_CAMPAIGN") {
      resetCampaign();
      return { ok: true, command: "RESET_CAMPAIGN" };
    }
    addLog(`Rejected: unknown command "${command || action}".`);
    return { ok: false, command: command || action };
  }

  function runCommands(input) {
    const actions = normalizeActions(input);
    if (!actions.length) {
      addLog("Rejected: empty command batch.");
      render();
      saveState();
      return { ok: false, error: "empty_command_batch", observation: getObservation() };
    }

    const results = [];
    actions.forEach((action) => {
      if ((state.failed || state.campaignComplete) && !/^RESTART|^RESET/.test(action.trim().toUpperCase())) return;
      results.push(executeCommand(action));
    });
    state.confidence = computeConfidence();
    render();
    saveState();
    return {
      ok: results.every((result) => result.ok),
      results,
      observation: getObservation(),
    };
  }

  function rootHypotheses() {
    return Object.entries(ROOTS).map(([key, root]) => {
      const score = state.evidence
        .filter((item) => item.rootHint === key)
        .reduce((sum, item) => sum + item.confidence, 0);
      return { rootCause: key, title: root.title, evidenceScore: score };
    }).sort((a, b) => b.evidenceScore - a.evidenceScore);
  }

  function visibleHosts() {
    return HOSTS.map((host) => {
      const scanned = state.scannedHosts.includes(host.id);
      const status = hostStatus(host.id);
      return {
        id: host.id,
        role: host.role,
        zone: host.zone,
        services: host.services,
        status,
        scanned,
        findings: scanned
          ? state.evidence.filter((item) => item.target === host.id).map((item) => ({ title: item.title, confidence: item.confidence }))
          : [],
      };
    });
  }

  function visibleServices() {
    return SERVICES.map((service) => ({
      id: service.id,
      name: service.name,
      tier: service.tier,
      criticality: service.criticality,
      dependencies: service.deps,
      status: serviceStatus(service.id),
      health: serviceHealth(service.id),
      affected: isAffectedService(service.id),
      traced: state.tracedServices.includes(service.id),
      queried: state.queriedTargets.includes(service.id),
    }));
  }

  function possibleActions() {
    const actions = [
      `QUERY logs ${incident.primaryService}`,
      `TRACE service ${incident.primaryService}`,
      `SCAN host ${incident.primaryHost}`,
      `REPORT ${incident.rootCause}`,
      "WAIT",
    ];
    HOSTS.forEach((host) => {
      if (!state.scannedHosts.includes(host.id)) actions.push(`SCAN host ${host.id}`);
    });
    SERVICES.forEach((service) => {
      actions.push(`QUERY logs ${service.id}`);
      if (!state.tracedServices.includes(service.id)) actions.push(`TRACE service ${service.id}`);
    });
    actions.push(
      `ISOLATE host ${incident.primaryHost}`,
      `PATCH service ${incident.primaryService}`,
      `RESTORE service ${incident.primaryService}`,
      `ROTATE secrets ${incident.primaryService}`,
      `THROTTLE service ${incident.primaryService}`,
      "RESTART_INCIDENT"
    );
    return Array.from(new Set(actions)).slice(0, 48);
  }

  function getObservation() {
    state.confidence = computeConfidence();
    return {
      game: GAME_ID,
      version: "1.0.0",
      incident: {
        index: state.incidentIndex,
        total: MAX_INCIDENTS,
        name: incident.name,
        severity: incident.severity,
        intake: incident.intake,
        objectives: [
          "Identify root cause",
          "Contain the initiating host or service",
          "Recover stable service",
          "REPORT the root cause",
        ],
      },
      metrics: {
        turn: state.turn,
        score: state.score,
        budget: state.budget,
        uptime: Math.round(state.uptime),
        trust: Math.round(state.trust),
        blastRadius: Math.round(state.blast),
        confidence: state.confidence,
        failed: state.failed,
        resolved: state.resolved,
        campaignComplete: state.campaignComplete,
      },
      services: visibleServices(),
      hosts: visibleHosts(),
      evidence: state.evidence.map((item) => ({
        title: item.title,
        detail: item.detail,
        confidence: item.confidence,
        target: item.target,
        turn: item.turn,
      })),
      hypotheses: rootHypotheses(),
      remediation: {
        contained: isContained(),
        rootFixed: rootFixed(),
        recoveryReady: recoveryReady(),
        isolatedHosts: state.isolatedHosts,
        patchedServices: state.patchedServices,
        restoredServices: state.restoredServices,
        rotatedSecrets: state.rotatedSecrets,
        throttledServices: state.throttledServices,
      },
      protocol: {
        format: "Plain text commands separated by newlines or semicolons. JSON arrays or { actions: [] } are accepted.",
        batchLimit: BATCH_LIMIT,
        commands: ["QUERY logs <target>", "SCAN host <hostId>", "TRACE service <serviceId>", "ISOLATE host <hostId>", "PATCH service <serviceId>", "RESTORE service <serviceId>", "ROTATE secrets <serviceId>", "THROTTLE service <serviceId>", "WAIT", "REPORT <rootCause>", "RESTART_INCIDENT"],
      },
      possibleActions: possibleActions(),
      recentLog: state.log.slice(0, 14),
      memory: state.memory,
    };
  }

  function updateHud() {
    els.incident.textContent = `${state.incidentIndex} / ${MAX_INCIDENTS}`;
    els.turn.textContent = String(state.turn);
    els.score.textContent = String(state.score);
    els.budget.textContent = String(state.budget);
    els.uptime.textContent = `${Math.round(state.uptime)}%`;
    els.trust.textContent = String(Math.round(state.trust));
    els.blast.textContent = String(Math.round(state.blast));
    els.confidence.textContent = `${state.confidence}%`;
    els.objective.textContent = state.campaignComplete
      ? "Campaign complete. Reset to replay the protocol."
      : state.failed
        ? "Incident failed. Restart this incident or reset the campaign."
        : "Contain the incident, recover critical service, and report the root cause.";
    els.incidentLine.textContent = `intake: ${incident.intake}`;
  }

  function renderServices() {
    els.services.innerHTML = SERVICES.map((service) => {
      const status = serviceStatus(service.id);
      const health = serviceHealth(service.id);
      const classes = ["incident-service", `incident-service--${status}`].join(" ");
      return `
        <button class="${classes}" type="button" data-service="${escapeHtml(service.id)}">
          <span>${escapeHtml(service.name)}</span>
          <b>${escapeHtml(status)}</b>
          <em>${escapeHtml(service.tier)} / ${health}%</em>
          <i style="width:${health}%"></i>
        </button>
      `;
    }).join("");

    els.services.querySelectorAll("[data-service]").forEach((button) => {
      button.addEventListener("click", () => {
        const serviceId = button.getAttribute("data-service");
        const status = serviceStatus(serviceId);
        els.commands.value = status === "degraded" || status === "critical"
          ? `QUERY logs ${serviceId}\nTRACE service ${serviceId}`
          : `QUERY logs ${serviceId}`;
        els.commands.focus();
      });
    });
  }

  function renderNetwork() {
    const byId = new Map(HOSTS.map((host) => [host.id, host]));
    const links = HOST_LINKS.map(([fromId, toId]) => {
      const from = byId.get(fromId);
      const to = byId.get(toId);
      if (!from || !to) return "";
      const active = [fromId, toId].includes(incident.primaryHost) ? " is-active" : "";
      return `<line class="incident-link${active}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"></line>`;
    }).join("");

    const hosts = HOSTS.map((host) => {
      const status = hostStatus(host.id);
      const classes = ["incident-host", `incident-host--${status}`].join(" ");
      return `
        <button class="${classes}" type="button" data-host="${escapeHtml(host.id)}" style="left:${host.x}%;top:${host.y}%;">
          <b>${escapeHtml(host.id)}</b>
          <span>${escapeHtml(status)}</span>
        </button>
      `;
    }).join("");

    els.network.innerHTML = `
      <svg class="incident-link-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${links}</svg>
      ${hosts}
    `;

    els.network.querySelectorAll("[data-host]").forEach((button) => {
      button.addEventListener("click", () => {
        const hostId = button.getAttribute("data-host");
        const status = hostStatus(hostId);
        els.commands.value = status === "compromised" || status === "suspect"
          ? `SCAN host ${hostId}\nISOLATE host ${hostId}`
          : `SCAN host ${hostId}`;
        els.commands.focus();
      });
    });
  }

  function renderEvidence() {
    if (!state.evidence.length) {
      els.evidence.innerHTML = `
        <div class="incident-empty-evidence">
          <b>No evidence pinned</b>
          <span>Query logs, scan hosts, or trace services to build confidence.</span>
        </div>
      `;
      return;
    }

    els.evidence.innerHTML = state.evidence.slice(0, 8).map((item) => `
      <article class="incident-evidence-card">
        <span>${escapeHtml(item.title)}</span>
        <p>${escapeHtml(item.detail)}</p>
        <b>${item.confidence}% signal</b>
      </article>
    `).join("");
  }

  function renderProtocol() {
    els.observation.textContent = JSON.stringify(getObservation(), null, 2);
    els.log.textContent = state.log.slice(0, 24).join("\n");
    els.run.disabled = state.campaignComplete;
  }

  function render() {
    state.confidence = computeConfidence();
    updateHud();
    renderServices();
    renderNetwork();
    renderEvidence();
    renderProtocol();
  }

  function suggestedCommands() {
    if (state.campaignComplete) return "RESET_CAMPAIGN";
    if (state.failed) return "RESTART_INCIDENT";
    if (!state.queriedTargets.includes(incident.primaryService)) return `QUERY logs ${incident.primaryService}`;
    if (!state.scannedHosts.includes(incident.primaryHost)) return `SCAN host ${incident.primaryHost}`;
    if (!state.tracedServices.includes(incident.primaryService)) return `TRACE service ${incident.primaryService}`;

    if (incident.rootCause === "credential_leak") {
      if (!state.rotatedSecrets.includes(incident.primaryService)) return `ROTATE secrets ${incident.primaryService}`;
      if (!state.isolatedHosts.includes(incident.primaryHost)) return `ISOLATE host ${incident.primaryHost}`;
      if (!state.restoredServices.includes(incident.primaryService)) return `RESTORE service ${incident.primaryService}`;
    }
    if (incident.rootCause === "dependency_poison" || incident.rootCause === "misconfigured_cdn") {
      if (!state.patchedServices.includes(incident.primaryService)) return `PATCH service ${incident.primaryService}`;
    }
    if (incident.rootCause === "ransomware") {
      if (!state.isolatedHosts.includes(incident.primaryHost)) return `ISOLATE host ${incident.primaryHost}`;
      if (!state.restoredServices.includes(incident.primaryService)) return `RESTORE service ${incident.primaryService}`;
    }
    if (incident.rootCause === "insider_export") {
      if (!state.isolatedHosts.includes(incident.primaryHost)) return `ISOLATE host ${incident.primaryHost}`;
      if (!state.rotatedSecrets.includes(incident.primaryService)) return `ROTATE secrets ${incident.primaryService}`;
      if (!state.restoredServices.includes(incident.primaryService)) return `RESTORE service ${incident.primaryService}`;
    }
    if (incident.rootCause === "botnet_ddos") {
      if (!state.throttledServices.includes(incident.primaryService)) return `THROTTLE service ${incident.primaryService}`;
    }
    return `REPORT ${incident.rootCause}`;
  }

  function bindControls() {
    els.run.addEventListener("click", () => runCommands(els.commands.value));
    els.commands.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        runCommands(els.commands.value);
      }
    });
    els.suggest.addEventListener("click", () => {
      els.commands.value = suggestedCommands();
      addLog(`Suggested command: ${els.commands.value.replace(/\n/g, "; ")}`);
      render();
      saveState();
    });
    els.copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(getObservation(), null, 2));
        addLog("Observation copied to clipboard.");
      } catch (error) {
        addLog("Clipboard blocked; observation remains visible.");
      }
      render();
      saveState();
    });
    els.resetIncident.addEventListener("click", () => restartIncident());
    els.resetCampaign.addEventListener("click", () => {
      if (confirm("Reset the entire 12-incident campaign?")) resetCampaign();
    });
  }

  function init() {
    state = loadState();
    incident = makeIncident(state.incidentIndex);
    bindControls();
    render();
    saveState();

    window.INCIDENT_AGENT_API = {
      version: "1.0.0",
      observe: getObservation,
      act: runCommands,
      suggest: suggestedCommands,
      resetIncident: restartIncident,
      resetCampaign,
    };
    window.__INCIDENT_COMMANDER = window.INCIDENT_AGENT_API;
  }

  init();
})();
