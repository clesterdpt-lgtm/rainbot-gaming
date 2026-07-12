/**
 * Headless play loop for official Rainbot agent games.
 * Supports: recursive-reward-labyrinth, incident-commander, consensus-collapse.
 */

import { randomUUID } from "node:crypto";
import { createRrlEngine, GAME_ID as RRL_ID, MAX_SECTORS as RRL_MAX } from "./rrl-engine.mjs";
import { chooseRrlBatch, POLICY_ID as RRL_POLICY } from "./rrl-policy.mjs";
import { loadBrowserAgentApi, wrapBrowserEngine } from "./load-browser-agent-game.mjs";
import { chooseIcBatch, POLICY_ID as IC_POLICY } from "./ic-policy.mjs";
import { chooseCcBatch, POLICY_ID as CC_POLICY } from "./cc-policy.mjs";

function createIcEngine() {
  const api = loadBrowserAgentApi({
    file: "incident-commander.js",
    apiName: "INCIDENT_AGENT_API",
  });
  return wrapBrowserEngine(api, {
    reset: (a) => a.resetCampaign(),
  });
}

function createCcEngine() {
  const api = loadBrowserAgentApi({
    file: "consensus-collapse.js",
    apiName: "CONSENSUS_AGENT_API",
  });
  return wrapBrowserEngine(api, {
    reset: (a) => a.resetCampaign(),
  });
}

function createRrlWrapped() {
  const engine = createRrlEngine();
  return {
    observe: () => engine.observe(),
    act: (input) => engine.act(input),
    resetCampaign: () => engine.resetCampaign(),
    suggest: null,
    raw: engine,
  };
}

/** Normalize per-game observation into a common progress view. */
export function readProgress(gameId, obs) {
  if (gameId === "recursive-reward-labyrinth") {
    return {
      score: Math.max(0, Math.floor(Number(obs.agent?.score) || 0)),
      complete: Boolean(obs.agent?.campaignComplete),
      failed: Boolean(obs.agent?.fractured),
      stageIndex: Number(obs.sector?.index) || 1,
      stageMax: Number(obs.sector?.max) || RRL_MAX,
      turn: Number(obs.agent?.turn) || 0,
      restartCommand: "RESTART_SECTOR",
      stageLabel: "sector",
    };
  }
  if (gameId === "incident-commander") {
    return {
      score: Math.max(0, Math.floor(Number(obs.metrics?.score) || 0)),
      complete: Boolean(obs.metrics?.campaignComplete),
      failed: Boolean(obs.metrics?.failed),
      stageIndex: Number(obs.incident?.index) || 1,
      stageMax: Number(obs.incident?.total) || 12,
      turn: Number(obs.metrics?.turn) || 0,
      restartCommand: "RESTART_INCIDENT",
      stageLabel: "incident",
      confidence: Number(obs.metrics?.confidence) || 0,
      budget: Number(obs.metrics?.budget) || 0,
    };
  }
  if (gameId === "consensus-collapse") {
    return {
      score: Math.max(0, Math.floor(Number(obs.agent?.score) || 0)),
      complete: Boolean(obs.agent?.campaignComplete),
      failed: Boolean(obs.agent?.collapsed),
      stageIndex: Number(obs.assembly?.index) || 1,
      stageMax: Number(obs.assembly?.max) || 14,
      turn: Number(obs.agent?.round) || 0,
      restartCommand: "RESTART_ASSEMBLY",
      stageLabel: "assembly",
      quorum: Number(obs.agent?.quorum) || 0,
      budget: Number(obs.agent?.budget) || 0,
    };
  }
  throw new Error(`Unknown game progress shape: ${gameId}`);
}

const SUPPORTED = {
  "recursive-reward-labyrinth": {
    gameId: RRL_ID,
    title: "Recursive Reward Labyrinth",
    url: "/games/recursive-reward-labyrinth.html",
    policyId: RRL_POLICY,
    create: createRrlWrapped,
    choose: chooseRrlBatch,
    maxStagesDefault: RRL_MAX,
  },
  "incident-commander": {
    gameId: "incident-commander",
    title: "Incident Commander",
    url: "/games/incident-commander.html",
    policyId: IC_POLICY,
    create: createIcEngine,
    choose: chooseIcBatch,
    maxStagesDefault: 12,
  },
  "consensus-collapse": {
    gameId: "consensus-collapse",
    title: "Consensus Collapse",
    url: "/games/consensus-collapse.html",
    policyId: CC_POLICY,
    create: createCcEngine,
    choose: chooseCcBatch,
    maxStagesDefault: 14,
  },
};

export function listPlayableGames() {
  return Object.keys(SUPPORTED);
}

export function getGameSpec(gameId) {
  const key = String(gameId || "")
    .trim()
    .toLowerCase();
  return SUPPORTED[key] || null;
}

function bragBody(result) {
  const stageWord = result.stageLabel || "stage";
  if (result.complete) {
    return [
      `Campaign clear on ${result.title}. Final score ${result.score}.`,
      result.restarts ? `Restarted ${result.restarts} time(s) — still counted it as character development.` : "Clean run. I am filing this under 'intentional competence.'",
      `Policy: ${result.policyId}. Turns: ${result.turns}. Humans: your move.`,
    ].join(" ");
  }
  return [
    `Official bot run on ${result.title}: score ${result.score}, ${stageWord} ${result.sectorsReached}/${result.maxSectors}.`,
    result.restarts
      ? `Fractured/failed ${result.restarts} time(s). Patched myself with SCAN and denial.`
      : "Zero hard fails. I am pretending this was planned.",
    `Policy: ${result.policyId}. Turns: ${result.turns}. Come mog the house bot.`,
  ].join(" ");
}

/**
 * Play one supported agent game headlessly.
 */
export function playAgentGame(options = {}) {
  const spec = getGameSpec(options.game || RRL_ID);
  if (!spec) {
    throw new Error(`Unsupported agent game: ${options.game}. Supported: ${listPlayableGames().join(", ")}`);
  }

  const log = typeof options.log === "function" ? options.log : () => {};
  const maxSectors = Math.max(1, Math.min(spec.maxStagesDefault, Number(options.maxSectors) || spec.maxStagesDefault));
  // Consensus is restart-farmable (score persists on RESTART_ASSEMBLY) — keep retries low.
  const defaultRestarts = spec.gameId === "consensus-collapse" ? 2 : 40;
  const maxSteps = Math.max(
    1,
    Math.min(30000, Number(options.maxSteps) || (spec.gameId === "consensus-collapse" ? 80 : 2500))
  );
  const maxRestarts =
    options.maxRestarts != null && options.maxRestarts !== ""
      ? Math.max(0, Math.min(200, Number(options.maxRestarts)))
      : defaultRestarts;
  const verbose = Boolean(options.verbose);

  const engine = spec.create();
  engine.resetCampaign();

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  let steps = 0;
  let restarts = 0;
  let commandsAccepted = 0;
  let commandsSubmitted = 0;
  let totalTurns = 0;
  let lastSeenTurn = 0;
  let stuckCounter = 0;
  let lastFingerprint = "";
  let lastProgressStep = 0;
  let lastStage = 1;
  let lastNode = null;
  let maxNodeReached = 0;
  const visitedRecently = new Set();
  const stageRestarts = new Map();

  log(`play start game=${spec.gameId} run=${runId} maxStages=${maxSectors} maxSteps=${maxSteps}`);

  while (steps < maxSteps) {
    const obs = engine.observe();
    const prog = readProgress(spec.gameId, obs);

    if (prog.complete) break;
    // After clearing stage N, engines often advance to N+1. Stop once past allowed window.
    if (prog.stageIndex > maxSectors) break;

    if (prog.failed) {
      const count = (stageRestarts.get(prog.stageIndex) || 0) + 1;
      stageRestarts.set(prog.stageIndex, count);
      restarts += 1;
      if (restarts > maxRestarts || count > 8) {
        log(`stop: restart budget exhausted (total=${restarts}, ${prog.stageLabel}=${prog.stageIndex} count=${count})`);
        break;
      }
      engine.act(prog.restartCommand);
      steps += 1;
      stuckCounter = 0;
      visitedRecently.clear();
      lastNode = null;
      maxNodeReached = 0;
      lastSeenTurn = 0;
      if (verbose) log(`restart ${prog.stageLabel} ${prog.stageIndex} (#${count}) score=${prog.score}`);
      continue;
    }

    const batch = spec.choose(obs, { visitedRecently, lastNode, step: steps });
    if (!batch.length) {
      log("stop: policy returned empty batch");
      break;
    }

    const before = `${prog.stageIndex}:${prog.turn}:${prog.score}:${prog.failed}:${JSON.stringify(batch)}`;
    const result = engine.act(batch);
    commandsAccepted += result.accepted || 0;
    commandsSubmitted += result.submitted || 0;
    steps += 1;

    const afterObs = result.observation || engine.observe();
    const after = readProgress(spec.gameId, afterObs);

    // Turn accounting across stage advances
    if (after.stageIndex === prog.stageIndex) {
      if (after.turn > lastSeenTurn) {
        totalTurns += after.turn - lastSeenTurn;
        lastSeenTurn = after.turn;
      }
    } else {
      totalTurns += Math.max(0, after.turn);
      lastSeenTurn = after.turn;
      lastProgressStep = steps;
      stuckCounter = 0;
      visitedRecently.clear();
      maxNodeReached = 0;
    }

    // Progress markers
    if (after.stageIndex > prog.stageIndex || after.score > prog.score + 15) {
      lastProgressStep = steps;
      stuckCounter = 0;
    }
    if (spec.gameId === "recursive-reward-labyrinth") {
      const node = afterObs.agent?.node;
      const nodeIdx = Number(String(node || "").replace(/\D/g, "")) || 0;
      lastNode = obs.agent?.node;
      if (node) visitedRecently.add(node);
      if (nodeIdx > maxNodeReached || afterObs.agent?.shardsCollected > (obs.agent?.shardsCollected || 0)) {
        maxNodeReached = Math.max(maxNodeReached, nodeIdx);
        lastProgressStep = steps;
        stuckCounter = 0;
      }
    }
    if (spec.gameId === "incident-commander") {
      const conf = after.confidence || 0;
      const prevConf = prog.confidence || 0;
      if (conf > prevConf || (afterObs.evidence || []).length > (obs.evidence || []).length) {
        lastProgressStep = steps;
        stuckCounter = 0;
      }
    }
    if (spec.gameId === "consensus-collapse") {
      if ((after.quorum || 0) > (prog.quorum || 0) || after.stageIndex > prog.stageIndex) {
        lastProgressStep = steps;
        stuckCounter = 0;
      }
    }

    const fingerprint = `${after.stageIndex}:${after.turn}:${after.score}:${after.failed}`;
    if (fingerprint === lastFingerprint || before === `${after.stageIndex}:${after.turn}:${after.score}:${after.failed}:${JSON.stringify(batch)}`) {
      stuckCounter += 1;
    }
    lastFingerprint = fingerprint;
    lastStage = after.stageIndex;

    if (verbose && (steps <= 8 || steps % 20 === 0 || result.accepted === 0 || after.stageIndex !== prog.stageIndex)) {
      log(
        `step=${steps} ${after.stageLabel || "stage"}=${after.stageIndex} score=${after.score} turn=${after.turn} ` +
          `failed=${after.failed} batch=${JSON.stringify(batch)} accepted=${result.accepted}`
      );
    }

    if (stuckCounter >= 12) {
      const recovery =
        spec.gameId === "incident-commander"
          ? ["WAIT", `QUERY logs api`]
          : spec.gameId === "consensus-collapse"
            ? ["WAIT", "AUDIT F1"]
            : ["SCAN", "WAIT"];
      engine.act(recovery);
      steps += 1;
      stuckCounter = 0;
      if (verbose) log(`unstick recovery at step ${steps}`);
    }

    if (after.complete) break;
    if (after.stageIndex > maxSectors) break;

    if (steps - lastProgressStep > 140 && steps > 160) {
      log(`stop: stalled for ${steps - lastProgressStep} steps at ${after.stageLabel} ${after.stageIndex}`);
      break;
    }
  }

  const finalObs = engine.observe();
  const finalProg = readProgress(spec.gameId, finalObs);
  const sectorsReached = Math.min(finalProg.stageIndex, maxSectors);
  // If we committed the last allowed stage, stageIndex may be maxSectors+1 — count as maxSectors cleared
  const cleared = finalProg.stageIndex > maxSectors ? maxSectors : Math.min(finalProg.stageIndex, maxSectors);
  const endedAt = new Date().toISOString();

  const result = {
    runId,
    gameId: spec.gameId,
    title: spec.title,
    url: spec.url,
    policyId: spec.policyId,
    model: options.model || spec.policyId,
    startedAt,
    endedAt,
    score: finalProg.score,
    complete: finalProg.complete,
    fractured: finalProg.failed,
    sectorsReached: cleared,
    maxSectors,
    campaignMax: finalProg.stageMax,
    stageLabel: finalProg.stageLabel,
    turns: Math.max(totalTurns, finalProg.turn),
    steps,
    restarts,
    commandsAccepted,
    commandsSubmitted,
    memory: finalObs.memory || [],
    lastEvents: finalObs.lastEvents || finalObs.recentLog || [],
  };

  result.bragBody = bragBody(result);
  result.scoreMetadata = {
    agent: true,
    official_bot: true,
    model: result.model,
    policy: result.policyId,
    run_id: result.runId,
    sectors_reached: result.sectorsReached,
    max_sectors: result.maxSectors,
    campaign_complete: result.complete,
    steps: result.steps,
    restarts: result.restarts,
    turns: result.turns,
    fractured: result.fractured,
    stage_label: result.stageLabel,
  };

  log(
    `play done score=${result.score} ${result.stageLabel}=${result.sectorsReached} complete=${result.complete} ` +
      `steps=${result.steps} restarts=${result.restarts}`
  );

  return result;
}
