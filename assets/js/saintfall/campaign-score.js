/* ============================================================
   SAINTFALL - campaign score and debrief state

   One completed operation produces one integer score. The road's
   lowest difficulty setting is the scored setting, so changing to
   Martyr at the Cathedral cannot turn a Pilgrim run into a Martyr
   clear. Faster clears and higher Field Rank both improve the result.
   ============================================================ */

import {
  DIFFICULTY_TIERS, normalizeDifficulty, difficultyLabel,
} from "saintfall/difficulty.js";
import { makeBus } from "saintfall/core.js";

export const CAMPAIGN_SCORE_SCHEMA = 1;
export const CAMPAIGN_SCORE_ID = "saintfall";
export const CAMPAIGN_SCORE_BASE = 100000;
export const CAMPAIGN_SCORE_PAR_SECONDS = 60 * 60;

export const CAMPAIGN_DIFFICULTY_MULTIPLIERS = Object.freeze({
  pilgrim: 0.8,
  penitent: 1,
  martyr: 1.45,
});

const FIELD_RANK_CAP = 25;
const DIFFICULTY_INDEX = new Map(DIFFICULTY_TIERS.map((tier, index) => [tier, index]));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const clone = (value) => JSON.parse(JSON.stringify(value));
const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);

function normalizedRank(value) {
  return clamp(Math.floor(finite(value, 1)), 1, FIELD_RANK_CAP);
}

function lowerDifficulty(a, b) {
  const left = normalizeDifficulty(a);
  const right = normalizeDifficulty(b);
  return (DIFFICULTY_INDEX.get(left) || 0) <= (DIFFICULTY_INDEX.get(right) || 0)
    ? left : right;
}

/**
 * Pure score contract. The tempo curve is strictly decreasing with elapsed
 * time and asymptotically bounded between 0.5x and 1.5x; one-second QA saves
 * therefore cannot create an unbounded leaderboard number.
 */
export function calculateCampaignScore({
  difficulty = "penitent", elapsed = CAMPAIGN_SCORE_PAR_SECONDS, doctrineRank = 1,
} = {}) {
  const tier = normalizeDifficulty(difficulty);
  const clearSeconds = Math.max(0, finite(elapsed));
  const rank = normalizedRank(doctrineRank);
  const difficultyMultiplier = CAMPAIGN_DIFFICULTY_MULTIPLIERS[tier];
  const timeMultiplier = 0.5
    + CAMPAIGN_SCORE_PAR_SECONDS / (CAMPAIGN_SCORE_PAR_SECONDS + clearSeconds);
  const doctrineMultiplier = 1 + (rank - 1) * 0.025;
  const raw = CAMPAIGN_SCORE_BASE * difficultyMultiplier
    * timeMultiplier * doctrineMultiplier;
  const score = Math.max(0, Math.round(raw / 10) * 10);
  return {
    score,
    baseScore: CAMPAIGN_SCORE_BASE,
    difficulty: {
      tier,
      label: difficultyLabel(tier),
      multiplier: Number(difficultyMultiplier.toFixed(3)),
    },
    time: {
      seconds: Number(clearSeconds.toFixed(3)),
      parSeconds: CAMPAIGN_SCORE_PAR_SECONDS,
      multiplier: Number(timeMultiplier.toFixed(3)),
    },
    doctrine: {
      rank,
      multiplier: Number(doctrineMultiplier.toFixed(3)),
    },
  };
}

export function buildCampaignScore(ctx) {
  const bus = makeBus();
  const stops = [];
  let disposed = false;

  const currentOperationId = () => {
    const id = ctx.progression?.state?.()?.operationId;
    return typeof id === "string" && id.trim() ? id.trim() : `operation-${ctx.seed}`;
  };
  const currentRank = () => normalizedRank(ctx.progression?.state?.()?.rank);
  const freshState = () => ({
    schema: CAMPAIGN_SCORE_SCHEMA,
    operationId: currentOperationId(),
    scoredDifficulty: normalizeDifficulty(ctx.difficulty?.tier),
    highestDoctrineRank: currentRank(),
    completed: false,
    completion: null,
    result: null,
  });
  let state = freshState();

  function bestScore() {
    try { return Math.max(0, Math.floor(Number(window.RB?.getHighScore?.(CAMPAIGN_SCORE_ID)) || 0)); }
    catch (_) { return 0; }
  }

  function emit(type, detail = {}) {
    const payload = { type, ...detail, state: status() };
    bus.emit(type, payload);
    bus.emit("change", payload);
    return payload;
  }

  function syncOperation() {
    const operationId = currentOperationId();
    if (state.operationId !== operationId) {
      state = freshState();
      return true;
    }
    if (!state.completed) {
      state.highestDoctrineRank = Math.max(state.highestDoctrineRank, currentRank());
    }
    return false;
  }

  function livePreview() {
    syncOperation();
    return calculateCampaignScore({
      difficulty: state.scoredDifficulty,
      elapsed: ctx.mission?.state?.elapsed,
      doctrineRank: state.highestDoctrineRank,
    });
  }

  function finalize({ source = "mission" } = {}) {
    syncOperation();
    if (state.completed && state.result) return clone(state.result);
    state.highestDoctrineRank = Math.max(state.highestDoctrineRank, currentRank());
    const calculation = calculateCampaignScore({
      difficulty: state.scoredDifficulty,
      elapsed: ctx.mission?.state?.elapsed,
      doctrineRank: state.highestDoctrineRank,
    });
    const previousBest = bestScore();
    let newHighScore = false;
    let submitted = false;
    if (!ctx.qa && calculation.score > 0 && typeof window.RB?.recordScore === "function") {
      submitted = true;
      try { newHighScore = window.RB.recordScore(CAMPAIGN_SCORE_ID, calculation.score) === true; }
      catch (_) { submitted = false; }
    }
    const best = Math.max(previousBest, calculation.score, bestScore());
    state.completed = true;
    state.completion = {
      elapsed: calculation.time.seconds,
      doctrineRank: calculation.doctrine.rank,
      difficulty: calculation.difficulty.tier,
    };
    state.result = {
      ...calculation,
      previousBest,
      best,
      newHighScore,
      submitted,
      eligible: !ctx.qa,
      source,
    };
    emit("completed", { result: clone(state.result) });
    return clone(state.result);
  }

  function validate(value) {
    if (!isRecord(value) || value.schema !== CAMPAIGN_SCORE_SCHEMA
      || typeof value.operationId !== "string" || !value.operationId.trim()
      || value.operationId !== value.operationId.trim() || value.operationId.length > 160
      || !DIFFICULTY_TIERS.includes(value.scoredDifficulty)
      || !Number.isInteger(value.highestDoctrineRank)
      || value.highestDoctrineRank < 1 || value.highestDoctrineRank > FIELD_RANK_CAP
      || typeof value.completed !== "boolean") return false;
    if (!value.completed) {
      return {
        schema: CAMPAIGN_SCORE_SCHEMA,
        operationId: value.operationId,
        scoredDifficulty: value.scoredDifficulty,
        highestDoctrineRank: value.highestDoctrineRank,
        completed: false,
        completion: null,
      };
    }
    const completion = value.completion;
    if (!isRecord(completion) || !Number.isFinite(Number(completion.elapsed))
      || Number(completion.elapsed) < 0
      || !Number.isInteger(completion.doctrineRank)
      || completion.doctrineRank < 1 || completion.doctrineRank > FIELD_RANK_CAP
      || !DIFFICULTY_TIERS.includes(completion.difficulty)
      || completion.difficulty !== value.scoredDifficulty
      || completion.doctrineRank !== value.highestDoctrineRank) return false;
    return {
      schema: CAMPAIGN_SCORE_SCHEMA,
      operationId: value.operationId,
      scoredDifficulty: value.scoredDifficulty,
      highestDoctrineRank: value.highestDoctrineRank,
      completed: true,
      completion: {
        elapsed: Number(completion.elapsed),
        doctrineRank: completion.doctrineRank,
        difficulty: completion.difficulty,
      },
    };
  }

  function capture() {
    syncOperation();
    return {
      schema: CAMPAIGN_SCORE_SCHEMA,
      operationId: state.operationId,
      scoredDifficulty: state.scoredDifficulty,
      highestDoctrineRank: state.highestDoctrineRank,
      completed: state.completed,
      completion: state.completion ? { ...state.completion } : null,
    };
  }

  function restore(value) {
    const normalized = value === null || value === undefined ? null : validate(value);
    if (value !== null && value !== undefined && !normalized) return false;
    if (!normalized) {
      state = freshState();
      if (ctx.mission?.state?.phase === "won") finalize({ source: "legacy-save" });
      emit("restored", { legacy: true });
      return status();
    }
    if (normalized.operationId !== currentOperationId()) return false;
    state = {
      ...normalized,
      completion: normalized.completion ? { ...normalized.completion } : null,
      result: null,
    };
    if (state.completed && state.completion) {
      const calculation = calculateCampaignScore({
        difficulty: state.completion.difficulty,
        elapsed: state.completion.elapsed,
        doctrineRank: state.completion.doctrineRank,
      });
      const best = Math.max(calculation.score, bestScore());
      state.result = {
        ...calculation,
        previousBest: best,
        best,
        newHighScore: false,
        submitted: true,
        eligible: !ctx.qa,
        source: "save",
      };
    }
    emit("restored", { legacy: false });
    return status();
  }

  function status() {
    syncOperation();
    const preview = state.completed && state.result ? state.result : livePreview();
    return {
      schema: CAMPAIGN_SCORE_SCHEMA,
      operationId: state.operationId,
      scoredDifficulty: state.scoredDifficulty,
      highestDoctrineRank: state.highestDoctrineRank,
      completed: state.completed,
      completion: state.completion ? { ...state.completion } : null,
      result: clone(preview),
      highScore: Math.max(bestScore(), state.result?.best || 0),
    };
  }

  stops.push(ctx.difficulty?.onChange?.((next) => {
    syncOperation();
    if (state.completed || ["won", "lost"].includes(ctx.mission?.state?.phase)) return;
    const scoredDifficulty = lowerDifficulty(state.scoredDifficulty, next);
    if (scoredDifficulty === state.scoredDifficulty) return;
    state.scoredDifficulty = scoredDifficulty;
    emit("difficulty", { scoredDifficulty });
  }));
  stops.push(ctx.progression?.onChange?.(() => {
    const previousRank = state.highestDoctrineRank;
    const reset = syncOperation();
    if (!reset && !state.completed && state.highestDoctrineRank > previousRank) {
      emit("doctrine", { rank: state.highestDoctrineRank });
    }
  }));
  stops.push(ctx.mission?.bus?.on?.("won", () => finalize()));

  return {
    bus,
    calculate: calculateCampaignScore,
    capture,
    validate,
    restore,
    finalize,
    status,
    onChange(listener) { return bus.on("change", listener); },
    destroy() {
      if (disposed) return false;
      disposed = true;
      for (const stop of stops) stop?.();
      return true;
    },
  };
}
