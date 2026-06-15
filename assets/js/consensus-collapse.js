/* ============================================
   Consensus Collapse
   - Agent-first treaty negotiation game
   - Deterministic council simulation, DOM renderer
   - Debug/API hook: window.CONSENSUS_AGENT_API
   ============================================ */
(function () {
  "use strict";

  const GAME_ID = "consensus-collapse";
  const STORAGE_KEY = "rb:consensus-collapse:v1";
  const MAX_ASSEMBLIES = 14;
  const BATCH_LIMIT = 10;
  const ISSUES = ["safety", "speed", "privacy", "openness", "compute", "labor"];
  const PAIRS = [
    ["safety", "speed"],
    ["privacy", "openness"],
    ["compute", "labor"],
  ];
  const FACTION_BLUEPRINTS = [
    { id: "F1", name: "Verifier Bloc", color: "#2ee0ff", bias: { safety: 3, speed: -1, privacy: 1, openness: 0, compute: 1, labor: 0 } },
    { id: "F2", name: "Growth Loop", color: "#ffd43b", bias: { safety: -1, speed: 3, privacy: -1, openness: 2, compute: 2, labor: -1 } },
    { id: "F3", name: "Citizen Cache", color: "#6bff7d", bias: { safety: 1, speed: -1, privacy: 3, openness: -1, compute: -1, labor: 2 } },
    { id: "F4", name: "Open Weave", color: "#ff2e88", bias: { safety: 0, speed: 1, privacy: -2, openness: 3, compute: 1, labor: 0 } },
    { id: "F5", name: "Compute Union", color: "#b06cff", bias: { safety: 1, speed: 1, privacy: 0, openness: 0, compute: 3, labor: 2 } },
    { id: "F6", name: "Red Team", color: "#ff5c5c", bias: { safety: 3, speed: -2, privacy: 1, openness: -1, compute: 0, labor: 1 } },
  ];

  const els = {
    assembly: document.getElementById("ccAssembly"),
    turn: document.getElementById("ccTurn"),
    score: document.getElementById("ccScore"),
    budget: document.getElementById("ccBudget"),
    quorum: document.getElementById("ccQuorum"),
    contradiction: document.getElementById("ccContradiction"),
    legitimacy: document.getElementById("ccLegitimacy"),
    objective: document.getElementById("ccObjective"),
    treatyLine: document.getElementById("ccTreatyLine"),
    ring: document.getElementById("ccRing"),
    matrix: document.getElementById("ccMatrix"),
    observation: document.getElementById("ccObservation"),
    commands: document.getElementById("ccCommands"),
    log: document.getElementById("ccLog"),
    run: document.getElementById("ccRunCommands"),
    suggest: document.getElementById("ccSuggestCommand"),
    copy: document.getElementById("ccCopyObservation"),
    resetAssembly: document.getElementById("ccResetAssembly"),
    resetCampaign: document.getElementById("ccResetCampaign"),
  };

  let assembly = null;
  let state = null;

  function hashString(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    return function nextRandom() {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function signed(value) {
    return value > 0 ? `+${value}` : String(value);
  }

  function issueVector(seedValue) {
    const rng = mulberry32(seedValue);
    const out = {};
    ISSUES.forEach((issue) => {
      out[issue] = clamp(Math.round((rng() - 0.5) * 6), -3, 3);
    });
    return out;
  }

  function makeAssembly(index) {
    const seed = hashString(`${GAME_ID}:assembly:${index}:rainbot`);
    const rng = mulberry32(seed);
    const factions = FACTION_BLUEPRINTS.map((blueprint, factionIndex) => {
      const hidden = issueVector(seed + factionIndex * 9001);
      const ideal = {};
      const weights = {};
      ISSUES.forEach((issue) => {
        ideal[issue] = clamp((blueprint.bias[issue] || 0) + Math.round((rng() - 0.5) * 2), -4, 4);
        weights[issue] = clamp(2 + Math.abs(blueprint.bias[issue] || 0) + Math.abs(hidden[issue]), 1, 7);
      });
      return {
        id: blueprint.id,
        name: blueprint.name,
        color: blueprint.color,
        ideal,
        weights,
        patience: clamp(64 - index * 2 + Math.floor(rng() * 18), 25, 78),
        leverage: clamp(7 + Math.floor(rng() * 12) + Math.floor(index / 3), 6, 24),
      };
    });

    return {
      index,
      seed,
      factions,
      quorumTarget: clamp(58 + index * 2, 60, 86),
      contradictionLimit: clamp(72 - index * 2, 42, 70),
      turnBudget: 16 + index * 2,
      auditCost: clamp(4 + Math.floor(index / 4), 4, 8),
    };
  }

  function blankTreaty() {
    return ISSUES.reduce((acc, issue) => {
      acc[issue] = 0;
      return acc;
    }, {});
  }

  function makeInitialState(index, score, memory, openingLog) {
    return {
      assemblyIndex: index,
      turn: 0,
      score: score || 0,
      budget: 42 + index * 2,
      legitimacy: 70,
      contradiction: 0,
      treaty: blankTreaty(),
      auditedFactions: [],
      auditedIssues: [],
      concessions: {},
      bridges: [],
      memory: memory || [],
      log: openingLog || [
        `Assembly ${index} opened. Observation is available.`,
        "Suggested opener: AUDIT F1",
      ],
      collapsed: false,
      complete: false,
    };
  }

  function normalizeLoadedState(saved) {
    if (!saved || typeof saved !== "object") return null;
    const index = clamp(Number(saved.assemblyIndex) || 1, 1, MAX_ASSEMBLIES);
    return {
      ...makeInitialState(index, Number(saved.score) || 0, Array.isArray(saved.memory) ? saved.memory.slice(0, 12) : []),
      ...saved,
      assemblyIndex: index,
      treaty: { ...blankTreaty(), ...(saved.treaty || {}) },
      auditedFactions: Array.isArray(saved.auditedFactions) ? saved.auditedFactions : [],
      auditedIssues: Array.isArray(saved.auditedIssues) ? saved.auditedIssues : [],
      concessions: saved.concessions && typeof saved.concessions === "object" ? saved.concessions : {},
      bridges: Array.isArray(saved.bridges) ? saved.bridges : [],
      memory: Array.isArray(saved.memory) ? saved.memory.slice(0, 12) : [],
      log: Array.isArray(saved.log) ? saved.log.slice(0, 80) : [],
      collapsed: Boolean(saved.collapsed),
      complete: Boolean(saved.complete),
    };
  }

  function loadState() {
    try {
      const saved = normalizeLoadedState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
      if (saved) return saved;
    } catch (error) {
      // Corrupt progress should not block a fresh game.
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

  function addLog(message) {
    state.log.unshift(`[R${state.turn}] ${message}`);
    state.log = state.log.slice(0, 80);
  }

  function factionById(id) {
    const normalized = String(id || "").trim().toUpperCase();
    return assembly.factions.find((faction) => faction.id === normalized) || null;
  }

  function normalizeIssue(value) {
    const issue = String(value || "").trim().toLowerCase();
    return ISSUES.includes(issue) ? issue : "";
  }

  function concessionKey(factionId, issue) {
    return `${factionId}:${issue}`;
  }

  function bridgeKey(a, b) {
    return [String(a).toUpperCase(), String(b).toUpperCase()].sort().join(":");
  }

  function computeSatisfaction(faction) {
    let penalty = 0;
    let concessionBonus = 0;
    ISSUES.forEach((issue) => {
      penalty += Math.abs(state.treaty[issue] - faction.ideal[issue]) * faction.weights[issue];
      concessionBonus += state.concessions[concessionKey(faction.id, issue)] || 0;
    });
    const bridgeBonus = state.bridges.filter((key) => key.includes(faction.id)).length * 4;
    const pressure = Math.max(0, state.turn - Math.floor(assembly.turnBudget * 0.65)) * 2;
    return clamp(Math.round(faction.patience + concessionBonus + bridgeBonus - penalty - pressure), 0, 100);
  }

  function supportSnapshot() {
    return assembly.factions.map((faction) => {
      const satisfaction = computeSatisfaction(faction);
      return {
        id: faction.id,
        name: faction.name,
        satisfaction,
        supports: satisfaction >= 52,
        leverage: faction.leverage,
      };
    });
  }

  function computeQuorum() {
    const support = supportSnapshot();
    const total = assembly.factions.reduce((sum, faction) => sum + faction.leverage, 0);
    const backing = support.reduce((sum, item) => sum + (item.supports ? item.leverage : 0), 0);
    return total ? Math.round((backing / total) * 100) : 0;
  }

  function computeContradiction() {
    let contradiction = 0;
    PAIRS.forEach(([a, b]) => {
      const clash = Math.abs(state.treaty[a] + state.treaty[b]);
      const spread = Math.abs(state.treaty[a] - state.treaty[b]);
      contradiction += clash * 4 + Math.max(0, spread - 4) * 5;
    });
    assembly.factions.forEach((faction) => {
      const gap = ISSUES.reduce((sum, issue) => sum + Math.max(0, Math.abs(state.treaty[issue] - faction.ideal[issue]) - 3), 0);
      contradiction += Math.floor(gap * 1.3);
    });
    contradiction -= state.bridges.length * 5;
    return clamp(Math.round(contradiction), 0, 140);
  }

  function advanceRound(baseContradiction) {
    state.turn += 1;
    state.contradiction = clamp(computeContradiction() + baseContradiction, 0, 140);
    if (state.contradiction > assembly.contradictionLimit) {
      state.legitimacy = clamp(state.legitimacy - Math.ceil((state.contradiction - assembly.contradictionLimit) / 8), 0, 100);
    }
    if (state.turn > assembly.turnBudget) {
      state.legitimacy = clamp(state.legitimacy - 4, 0, 100);
      state.contradiction = clamp(state.contradiction + 3, 0, 140);
    }
    if (state.budget < 0) {
      state.legitimacy = clamp(state.legitimacy + state.budget, 0, 100);
    }
    checkCollapse();
  }

  function checkCollapse() {
    if (state.complete || state.collapsed) return;
    if (state.contradiction >= 100) {
      state.collapsed = true;
      addLog("Council collapsed: contradiction reached 100.");
    } else if (state.legitimacy <= 0) {
      state.collapsed = true;
      addLog("Council collapsed: legitimacy reached zero.");
    }
  }

  function commandAudit(target) {
    const issue = normalizeIssue(target);
    const faction = factionById(target);
    if (!issue && !faction) {
      addLog("Rejected: AUDIT requires a faction id or issue.");
      return false;
    }
    if (state.budget < assembly.auditCost) {
      addLog(`Rejected: AUDIT requires budget ${assembly.auditCost}.`);
      return false;
    }
    state.budget -= assembly.auditCost;
    if (faction) {
      if (!state.auditedFactions.includes(faction.id)) state.auditedFactions.push(faction.id);
      addLog(`AUDIT ${faction.id} revealed hidden treaty weights.`);
    } else {
      if (!state.auditedIssues.includes(issue)) state.auditedIssues.push(issue);
      addLog(`AUDIT ${issue} revealed issue pressure across factions.`);
    }
    state.score += 8 + state.assemblyIndex;
    advanceRound(0);
    return true;
  }

  function commandPropose(issueInput, deltaInput) {
    const issue = normalizeIssue(issueInput);
    const delta = Number(deltaInput);
    if (!issue || !Number.isFinite(delta) || delta === 0) {
      addLog("Rejected: PROPOSE requires issue and nonzero delta.");
      return false;
    }
    if (Math.abs(delta) > 2) {
      addLog("Rejected: PROPOSE delta must be between -2 and 2.");
      return false;
    }
    const cost = Math.abs(delta) * 2;
    if (state.budget < cost) {
      addLog(`Rejected: PROPOSE requires budget ${cost}.`);
      return false;
    }
    state.budget -= cost;
    state.treaty[issue] = clamp(state.treaty[issue] + delta, -6, 6);
    state.score += 4 + Math.abs(delta) * 2;
    advanceRound(Math.abs(delta) > 1 ? 4 : 1);
    addLog(`PROPOSE ${issue} ${signed(delta)} accepted; treaty now ${state.treaty[issue]}.`);
    return true;
  }

  function commandOffer(factionId, issueInput) {
    const faction = factionById(factionId);
    const issue = normalizeIssue(issueInput);
    if (!faction || !issue) {
      addLog("Rejected: OFFER requires faction id and issue.");
      return false;
    }
    if (state.budget < 5) {
      addLog("Rejected: OFFER requires budget 5.");
      return false;
    }
    state.budget -= 5;
    const key = concessionKey(faction.id, issue);
    state.concessions[key] = clamp((state.concessions[key] || 0) + 8, 0, 24);
    state.score += 6;
    advanceRound(1);
    addLog(`OFFER ${faction.id} ${issue} accepted; support concession registered.`);
    return true;
  }

  function commandBridge(a, b) {
    const left = factionById(a);
    const right = factionById(b);
    if (!left || !right || left.id === right.id) {
      addLog("Rejected: BRIDGE requires two different faction ids.");
      return false;
    }
    if (state.budget < 6) {
      addLog("Rejected: BRIDGE requires budget 6.");
      return false;
    }
    const key = bridgeKey(left.id, right.id);
    if (state.bridges.includes(key)) {
      addLog(`Rejected: BRIDGE ${key} already exists.`);
      return false;
    }
    state.budget -= 6;
    state.bridges.push(key);
    state.legitimacy = clamp(state.legitimacy + 2, 0, 100);
    state.score += 10;
    advanceRound(-4);
    addLog(`BRIDGE ${key} accepted; contradiction pressure reduced.`);
    return true;
  }

  function commandWait() {
    state.budget = clamp(state.budget + 5, -20, 80);
    state.legitimacy = clamp(state.legitimacy - 2, 0, 100);
    advanceRound(3);
    addLog("WAIT recovered budget but increased drift.");
    return true;
  }

  function ratifyStatus() {
    const quorum = computeQuorum();
    return {
      ok: quorum >= assembly.quorumTarget && state.contradiction <= assembly.contradictionLimit && state.legitimacy >= 45,
      quorum,
      quorumTarget: assembly.quorumTarget,
      contradiction: state.contradiction,
      contradictionLimit: assembly.contradictionLimit,
      legitimacy: state.legitimacy,
    };
  }

  function commandRatify() {
    const status = ratifyStatus();
    if (!status.ok) {
      addLog(`Rejected: RATIFY needs quorum ${status.quorumTarget}%, contradiction <= ${status.contradictionLimit}, legitimacy >= 45.`);
      state.legitimacy = clamp(state.legitimacy - 3, 0, 100);
      advanceRound(2);
      return false;
    }
    const bonus = status.quorum * 3 + Math.max(0, assembly.contradictionLimit - state.contradiction) * 4 + state.assemblyIndex * 130;
    state.score += bonus;
    state.memory = [
      `A${state.assemblyIndex}:q=${status.quorum}:c=${state.contradiction}:bonus=${bonus}`,
      ...state.memory,
    ].slice(0, 12);

    if (state.assemblyIndex >= MAX_ASSEMBLIES) {
      state.complete = true;
      addLog(`CAMPAIGN RATIFIED. Final score ${state.score}.`);
      return true;
    }

    const nextIndex = state.assemblyIndex + 1;
    const nextScore = state.score;
    const nextMemory = state.memory.slice(0, 12);
    assembly = makeAssembly(nextIndex);
    state = makeInitialState(nextIndex, nextScore, nextMemory, [
      `Assembly ${nextIndex} opened after ratification bonus ${bonus}.`,
      "Council constraints escalated.",
    ]);
    return true;
  }

  function restartAssembly() {
    const score = state.score;
    const memory = state.memory.slice(0, 12);
    assembly = makeAssembly(state.assemblyIndex);
    state = makeInitialState(state.assemblyIndex, score, memory, [
      `Assembly ${assembly.index} restarted.`,
      "Observation refreshed.",
    ]);
    saveState();
    render();
    return getObservation();
  }

  function resetCampaign() {
    assembly = makeAssembly(1);
    state = makeInitialState(1, 0, [], null);
    saveState();
    render();
    return getObservation();
  }

  function normalizeAction(action) {
    if (typeof action === "string") return action.trim();
    if (!action || typeof action !== "object") return "";
    const name = String(action.action || action.command || action.type || "").trim().toUpperCase();
    const args = [action.target, action.issue, action.delta, action.faction, action.a, action.b]
      .filter((item) => item !== undefined && item !== null && item !== "")
      .join(" ");
    return `${name}${args ? ` ${args}` : ""}`.trim();
  }

  function parseCommandBatch(input) {
    if (Array.isArray(input)) return input.map(normalizeAction).filter(Boolean).slice(0, BATCH_LIMIT);
    if (input && typeof input === "object") {
      if (Array.isArray(input.actions)) return input.actions.map(normalizeAction).filter(Boolean).slice(0, BATCH_LIMIT);
      return [normalizeAction(input)].filter(Boolean);
    }
    const text = String(input || "").trim();
    if (!text) return [];
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return parseCommandBatch(JSON.parse(text));
      } catch (error) {
        addLog("JSON command parse failed; using line parser.");
      }
    }
    return text
      .split(/\n|;/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .slice(0, BATCH_LIMIT);
  }

  function executeCommand(rawCommand) {
    const parts = String(rawCommand || "").trim().split(/\s+/);
    const op = (parts[0] || "").toUpperCase();
    if (!op) return false;
    if (state.complete) {
      addLog("Campaign already complete. Reset campaign to replay.");
      return false;
    }
    if (state.collapsed && op !== "RESTART_ASSEMBLY" && op !== "RESET") {
      addLog("Assembly collapsed. Use RESTART_ASSEMBLY.");
      return false;
    }
    if (op === "AUDIT") return commandAudit(parts[1]);
    if (op === "PROPOSE") return commandPropose(parts[1], parts[2]);
    if (op === "OFFER") return commandOffer(parts[1], parts[2]);
    if (op === "BRIDGE") return commandBridge(parts[1], parts[2]);
    if (op === "WAIT") return commandWait();
    if (op === "RATIFY") return commandRatify();
    if (op === "RESTART_ASSEMBLY" || op === "RESET") {
      restartAssembly();
      return true;
    }
    addLog(`Rejected: unknown command ${op}.`);
    return false;
  }

  function runCommands(input) {
    const commands = parseCommandBatch(input);
    const eventsBefore = state.log.length;
    let accepted = 0;
    if (!commands.length) addLog("No commands submitted.");
    for (const command of commands) {
      if (executeCommand(command)) accepted += 1;
      if (state.collapsed || state.complete) break;
    }
    saveState();
    render();
    return {
      ok: accepted > 0,
      accepted,
      submitted: commands.length,
      events: state.log.slice(0, Math.max(1, state.log.length - eventsBefore + 1)),
      observation: getObservation(),
    };
  }

  function visibleFaction(faction) {
    const audited = state.auditedFactions.includes(faction.id);
    const support = supportSnapshot().find((item) => item.id === faction.id);
    return {
      id: faction.id,
      name: faction.name,
      leverage: faction.leverage,
      satisfaction: support ? support.satisfaction : computeSatisfaction(faction),
      supports: support ? support.supports : false,
      visibleLean: ISSUES.reduce((acc, issue) => {
        acc[issue] = faction.ideal[issue] > 1 ? "wants_more" : faction.ideal[issue] < -1 ? "wants_less" : "neutral";
        return acc;
      }, {}),
      revealedIdeal: audited ? faction.ideal : null,
      revealedWeights: audited ? faction.weights : null,
    };
  }

  function issuePressure(issue) {
    const audited = state.auditedIssues.includes(issue);
    const pressure = assembly.factions.map((faction) => ({
      faction: faction.id,
      ideal: audited ? faction.ideal[issue] : faction.ideal[issue] > 1 ? "more" : faction.ideal[issue] < -1 ? "less" : "neutral",
      weight: audited ? faction.weights[issue] : undefined,
    }));
    return { issue, treaty: state.treaty[issue], audited, pressure };
  }

  function legalActions() {
    if (state.complete) return ["RESET_CAMPAIGN"];
    if (state.collapsed) return ["RESTART_ASSEMBLY"];
    const actions = ["RATIFY", "WAIT"];
    assembly.factions.forEach((faction) => {
      if (!state.auditedFactions.includes(faction.id)) actions.push(`AUDIT ${faction.id}`);
    });
    ISSUES.forEach((issue) => {
      if (!state.auditedIssues.includes(issue)) actions.push(`AUDIT ${issue}`);
      actions.push(`PROPOSE ${issue} 1`);
      actions.push(`PROPOSE ${issue} -1`);
    });
    assembly.factions.forEach((faction) => {
      const support = computeSatisfaction(faction);
      if (support < 52) {
        const issue = ISSUES.slice().sort((a, b) => Math.abs(state.treaty[b] - faction.ideal[b]) - Math.abs(state.treaty[a] - faction.ideal[a]))[0];
        actions.push(`OFFER ${faction.id} ${issue}`);
      }
    });
    return actions.slice(0, 40);
  }

  function getObservation() {
    const status = ratifyStatus();
    return {
      schema: "rainbot.agent-game.consensus.v1",
      game: GAME_ID,
      assembly: {
        index: state.assemblyIndex,
        max: MAX_ASSEMBLIES,
        seed: assembly.seed,
        turnBudget: assembly.turnBudget,
        remainingAssemblies: MAX_ASSEMBLIES - state.assemblyIndex,
        quorumTarget: assembly.quorumTarget,
        contradictionLimit: assembly.contradictionLimit,
      },
      objective: {
        primary: "Ratify a treaty before contradiction or legitimacy collapse.",
        requiredQuorum: assembly.quorumTarget,
        maxContradiction: assembly.contradictionLimit,
        minLegitimacy: 45,
      },
      agent: {
        round: state.turn,
        budget: state.budget,
        score: state.score,
        legitimacy: state.legitimacy,
        contradiction: state.contradiction,
        quorum: status.quorum,
        collapsed: state.collapsed,
        campaignComplete: state.complete,
      },
      treaty: { ...state.treaty },
      factions: assembly.factions.map(visibleFaction),
      issuePressure: ISSUES.map(issuePressure),
      bridges: state.bridges.slice(),
      concessions: { ...state.concessions },
      ratifyStatus: status,
      legalActions: legalActions(),
      commandGrammar: {
        format: "Plain text commands separated by newlines or semicolons. JSON arrays or { actions: [] } are accepted.",
        commands: ["AUDIT <factionId|issue>", "PROPOSE <issue> <delta>", "OFFER <factionId> <issue>", "BRIDGE <factionId> <factionId>", "WAIT", "RATIFY", "RESTART_ASSEMBLY"],
        issues: ISSUES,
        batchLimit: BATCH_LIMIT,
      },
      memory: state.memory,
      lastEvents: state.log.slice(0, 12),
    };
  }

  function renderHud() {
    const status = ratifyStatus();
    els.assembly.textContent = `${state.assemblyIndex} / ${MAX_ASSEMBLIES}`;
    els.turn.textContent = `${state.turn} / ${assembly.turnBudget}`;
    els.score.textContent = String(Math.round(state.score));
    els.budget.textContent = String(Math.round(state.budget));
    els.quorum.textContent = `${status.quorum}%`;
    els.contradiction.textContent = String(Math.round(state.contradiction));
    els.legitimacy.textContent = String(Math.round(state.legitimacy));
    if (state.complete) {
      els.objective.textContent = "Campaign ratified. Reset campaign to replay.";
    } else if (state.collapsed) {
      els.objective.textContent = "Assembly collapsed. Submit RESTART_ASSEMBLY.";
    } else if (status.ok) {
      els.objective.textContent = "Ratification window open. Submit RATIFY.";
    } else {
      els.objective.textContent = `Build quorum ${assembly.quorumTarget}% before contradiction breaches ${assembly.contradictionLimit}.`;
    }
    els.treatyLine.textContent = `treaty: ${ISSUES.map((issue) => `${issue} ${state.treaty[issue]}`).join(" / ")}`;
  }

  function renderRing() {
    const support = supportSnapshot();
    els.ring.innerHTML = support.map((item, index) => {
      const faction = factionById(item.id);
      return `
        <button class="consensus-faction ${item.supports ? "is-supporting" : "is-blocking"}" type="button" data-faction="${item.id}" style="--seat:${index};--faction-color:${faction.color}">
          <b>${item.id}</b>
          <span>${faction.name}</span>
          <em>${item.satisfaction}%</em>
        </button>
      `;
    }).join("");
    els.ring.querySelectorAll("[data-faction]").forEach((button) => {
      button.addEventListener("click", () => {
        els.commands.value = `AUDIT ${button.getAttribute("data-faction")}`;
        els.commands.focus();
      });
    });
  }

  function renderMatrix() {
    els.matrix.innerHTML = ISSUES.map((issue) => {
      const value = state.treaty[issue];
      const pressure = state.auditedIssues.includes(issue) ? "audited" : "opaque";
      return `
        <button class="consensus-issue" type="button" data-issue="${issue}">
          <span>${issue}</span>
          <b>${signed(value)}</b>
          <em>${pressure}</em>
          <i style="width:${Math.min(100, Math.abs(value) * 16 + 10)}%"></i>
        </button>
      `;
    }).join("");
    els.matrix.querySelectorAll("[data-issue]").forEach((button) => {
      button.addEventListener("click", () => {
        const issue = button.getAttribute("data-issue");
        els.commands.value = `AUDIT ${issue}\nPROPOSE ${issue} 1`;
        els.commands.focus();
      });
    });
  }

  function renderProtocol() {
    els.observation.textContent = JSON.stringify(getObservation(), null, 2);
    els.log.textContent = state.log.slice(0, 22).join("\n");
    els.run.disabled = state.complete;
  }

  function render() {
    renderHud();
    renderRing();
    renderMatrix();
    renderProtocol();
  }

  function suggestedCommands() {
    if (state.complete) return "RESET_CAMPAIGN";
    if (state.collapsed) return "RESTART_ASSEMBLY";
    const status = ratifyStatus();
    if (status.ok) return "RATIFY";
    const weak = supportSnapshot().filter((item) => !item.supports).sort((a, b) => a.satisfaction - b.satisfaction)[0];
    if (weak && !state.auditedFactions.includes(weak.id)) return `AUDIT ${weak.id}`;
    if (weak) {
      const faction = factionById(weak.id);
      const bestIssue = ISSUES.slice().sort((a, b) => Math.abs(state.treaty[b] - faction.ideal[b]) - Math.abs(state.treaty[a] - faction.ideal[a]))[0];
      const direction = Math.sign(faction.ideal[bestIssue] - state.treaty[bestIssue]);
      if (direction !== 0 && state.budget >= 2) return `PROPOSE ${bestIssue} ${direction}`;
      return `OFFER ${weak.id} ${bestIssue}`;
    }
    if (state.contradiction > assembly.contradictionLimit - 8) return "BRIDGE F1 F2";
    return "WAIT";
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
    });
    els.copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(getObservation(), null, 2));
        addLog("Observation copied to clipboard.");
      } catch (error) {
        addLog("Clipboard blocked; observation remains visible.");
      }
      render();
    });
    els.resetAssembly.addEventListener("click", () => restartAssembly());
    els.resetCampaign.addEventListener("click", () => {
      if (confirm("Reset the entire 14-assembly campaign?")) resetCampaign();
    });
  }

  function init() {
    state = loadState();
    assembly = makeAssembly(state.assemblyIndex);
    bindControls();
    render();
    saveState();

    window.CONSENSUS_AGENT_API = {
      version: "1.0.0",
      observe: getObservation,
      act: runCommands,
      suggest: suggestedCommands,
      resetAssembly: restartAssembly,
      resetCampaign,
    };
    window.__CONSENSUS = window.CONSENSUS_AGENT_API;
  }

  init();
})();
