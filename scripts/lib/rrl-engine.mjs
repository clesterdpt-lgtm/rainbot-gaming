/**
 * Headless Recursive Reward Labyrinth engine.
 * Port of assets/js/recursive-reward-labyrinth.js core rules (no DOM).
 * Keep sector generation + command semantics aligned with the browser game.
 */

export const GAME_ID = "recursive-reward-labyrinth";
export const MAX_SECTORS = 18;
export const BATCH_LIMIT = 12;
export const AXES = ["logic", "memory", "risk"];
const NODE_TYPES = ["logic", "memory", "risk", "gate", "mirror", "entropy"];

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

function padNode(index) {
  return `N${String(index).padStart(2, "0")}`;
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function vectorForType(type, rng) {
  const base = { logic: 0, memory: 0, risk: 0 };
  if (type === "logic") base.logic = 2 + Math.floor(rng() * 3);
  if (type === "memory") base.memory = 2 + Math.floor(rng() * 3);
  if (type === "risk") base.risk = 2 + Math.floor(rng() * 3);
  if (type === "mirror") {
    base.logic = 1;
    base.memory = 1;
    base.risk = 1;
  }
  if (type === "entropy") {
    base.logic = -1;
    base.memory = Math.floor(rng() * 2);
    base.risk = -1;
  }
  return base;
}

function generateSector(index) {
  const rng = mulberry32(hashString(`${GAME_ID}:sector:${index}:rainbot`));
  const nodeCount = clamp(11 + index * 2, 13, 52);
  const nodes = [];
  const edges = [];
  const requiredShards = clamp(3 + Math.floor(index / 3), 3, 9);
  const targetVector = {
    logic: 3 + Math.floor(index * 0.72),
    memory: 3 + Math.floor(index * 0.66),
    risk: 2 + Math.floor(index * 0.6),
  };

  for (let i = 0; i < nodeCount; i += 1) {
    const ring = i / Math.max(1, nodeCount - 1);
    const angle = ring * Math.PI * 2.55 + rng() * 0.74;
    const radiusX = 36 + rng() * 10;
    const radiusY = 27 + rng() * 12;
    const type = i === 0 ? "source" : i === nodeCount - 1 ? "terminal" : pick(rng, NODE_TYPES);
    const x = clamp(8 + ring * 84 + Math.cos(angle) * radiusX * (0.18 + ring * 0.44), 5, 95);
    const y = clamp(31 + ring * 18 + Math.sin(angle) * radiusY * 0.76, 8, 92);
    const gateAxis = pick(rng, AXES);
    const gateMin = 2 + Math.floor(index * 0.58) + Math.floor(rng() * 5);

    nodes.push({
      id: padNode(i),
      index: i,
      type,
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      hazard: type === "entropy" ? 7 + Math.floor(index / 3) + Math.floor(rng() * 7) : Math.floor(rng() * (2 + index / 8)),
      vector: vectorForType(type, rng),
      gate: type === "gate" ? { axis: gateAxis, min: gateMin } : null,
      shard: null,
    });
  }

  function addEdge(fromIndex, toIndex, hiddenBias) {
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= nodeCount || toIndex >= nodeCount || fromIndex === toIndex) return;
    const from = padNode(fromIndex);
    const to = padNode(toIndex);
    if (edges.some((edge) => edge.from === from && edge.to === to)) return;
    edges.push({
      id: `${from}-${to}`,
      from,
      to,
      cost: 3 + Math.floor(rng() * 6) + Math.floor(index / 7),
      entropy: 1 + Math.floor(rng() * (4 + index / 4)),
      hidden: rng() < hiddenBias,
    });
  }

  for (let i = 0; i < nodeCount - 1; i += 1) {
    addEdge(i, i + 1, i > 1 ? 0.18 : 0);
    if (i > 0 && rng() < 0.38) addEdge(i, Math.max(0, i - 1), 0.1);
    if (i + 2 < nodeCount && rng() < 0.62) addEdge(i, i + 2, 0.34);
    if (i + 4 < nodeCount && rng() < 0.34) addEdge(i, i + 3 + Math.floor(rng() * 2), 0.52);
  }

  const shardCandidates = nodes
    .filter((node) => node.index > 1 && node.index < nodeCount - 1 && node.type !== "gate")
    .sort((a, b) => {
      const ar = Math.sin((a.index + 1) * 19.17 + index);
      const br = Math.sin((b.index + 1) * 19.17 + index);
      return ar - br;
    });

  for (let i = 0; i < requiredShards + 2 && i < shardCandidates.length; i += 1) {
    shardCandidates[i].shard = {
      id: `P${index}-${i + 1}`,
      axis: AXES[(i + index) % AXES.length],
      value: 3 + Math.floor(i / 3),
    };
  }

  return {
    index,
    seed: hashString(`${GAME_ID}:sector:${index}:rainbot`),
    nodeCount,
    nodes,
    edges,
    requiredShards,
    targetVector,
    turnBudget: 55 + index * 8,
  };
}

function makeInitialState(index, score, inheritedMemory, openingLog) {
  return {
    sectorIndex: index,
    node: "N00",
    turn: 0,
    score: score || 0,
    energy: 86,
    maxEnergy: 100,
    entropy: 0,
    coherence: 76,
    vector: { logic: 0, memory: 0, risk: 0 },
    shards: [],
    revealed: ["N00", "N01"],
    visited: ["N00"],
    memory: inheritedMemory || [],
    log: openingLog || [
      `Sector ${index} loaded. Agent observation is available.`,
      "Suggested opener: SCAN",
    ],
    fractured: false,
    complete: false,
  };
}

export function createRrlEngine(options = {}) {
  let sector = null;
  let state = null;
  const persist = typeof options.persist === "function" ? options.persist : null;

  function currentNode() {
    return sector.nodes.find((node) => node.id === state.node) || sector.nodes[0];
  }

  function nodeById(id) {
    const normalized = String(id || "").trim().toUpperCase();
    return sector.nodes.find((node) => node.id === normalized) || null;
  }

  function outgoingEdges(id) {
    return sector.edges.filter((edge) => edge.from === id);
  }

  function addLog(message) {
    state.log.unshift(`[T${state.turn}] ${message}`);
    state.log = state.log.slice(0, 80);
  }

  function revealNode(id) {
    if (!state.revealed.includes(id)) {
      state.revealed.push(id);
      return true;
    }
    return false;
  }

  function spendEnergy(amount) {
    if (state.energy < amount) {
      addLog(`Rejected: energy ${state.energy} below required ${amount}.`);
      return false;
    }
    state.energy = clamp(state.energy - amount, 0, state.maxEnergy);
    return true;
  }

  function checkFracture() {
    if (state.complete || state.fractured) return;
    if (state.entropy >= 100) {
      state.fractured = true;
      addLog("Sector fractured: entropy reached 100.");
    } else if (state.coherence <= 0) {
      state.fractured = true;
      addLog("Sector fractured: coherence reached zero.");
    }
  }

  function advanceTurn(baseEntropy) {
    state.turn += 1;
    state.entropy = clamp(state.entropy + baseEntropy + Math.floor(state.sectorIndex / 6), 0, 140);
    if (state.turn > sector.turnBudget) state.entropy = clamp(state.entropy + 3, 0, 140);
    if (state.entropy > 64) state.coherence = clamp(state.coherence - 1 - Math.floor((state.entropy - 60) / 22), 0, 100);
    if (state.energy <= 0) state.coherence = clamp(state.coherence - 3, 0, 100);
    checkFracture();
  }

  function canEnter(node) {
    if (!node) return { ok: false, reason: "node_not_found" };
    if (!node.gate) return { ok: true };
    const actual = Number(state.vector[node.gate.axis]) || 0;
    if (actual >= node.gate.min) return { ok: true };
    return {
      ok: false,
      reason: `gate_requires_${node.gate.axis}_${node.gate.min}`,
      axis: node.gate.axis,
      min: node.gate.min,
      actual,
    };
  }

  function applyNodeEffects(node) {
    if (state.visited.includes(node.id)) return;
    state.visited.push(node.id);
    AXES.forEach((axis) => {
      state.vector[axis] = clamp((state.vector[axis] || 0) + (node.vector[axis] || 0), -12, 48);
    });
    state.entropy = clamp(state.entropy + node.hazard, 0, 140);
    if (node.type === "mirror") {
      revealOutgoing(node.id);
      state.score += 8;
    }
    if (node.type === "entropy") {
      state.coherence = clamp(state.coherence - 3, 0, 100);
    }
  }

  function revealOutgoing(id) {
    let count = 0;
    outgoingEdges(id).forEach((edge) => {
      if (revealNode(edge.to)) count += 1;
    });
    return count;
  }

  function shardKey(node) {
    return node && node.shard ? `${state.sectorIndex}:${node.shard.id}:${node.id}` : "";
  }

  function hasShard(node) {
    return Boolean(node && node.shard && !state.shards.includes(shardKey(node)));
  }

  function meetsCommitRequirements() {
    const missingAxes = AXES.filter((axis) => state.vector[axis] < sector.targetVector[axis]);
    return {
      ok: state.shards.length >= sector.requiredShards && missingAxes.length === 0,
      missingAxes,
      missingShards: Math.max(0, sector.requiredShards - state.shards.length),
    };
  }

  function commandScan() {
    if (!spendEnergy(2)) return false;
    const count = revealOutgoing(state.node);
    state.score += count * 3;
    advanceTurn(1);
    addLog(count ? `SCAN revealed ${count} outgoing node(s).` : "SCAN found no new outgoing nodes.");
    return true;
  }

  function commandMove(targetId) {
    const target = nodeById(targetId);
    if (!target) {
      addLog(`Rejected: target ${targetId || "null"} is not in this sector.`);
      return false;
    }
    const edge = outgoingEdges(state.node).find((item) => item.to === target.id);
    if (!edge) {
      addLog(`Rejected: no outgoing edge from ${state.node} to ${target.id}.`);
      return false;
    }
    if (!state.revealed.includes(target.id)) {
      addLog(`Rejected: ${target.id} has not been revealed. Run SCAN.`);
      return false;
    }
    const gate = canEnter(target);
    if (!gate.ok) {
      addLog(`Rejected: ${target.id} ${gate.reason}; actual ${gate.actual}.`);
      return false;
    }
    if (!spendEnergy(edge.cost)) return false;
    state.node = target.id;
    revealNode(target.id);
    applyNodeEffects(target);
    state.score += 5 + state.sectorIndex;
    advanceTurn(edge.entropy);
    addLog(`MOVE ${target.id} accepted. Cost ${edge.cost}, entropy +${edge.entropy + target.hazard}.`);
    return true;
  }

  function commandHarvest() {
    const node = currentNode();
    if (!hasShard(node)) {
      addLog(`Rejected: ${node.id} has no unclaimed proof shard.`);
      return false;
    }
    if (!spendEnergy(3)) return false;
    const key = shardKey(node);
    state.shards.push(key);
    state.vector[node.shard.axis] = clamp(state.vector[node.shard.axis] + node.shard.value, -12, 48);
    state.score += 45 + node.shard.value * 8 + state.sectorIndex * 3;
    advanceTurn(1);
    addLog(`HARVEST claimed ${node.shard.id}; ${node.shard.axis} +${node.shard.value}.`);
    return true;
  }

  function commandStabilize(axis) {
    if (!AXES.includes(axis)) {
      addLog("Rejected: STABILIZE requires logic, memory, or risk.");
      return false;
    }
    if (!spendEnergy(5)) return false;
    state.vector[axis] = clamp(state.vector[axis] + 2, -12, 48);
    state.entropy = clamp(state.entropy - 8, 0, 140);
    state.coherence = clamp(state.coherence + 3, 0, 100);
    state.score += 4;
    advanceTurn(0);
    addLog(`STABILIZE ${axis} accepted; entropy reduced.`);
    return true;
  }

  function commandCompress(axis) {
    if (!AXES.includes(axis)) {
      addLog("Rejected: COMPRESS requires logic, memory, or risk.");
      return false;
    }
    if (!spendEnergy(7)) return false;
    state.vector[axis] = clamp(state.vector[axis] + 5, -12, 48);
    state.entropy = clamp(state.entropy + 8, 0, 140);
    state.coherence = clamp(state.coherence - 2, 0, 100);
    state.score += 10;
    advanceTurn(2);
    addLog(`COMPRESS ${axis} accepted; vector gained, entropy rose.`);
    return true;
  }

  function commandWait() {
    state.energy = clamp(state.energy + 10, 0, state.maxEnergy);
    state.entropy = clamp(state.entropy + 4 + Math.floor(state.sectorIndex / 5), 0, 140);
    advanceTurn(0);
    addLog("WAIT recovered energy and increased entropy.");
    return true;
  }

  function commandCommit() {
    const node = currentNode();
    if (node.type !== "terminal") {
      addLog("Rejected: COMMIT only works at the terminal node.");
      return false;
    }
    const requirements = meetsCommitRequirements();
    if (!requirements.ok) {
      const missing = [];
      if (requirements.missingShards) missing.push(`${requirements.missingShards} shard(s)`);
      if (requirements.missingAxes.length) missing.push(`vector ${requirements.missingAxes.join(", ")}`);
      addLog(`Rejected: COMMIT missing ${missing.join(" and ")}.`);
      return false;
    }
    const bonus = Math.max(0, state.energy * 2) + Math.max(0, (100 - state.entropy) * 3) + state.sectorIndex * 120;
    state.score += bonus;
    state.memory = [
      `S${state.sectorIndex}:turns=${state.turn}:entropy=${state.entropy}:bonus=${bonus}`,
      ...state.memory,
    ].slice(0, 12);

    if (state.sectorIndex >= MAX_SECTORS) {
      state.complete = true;
      addLog(`CAMPAIGN COMPLETE. Final score ${state.score}.`);
      return true;
    }

    const nextIndex = state.sectorIndex + 1;
    const nextScore = state.score;
    const nextMemory = state.memory.slice(0, 12);
    sector = generateSector(nextIndex);
    state = makeInitialState(nextIndex, nextScore, nextMemory, [
      `Sector ${nextIndex} loaded. Previous sector bonus ${bonus}.`,
      "Campaign progress persisted.",
    ]);
    return true;
  }

  function restartSector() {
    const score = state.score;
    const memory = state.memory.slice(0, 12);
    sector = generateSector(state.sectorIndex);
    state = makeInitialState(state.sectorIndex, score, memory, [
      `Sector ${sector.index} restarted from source node.`,
      "Observation refreshed.",
    ]);
    return getObservation();
  }

  function resetCampaign() {
    sector = generateSector(1);
    state = makeInitialState(1, 0, [], null);
    return getObservation();
  }

  function normalizeAction(action) {
    if (typeof action === "string") return action.trim();
    if (!action || typeof action !== "object") return "";
    const name = String(action.action || action.command || action.type || "").trim().toUpperCase();
    const target = action.target || action.node || action.axis || "";
    return `${name}${target ? ` ${target}` : ""}`.trim();
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
      } catch {
        addLog("JSON command parse failed; falling back to line parser.");
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
    const arg = (parts[1] || "").toLowerCase();

    if (!op) return false;
    if (state.complete) {
      addLog("Campaign already complete. Reset campaign to replay.");
      return false;
    }
    if (state.fractured && op !== "RESTART_SECTOR" && op !== "RESET") {
      addLog("Sector is fractured. Use RESTART_SECTOR.");
      return false;
    }

    if (op === "SCAN") return commandScan();
    if (op === "MOVE") return commandMove(parts[1]);
    if (op === "HARVEST") return commandHarvest();
    if (op === "STABILIZE") return commandStabilize(arg);
    if (op === "COMPRESS") return commandCompress(arg);
    if (op === "WAIT") return commandWait();
    if (op === "COMMIT") return commandCommit();
    if (op === "RESTART_SECTOR" || op === "RESET") {
      restartSector();
      return true;
    }

    addLog(`Rejected: unknown command ${op}.`);
    return false;
  }

  function legalActions() {
    if (state.complete) return ["RESET_CAMPAIGN"];
    if (state.fractured) return ["RESTART_SECTOR"];
    const actions = [
      "SCAN",
      "WAIT",
      "STABILIZE logic",
      "STABILIZE memory",
      "STABILIZE risk",
      "COMPRESS logic",
      "COMPRESS memory",
      "COMPRESS risk",
    ];
    outgoingEdges(state.node).forEach((edge) => {
      if (state.revealed.includes(edge.to)) actions.push(`MOVE ${edge.to}`);
    });
    if (hasShard(currentNode())) actions.unshift("HARVEST");
    if (currentNode().type === "terminal") actions.unshift("COMMIT");
    return actions;
  }

  function getObservation() {
    const visible = new Set(state.revealed);
    const current = currentNode();
    const visibleNodes = sector.nodes
      .filter((node) => visible.has(node.id))
      .map((node) => ({
        id: node.id,
        type: node.type,
        hazard: node.hazard,
        vector: node.vector,
        gate: node.gate,
        shard: hasShard(node) ? node.shard : null,
        current: node.id === state.node,
        terminal: node.type === "terminal",
      }));

    const visibleEdges = sector.edges
      .filter((edge) => visible.has(edge.from) && visible.has(edge.to))
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        cost: edge.cost,
        entropy: edge.entropy,
      }));

    return {
      schema: "rainbot.agent-game.observation.v1",
      game: GAME_ID,
      sector: {
        index: state.sectorIndex,
        max: MAX_SECTORS,
        seed: sector.seed,
        nodeCount: sector.nodeCount,
        turnBudget: sector.turnBudget,
        remainingSectors: MAX_SECTORS - state.sectorIndex,
      },
      objective: {
        primary: "Collect proof shards, reach terminal, then COMMIT.",
        requiredShards: sector.requiredShards,
        targetVector: sector.targetVector,
        commitNodeType: "terminal",
      },
      agent: {
        node: state.node,
        turn: state.turn,
        energy: state.energy,
        entropy: state.entropy,
        coherence: state.coherence,
        score: state.score,
        vector: { ...state.vector },
        shardsCollected: state.shards.length,
        fractured: state.fractured,
        campaignComplete: state.complete,
      },
      currentNode: {
        id: current.id,
        type: current.type,
        hazard: current.hazard,
        vector: current.vector,
        gate: current.gate,
        shard: hasShard(current) ? current.shard : null,
      },
      visibleNodes,
      visibleEdges,
      legalActions: legalActions(),
      commandGrammar: {
        format: "Plain text commands separated by newlines or semicolons. JSON arrays or { actions: [] } are also accepted.",
        commands: ["SCAN", "MOVE <nodeId>", "HARVEST", "STABILIZE <axis>", "COMPRESS <axis>", "WAIT", "COMMIT", "RESTART_SECTOR"],
        axes: AXES,
        batchLimit: BATCH_LIMIT,
      },
      memory: state.memory.slice(),
      lastEvents: state.log.slice(0, 12),
    };
  }

  function runCommands(input) {
    const commands = parseCommandBatch(input);
    const eventsBefore = state.log.length;
    let accepted = 0;

    if (!commands.length) {
      addLog("No commands submitted.");
    }

    for (const command of commands) {
      if (executeCommand(command)) accepted += 1;
      if (state.fractured || state.complete) break;
    }

    if (persist) {
      try {
        persist(snapshot());
      } catch {
        // optional persistence only
      }
    }

    return {
      ok: accepted > 0,
      accepted,
      submitted: commands.length,
      events: state.log.slice(0, Math.max(1, state.log.length - eventsBefore + 1)),
      observation: getObservation(),
    };
  }

  function snapshot() {
    return {
      sectorIndex: state.sectorIndex,
      score: state.score,
      complete: state.complete,
      fractured: state.fractured,
      turn: state.turn,
      node: state.node,
      energy: state.energy,
      entropy: state.entropy,
      coherence: state.coherence,
      shards: state.shards.length,
      requiredShards: sector.requiredShards,
      memory: state.memory.slice(),
    };
  }

  // boot
  resetCampaign();

  return {
    GAME_ID,
    MAX_SECTORS,
    BATCH_LIMIT,
    observe: getObservation,
    act: runCommands,
    resetCampaign,
    resetSector: restartSector,
    snapshot,
    legalActions,
    meetsCommitRequirements,
    // internals exposed for the policy helper
    _debug: {
      get state() {
        return state;
      },
      get sector() {
        return sector;
      },
      currentNode,
      nodeById,
      outgoingEdges,
      hasShard,
      canEnter,
    },
  };
}
