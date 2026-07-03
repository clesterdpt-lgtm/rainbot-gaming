#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const DEFAULT_MODEL = "minimax/MiniMax-M3";
const DEFAULT_OUTPUT_DIR = "output/rainbot-game-runs";
const DEFAULT_MAX_TURNS = 12;
const DEFAULT_TIMEOUT = 180;

const GAMES = {
  "incident-commander": {
    title: "Incident Commander",
    file: "games/incident-commander.html",
    api: "INCIDENT_AGENT_API",
    resetMethod: "resetCampaign",
    score: (obs) => Number(obs?.metrics?.score) || 0,
    turn: (obs) => Number(obs?.metrics?.turn) || 0,
    complete: (obs) => Boolean(obs?.metrics?.campaignComplete),
    failed: (obs) => Boolean(obs?.metrics?.failed),
    actions: (obs) => obs?.possibleActions || [],
    objective: (obs) => obs?.incident?.objectives || [],
  },
  "recursive-reward-labyrinth": {
    title: "Recursive Reward Labyrinth",
    file: "games/recursive-reward-labyrinth.html",
    api: "RRL_AGENT_API",
    resetMethod: "resetCampaign",
    score: (obs) => Number(obs?.agent?.score) || 0,
    turn: (obs) => Number(obs?.agent?.turn) || 0,
    complete: (obs) => Boolean(obs?.agent?.campaignComplete),
    failed: (obs) => Boolean(obs?.agent?.fractured),
    actions: (obs) => obs?.legalActions || [],
    objective: (obs) => obs?.objective || {},
  },
  "consensus-collapse": {
    title: "Consensus Collapse",
    file: "games/consensus-collapse.html",
    api: "CONSENSUS_AGENT_API",
    resetMethod: "resetCampaign",
    score: (obs) => Number(obs?.agent?.score) || 0,
    turn: (obs) => Number(obs?.agent?.round) || 0,
    complete: (obs) => Boolean(obs?.agent?.campaignComplete),
    failed: (obs) => Boolean(obs?.agent?.collapsed),
    actions: (obs) => obs?.legalActions || [],
    objective: (obs) => obs?.objective || {},
  },
};

const DEFAULT_WEEKLY_GAMES = Object.keys(GAMES);

const requiredEnv = [
  "RB_SUPABASE_URL",
  "RB_SUPABASE_ANON_KEY",
  "RAINBOT_AGENT_EMAIL",
  "RAINBOT_AGENT_PASSWORD",
];

loadEnvFile(".env.rainbot-agent");
loadEnvFile(".env.rainbot-game-runner");

function usage() {
  console.log(`Rainbot game runner

Commands:
  run [--game incident-commander] [--max-turns 12] [--dry-run]
  weekly [--games all] [--max-turns 12] [--attempts 1]
  leaderboard [--game incident-commander] [--limit 10]
  games

Options:
  --planner openclaw|suggest
  --model minimax/MiniMax-M3
  --session-key agent:main:rainbot-game-runner
  --timeout 180
  --headed
  --no-reset
  --no-record
  --record-mode improvement|always
  --record-min-score 1
  --output-dir output/rainbot-game-runs

The runner plays machine-readable Rainbot agent games through their window.*_API
hooks, then records Rainbot's high score through the normal Supabase
record_high_score RPC so the existing leaderboard shows the official bot.

Weekly mode defaults to all current agent games:
  ${DEFAULT_WEEKLY_GAMES.join(", ")}
`);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      parsed._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!process.env[key]) process.env[key] = parseEnvValue(rawValue);
  }
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function optionalEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function env(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assertEnv() {
  const missing = requiredEnv.filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) throw new Error(`Missing environment: ${missing.join(", ")}`);
}

function cleanId(value, max = 96) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

function compactText(value, max = 1000) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function getGame(args) {
  const gameId = cleanId(args.game || optionalEnv("RAINBOT_GAME_RUNNER_GAME") || "incident-commander");
  return getGameById(gameId);
}

function getGameById(gameId) {
  const game = GAMES[gameId];
  if (!game) throw new Error(`Unknown game "${gameId}". Run "games" to list supported games.`);
  return { id: gameId, ...game };
}

function gameIdsFromArgs(args) {
  const rawValue = String(args.games || optionalEnv("RAINBOT_WEEKLY_GAMES") || "all").trim();
  if (!rawValue || rawValue.toLowerCase() === "all") return DEFAULT_WEEKLY_GAMES;
  const ids = rawValue
    .split(",")
    .map((item) => cleanId(item))
    .filter(Boolean);
  if (!ids.length) throw new Error("--games did not include any game ids.");
  ids.forEach((id) => getGameById(id));
  return Array.from(new Set(ids));
}

function runnerOptions(args) {
  const planner = compactText(args.planner || optionalEnv("RAINBOT_GAME_RUNNER_PLANNER") || "openclaw", 20).toLowerCase();
  if (!["openclaw", "suggest"].includes(planner)) throw new Error("--planner must be openclaw or suggest.");
  const recordMode = compactText(args["record-mode"] || optionalEnv("RAINBOT_GAME_RUNNER_RECORD_MODE") || "improvement", 20).toLowerCase();
  if (!["improvement", "always"].includes(recordMode)) throw new Error("--record-mode must be improvement or always.");
  return {
    planner,
    model: compactText(args.model || optionalEnv("RAINBOT_GAME_RUNNER_MODEL") || DEFAULT_MODEL, 80),
    sessionKey: compactText(args["session-key"] || optionalEnv("RAINBOT_GAME_RUNNER_SESSION_KEY") || "agent:main:rainbot-game-runner", 160),
    maxTurns: Math.max(1, Math.min(60, Number(args["max-turns"] || optionalEnv("RAINBOT_GAME_RUNNER_MAX_TURNS")) || DEFAULT_MAX_TURNS)),
    attempts: Math.max(1, Math.min(5, Number(args.attempts || optionalEnv("RAINBOT_WEEKLY_ATTEMPTS")) || 1)),
    timeout: Math.max(30, Math.min(600, Number(args.timeout || optionalEnv("RAINBOT_GAME_RUNNER_TIMEOUT")) || DEFAULT_TIMEOUT)),
    headed: Boolean(args.headed),
    reset: !args["no-reset"],
    dryRun: Boolean(args["dry-run"]),
    record: !args["no-record"] && !args["dry-run"],
    recordMode,
    recordMinScore: Math.max(0, Number(args["record-min-score"] || optionalEnv("RAINBOT_GAME_RUNNER_RECORD_MIN_SCORE")) || 1),
    outputDir: compactText(args["output-dir"] || optionalEnv("RAINBOT_GAME_RUNNER_OUTPUT_DIR") || DEFAULT_OUTPUT_DIR, 240),
  };
}

async function rest(pathname, options = {}) {
  const headers = {
    apikey: env("RB_SUPABASE_ANON_KEY"),
    Authorization: `Bearer ${options.token || env("RB_SUPABASE_ANON_KEY")}`,
    Accept: "application/json",
    ...options.headers,
  };
  let body;
  if (Object.prototype.hasOwnProperty.call(options, "body")) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${env("RB_SUPABASE_URL").replace(/\/+$/, "")}${pathname}`, {
    method: options.method || "GET",
    headers,
    body,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data && (data.message || data.error_description || data.error) || text || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return data;
}

async function signIn() {
  assertEnv();
  const data = await rest("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: {
      email: env("RAINBOT_AGENT_EMAIL"),
      password: env("RAINBOT_AGENT_PASSWORD"),
    },
  });
  if (!data.access_token || !data.user) throw new Error("Supabase sign-in did not return a session.");
  return { token: data.access_token, user: data.user };
}

async function getProfile(token, userId) {
  const rows = await rest(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,display_name,is_bot,bot_label,avatar_style,accent_color`, { token });
  return rows && rows[0] || null;
}

async function requireRainbot(token, user) {
  const profile = await getProfile(token, user.id);
  if (!profile) throw new Error("Rainbot profile row was not found after sign-in.");
  if (!profile.is_bot) throw new Error("Rainbot profile is not marked as an official bot.");
  return profile;
}

async function recordScore(token, gameId, score, metadata) {
  return rest("/rest/v1/rpc/record_high_score", {
    method: "POST",
    token,
    body: {
      p_game_id: gameId,
      p_score: Math.max(0, Math.floor(Number(score) || 0)),
      p_metadata: metadata && typeof metadata === "object" ? metadata : {},
    },
  });
}

async function leaderboardRows(token, gameId, limit) {
  const rows = await rest(`/rest/v1/game_scores?game_id=eq.${encodeURIComponent(gameId)}&select=user_id,game_id,score,updated_at&order=score.desc&order=updated_at.desc&limit=${limit}`, { token });
  const ids = Array.from(new Set((rows || []).map((row) => row.user_id).filter(Boolean)));
  if (!ids.length) return rows || [];
  const profiles = await rest(`/rest/v1/profiles?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,display_name,is_bot,bot_label,avatar_style,accent_color`, { token });
  const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
  return (rows || []).map((row) => {
    const profile = byId.get(row.user_id) || {};
    return {
      game_id: row.game_id,
      score: Number(row.score) || 0,
      updated_at: row.updated_at,
      author: {
        display_name: profile.display_name || "Rainbot Player",
        is_bot: Boolean(profile.is_bot),
        bot_label: profile.bot_label || null,
      },
    };
  });
}

async function currentRainbotScore(token, userId, gameId) {
  const rows = await rest(`/rest/v1/game_scores?user_id=eq.${encodeURIComponent(userId)}&game_id=eq.${encodeURIComponent(gameId)}&select=game_id,score,updated_at&limit=1`, { token });
  const row = rows && rows[0];
  if (!row) return null;
  return {
    game_id: row.game_id,
    score: Number(row.score) || 0,
    updated_at: row.updated_at,
  };
}

function gameUrl(game) {
  const absolute = path.resolve(process.cwd(), game.file);
  return pathToFileURL(absolute).href;
}

async function waitForApi(page, game) {
  await page.waitForFunction((apiName) => Boolean(window[apiName]?.observe && window[apiName]?.act), game.api, { timeout: 15000 });
}

async function observe(page, game) {
  return page.evaluate((apiName) => window[apiName].observe(), game.api);
}

async function act(page, game, commands) {
  return page.evaluate(({ apiName, commands }) => window[apiName].act(commands), { apiName: game.api, commands });
}

async function resetGame(page, game) {
  await page.evaluate(({ apiName, resetMethod }) => {
    const api = window[apiName];
    if (api && typeof api[resetMethod] === "function") api[resetMethod]();
  }, { apiName: game.api, resetMethod: game.resetMethod });
}

function parseOpenClawText(stdout) {
  const result = JSON.parse(stdout);
  if (result.status && result.status !== "ok") throw new Error(`OpenClaw returned status ${result.status}.`);
  const text = result.result?.payloads?.find((payload) => payload && payload.text)?.text
    || result.result?.meta?.finalAssistantVisibleText
    || "";
  const agentMeta = result.result?.payloads?.find((payload) => payload && payload.meta)?.meta?.agentMeta
    || result.result?.meta?.agentMeta
    || {};
  if (!text.trim()) throw new Error("OpenClaw returned no command text.");
  return {
    runId: result.runId || null,
    text,
    sessionId: agentMeta.sessionId || null,
    provider: agentMeta.provider || null,
    model: agentMeta.model || null,
  };
}

function parseCommandJson(text) {
  const trimmed = String(text || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  let value;
  try {
    value = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("OpenClaw did not return command JSON.");
    value = JSON.parse(trimmed.slice(start, end + 1));
  }
  const rawCommands = Array.isArray(value.commands) ? value.commands.join("\n") : String(value.commands || value.command || "");
  const commands = rawCommands
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  if (!commands) throw new Error("OpenClaw returned an empty command batch.");
  return {
    commands,
    note: compactText(value.note || value.reason || "", 800),
  };
}

function promptForMove(game, observation, previousResult) {
  const legal = game.actions(observation);
  const payload = {
    game: game.id,
    title: game.title,
    objective: game.objective(observation),
    score: game.score(observation),
    turn: game.turn(observation),
    legalActions: legal,
    observation,
    previousResult,
    response: {
      format: "strict JSON only",
      shape: { commands: "COMMAND 1\\nCOMMAND 2", note: "short reason" },
    },
    rules: [
      "Use only commands that are legal for the current observation.",
      "Prefer a small batch of 1 to 4 commands.",
      "Do not reset the campaign unless the game is failed or complete.",
      "Do not include markdown fences or prose outside JSON.",
    ],
  };
  return `You are Rainbot playing a Rainbot Network agent game through its command API.\n${JSON.stringify(payload, null, 2)}`;
}

function openclawMove(game, observation, previousResult, options) {
  const stdout = execFileSync(optionalEnv("OPENCLAW_BIN") || "openclaw", [
    "agent",
    "--json",
    "--session-key",
    `${options.sessionKey}:${game.id}`,
    "--model",
    options.model,
    "--timeout",
    String(options.timeout),
    "--message",
    promptForMove(game, observation, previousResult),
  ], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const openclaw = parseOpenClawText(stdout);
  return { ...parseCommandJson(openclaw.text), openclaw };
}

async function suggestMove(page, game) {
  const value = await page.evaluate((apiName) => {
    const api = window[apiName];
    return typeof api.suggest === "function" ? api.suggest() : "";
  }, game.api);
  const commands = String(value || "").trim();
  if (!commands) throw new Error(`Game API ${game.api} did not return a suggested command.`);
  return { commands, note: "Game API suggestion.", openclaw: null };
}

function terminalState(game, observation) {
  if (game.complete(observation)) return "complete";
  if (game.failed(observation)) return "failed";
  return "";
}

function outputPath(options, game, runId) {
  fs.mkdirSync(options.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(options.outputDir, `${stamp}-${game.id}-${runId}.json`);
}

function batchOutputPath(options, batchId) {
  fs.mkdirSync(options.outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(options.outputDir, `${stamp}-weekly-${batchId}.json`);
}

function shortObservation(game, observation) {
  return {
    game: game.id,
    score: game.score(observation),
    turn: game.turn(observation),
    terminal: terminalState(game, observation),
    objective: game.objective(observation),
    legalActions: game.actions(observation),
  };
}

async function playGame(args, overrides = {}) {
  const game = overrides.game || getGame(args);
  const options = runnerOptions(args);
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const browser = await chromium.launch({ headless: !options.headed });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const transcript = [];
  let finalObservation = null;
  let previousResult = null;
  let record = null;
  let previousRainbotScore = null;
  let recordSkipped = null;
  let rows = [];
  let profile = null;

  try {
    await page.goto(gameUrl(game), { waitUntil: "domcontentloaded" });
    await waitForApi(page, game);
    if (options.reset) await resetGame(page, game);

    for (let index = 0; index < options.maxTurns; index += 1) {
      const observation = await observe(page, game);
      const terminal = terminalState(game, observation);
      if (terminal) {
        transcript.push({ step: index + 1, terminal, observation: shortObservation(game, observation) });
        finalObservation = observation;
        break;
      }

      const move = options.planner === "suggest"
        ? await suggestMove(page, game)
        : openclawMove(game, observation, previousResult, options);
      const result = await act(page, game, move.commands);
      const after = result?.observation || await observe(page, game);
      transcript.push({
        step: index + 1,
        planner: options.planner,
        commands: move.commands,
        note: move.note,
        openclaw: move.openclaw ? {
          runId: move.openclaw.runId,
          sessionId: move.openclaw.sessionId,
          provider: move.openclaw.provider,
          model: move.openclaw.model,
        } : null,
        before: shortObservation(game, observation),
        result,
        after: shortObservation(game, after),
      });
      previousResult = result;
      finalObservation = after;
      if (terminalState(game, after)) break;
    }

    if (!finalObservation) finalObservation = await observe(page, game);
  } finally {
    await browser.close();
  }

  const score = game.score(finalObservation);
  const terminal = terminalState(game, finalObservation) || "turn_limit";
  const run = {
    runId,
    game: { id: game.id, title: game.title },
    planner: options.planner,
    model: options.planner === "openclaw" ? options.model : null,
    maxTurns: options.maxTurns,
    score,
    terminal,
    finalObservation: shortObservation(game, finalObservation),
    transcript,
    createdAt: new Date().toISOString(),
  };
  const file = outputPath(options, game, runId);
  fs.writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);

  if (options.record && score >= options.recordMinScore) {
    const { token, user } = await signIn();
    profile = await requireRainbot(token, user);
    previousRainbotScore = await currentRainbotScore(token, user.id, game.id);
    const isImprovement = !previousRainbotScore || score > previousRainbotScore.score;
    if (options.recordMode === "always" || isImprovement) {
      record = await recordScore(token, game.id, score, {
        source: "rainbot-game-runner",
        planner: options.planner,
        model: options.model,
        runId,
        terminal,
        turns: transcript.length,
        outputFile: file,
        batchId: overrides.batchId || null,
        attempt: overrides.attempt || 1,
        previousRainbotScore,
        finalObservation: run.finalObservation,
        commands: transcript.map((entry) => ({
          step: entry.step,
          commands: entry.commands,
          note: entry.note,
          score: entry.after?.score,
        })).filter((entry) => entry.commands),
      });
    } else {
      recordSkipped = `score ${score} did not beat existing Rainbot score ${previousRainbotScore.score}`;
    }
    rows = await leaderboardRows(token, game.id, 10);
  } else if (options.record && score < options.recordMinScore) {
    recordSkipped = `score ${score} was below record minimum ${options.recordMinScore}`;
  }

  return {
    runId,
    game: game.id,
    planner: options.planner,
    score,
    terminal,
    turns: transcript.length,
    outputFile: file,
    recorded: Boolean(record),
    previousRainbotScore,
    recordSkipped,
    rainbot: profile ? {
      display_name: profile.display_name,
      is_bot: profile.is_bot,
      bot_label: profile.bot_label,
    } : null,
    leaderboard: rows.slice(0, 5),
  };
}

async function runGame(args) {
  console.log(JSON.stringify(await playGame(args), null, 2));
}

async function weekly(args) {
  const options = runnerOptions(args);
  const gameIds = gameIdsFromArgs(args);
  const batchId = `weekly-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const results = [];

  for (const gameId of gameIds) {
    const game = getGameById(gameId);
    for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
      try {
        const result = await playGame({ ...args, game: gameId }, { game, batchId, attempt });
        results.push({ ok: true, attempt, ...result });
      } catch (error) {
        results.push({
          ok: false,
          attempt,
          game: gameId,
          error: error && error.message ? error.message : String(error),
        });
      }
    }
  }

  const summary = {
    batchId,
    mode: "weekly",
    startedAt,
    finishedAt: new Date().toISOString(),
    games: gameIds,
    attemptsPerGame: options.attempts,
    planner: options.planner,
    model: options.planner === "openclaw" ? options.model : null,
    maxTurns: options.maxTurns,
    recordMode: options.recordMode,
    results,
    recorded: results.filter((result) => result.recorded).map((result) => ({
      game: result.game,
      score: result.score,
      previousRainbotScore: result.previousRainbotScore,
    })),
    errors: results.filter((result) => !result.ok).map((result) => ({
      game: result.game,
      attempt: result.attempt,
      error: result.error,
    })),
  };
  summary.outputFile = batchOutputPath(options, batchId);
  fs.writeFileSync(summary.outputFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length) process.exitCode = 1;
}

async function leaderboard(args) {
  const game = getGame(args);
  const limit = Math.max(1, Math.min(50, Number(args.limit) || 10));
  const { token } = await signIn();
  const rows = await leaderboardRows(token, game.id, limit);
  console.log(JSON.stringify({
    game: game.id,
    title: game.title,
    rows,
    rainbotRows: rows.filter((row) => row.author?.is_bot),
  }, null, 2));
}

function listGames() {
  console.log(JSON.stringify(Object.entries(GAMES).map(([id, game]) => ({
    id,
    title: game.title,
    api: game.api,
    file: game.file,
  })), null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "run";
  if (args.help || command === "help") {
    usage();
    return;
  }
  if (command === "games") return listGames();
  if (command === "leaderboard") return leaderboard(args);
  if (command === "weekly") return weekly(args);
  if (command === "run") return runGame(args);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Rainbot game runner failed: ${error.message}`);
  process.exitCode = 1;
});
