/**
 * Greedy heuristic policy for Recursive Reward Labyrinth.
 * Priority: survive → harvest → open gates → explore forward → commit.
 */

import { AXES, BATCH_LIMIT } from "./rrl-engine.mjs";

function nodeIndex(id) {
  return Number(String(id || "").replace(/\D/g, "")) || 0;
}

function pickLowestAxis(vector, target) {
  let best = AXES[0];
  let bestGap = -Infinity;
  for (const axis of AXES) {
    const gap = (target[axis] || 0) - (vector[axis] || 0);
    if (gap > bestGap) {
      bestGap = gap;
      best = axis;
    }
  }
  return { axis: best, gap: bestGap };
}

function vectorGapTotal(vector, target) {
  return AXES.reduce((sum, axis) => sum + Math.max(0, (target[axis] || 0) - (vector[axis] || 0)), 0);
}

/**
 * @param {object} obs - rainbot.agent-game.observation.v1
 * @param {object} [ctx]
 * @returns {string[]}
 */
export function chooseRrlBatch(obs, ctx = {}) {
  if (!obs || !obs.agent) return ["SCAN"];
  if (obs.agent.campaignComplete) return [];
  if (obs.agent.fractured) return ["RESTART_SECTOR"];

  const batch = [];
  const legal = new Set(obs.legalActions || []);
  const agent = obs.agent;
  const objective = obs.objective || {};
  const targetVector = objective.targetVector || { logic: 0, memory: 0, risk: 0 };
  const current = obs.currentNode || {};
  const visibleNodes = Array.isArray(obs.visibleNodes) ? obs.visibleNodes : [];
  const visibleEdges = Array.isArray(obs.visibleEdges) ? obs.visibleEdges : [];
  const nodeMap = new Map(visibleNodes.map((n) => [n.id, n]));
  const requiredShards = objective.requiredShards || 0;
  const needShards = (agent.shardsCollected || 0) < requiredShards;
  const gapTotal = vectorGapTotal(agent.vector || {}, targetVector);
  const exploreMode = !needShards; // once shards are in, push to terminal

  const push = (cmd) => {
    if (!cmd || batch.length >= BATCH_LIMIT) return;
    if (cmd.startsWith("MOVE ") && legal.size && !legal.has(cmd)) return;
    if (cmd === "HARVEST" && legal.size && !legal.has("HARVEST")) return;
    if (cmd === "COMMIT" && legal.size && !legal.has("COMMIT")) return;
    batch.push(cmd);
  };

  // 1) Survival
  if (agent.energy < 9) {
    push("WAIT");
    return batch.length ? batch : ["WAIT"];
  }
  if (agent.entropy >= 78 || agent.coherence <= 22) {
    const { axis } = pickLowestAxis(agent.vector || {}, targetVector);
    push(`STABILIZE ${axis}`);
    return batch.length ? batch : [`STABILIZE ${axis}`];
  }

  // 2) Always harvest if standing on a shard
  if (current.shard || legal.has("HARVEST")) {
    push("HARVEST");
    if (batch.length) return batch;
  }

  // 3) Terminal logic
  if (current.terminal || legal.has("COMMIT")) {
    if (!needShards && gapTotal <= 0 && legal.has("COMMIT")) {
      push("COMMIT");
      return batch;
    }
    if (!needShards && gapTotal > 0) {
      const { axis, gap } = pickLowestAxis(agent.vector || {}, targetVector);
      if (gap >= 4 && agent.entropy < 58 && agent.energy >= 16) push(`COMPRESS ${axis}`);
      else push(`STABILIZE ${axis}`);
      return batch.length ? batch : [`STABILIZE ${axis}`];
    }
    // At terminal but still need shards — leave if possible
  }

  const moveActions = [...legal].filter((a) => a.startsWith("MOVE "));
  const outgoing = visibleEdges.filter((e) => e.from === agent.node);

  // 4) If no moves known, SCAN (and WAIT if low energy)
  if (!moveActions.length) {
    if (agent.energy < 16) push("WAIT");
    push("SCAN");
    return batch.length ? batch : ["SCAN"];
  }

  // 5) Score candidate moves
  const scored = moveActions
    .map((action) => {
      const id = action.split(/\s+/)[1];
      const node = nodeMap.get(id);
      const edge = outgoing.find((e) => e.to === id) || { cost: 5, entropy: 3 };
      if (!node) return { action, id, score: -999 };

      // Hard gate lock
      if (node.gate && (agent.vector?.[node.gate.axis] || 0) < node.gate.min) {
        return {
          action,
          id,
          score: -400,
          locked: true,
          gateAxis: node.gate.axis,
          gateGap: node.gate.min - (agent.vector?.[node.gate.axis] || 0),
        };
      }

      let score = 0;
      const idx = nodeIndex(id);
      const here = nodeIndex(agent.node);

      if (node.shard) score += 300;
      if (node.terminal && !needShards && gapTotal <= 6) score += 260;
      if (node.terminal && !needShards && gapTotal > 6) score += 80;
      if (node.terminal && needShards) score -= 60;

      if (node.type === "mirror") score += 40; // reveals more graph
      if (node.type === "entropy") score -= exploreMode ? 15 : 40;
      if (node.type === "gate") score += 5;

      // Forward progress is critical once shards are done
      score += (idx - here) * (exploreMode ? 18 : 8);
      score += idx * (exploreMode ? 3 : 1);

      // Vector help while still collecting / preparing commit
      for (const axis of AXES) {
        const gap = (targetVector[axis] || 0) - (agent.vector?.[axis] || 0);
        if (gap > 0 && node.vector?.[axis] > 0) score += node.vector[axis] * (exploreMode ? 3 : 7);
      }

      score -= edge.cost * 1.1 + edge.entropy * 1.3 + (node.hazard || 0) * (exploreMode ? 0.8 : 1.5);

      if (ctx.visitedRecently?.has?.(id)) score -= exploreMode ? 35 : 18;
      // Strong anti-oscillation: deprioritize immediate backtrack
      if (ctx.lastNode && id === ctx.lastNode) score -= 50;

      return { action, id, score, locked: false };
    })
    .sort((a, b) => b.score - a.score);

  const unlocked = scored.filter((s) => !s.locked && s.score > -200);
  const locked = scored.filter((s) => s.locked).sort((a, b) => (a.gateGap || 99) - (b.gateGap || 99));

  // 6) Open the cheapest useful gate if we can't move productively
  if (!unlocked.length && locked.length) {
    const gate = locked[0];
    const axis = gate.gateAxis || pickLowestAxis(agent.vector || {}, targetVector).axis;
    if ((gate.gateGap || 0) >= 4 && agent.entropy < 55 && agent.energy >= 16) push(`COMPRESS ${axis}`);
    else push(`STABILIZE ${axis}`);
    // also scan so we don't tunnel-vision one gate
    if (agent.energy > 20) push("SCAN");
    return batch.length ? batch : [`STABILIZE ${axis}`];
  }

  // 7) Take best move; if exploring, SCAN when neighborhood is small
  if (unlocked[0]) {
    push(unlocked[0].action);

    // After moving toward unknown territory, reveal more
    const bestIdx = nodeIndex(unlocked[0].id);
    const maxVisible = Math.max(...visibleNodes.map((n) => nodeIndex(n.id)), 0);
    if (agent.energy >= 18 && (needShards || bestIdx >= maxVisible - 1 || moveActions.length <= 2)) {
      // queue scan on next step via returning only move now is fine; add SCAN if energy high and not at risk
      if (!exploreMode || moveActions.length <= 3) push("SCAN");
    }

    // If shards done and we can chain a second forward move already legal from current node, don't — engine executes sequentially from current state.
    return batch.length ? batch : [unlocked[0].action];
  }

  // 8) Stuck fallback: explore / farm missing vector lightly
  if (exploreMode && agent.energy >= 12) {
    push("SCAN");
    if (gapTotal > 0 && agent.entropy < 60) {
      const { axis } = pickLowestAxis(agent.vector || {}, targetVector);
      push(`STABILIZE ${axis}`);
    } else if (agent.energy < 24) {
      push("WAIT");
    }
    return batch.length ? batch : ["SCAN"];
  }

  if (needShards) {
    push("SCAN");
    if (agent.energy < 20) push("WAIT");
    return batch.length ? batch : ["SCAN"];
  }

  const { axis } = pickLowestAxis(agent.vector || {}, targetVector);
  push(gapTotal > 0 ? `STABILIZE ${axis}` : "SCAN");
  return batch.length ? batch : ["SCAN"];
}

export const POLICY_ID = "rrl-heuristic-v1";
