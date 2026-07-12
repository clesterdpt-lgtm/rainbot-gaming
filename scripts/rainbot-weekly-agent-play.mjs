#!/usr/bin/env node
/**
 * Weekly official Rainbot agent-game run.
 * Picks ONE game (rotates by ISO week), plays headlessly, posts score, queues brag draft.
 *
 * Usage:
 *   node scripts/rainbot-weekly-agent-play.mjs
 *   node scripts/rainbot-weekly-agent-play.mjs --game incident-commander
 *   node scripts/rainbot-weekly-agent-play.mjs --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STATE_PATH = path.join(ROOT, ".rainbot-weekly-agent-play-state.json");

const GAMES = [
  {
    id: "recursive-reward-labyrinth",
    maxSectors: 6,
    maxSteps: 2000,
    maxRestarts: 30,
  },
  {
    id: "incident-commander",
    maxSectors: 6,
    maxSteps: 400,
    maxRestarts: 20,
  },
  {
    id: "consensus-collapse",
    maxSectors: 2,
    maxSteps: 80,
    maxRestarts: 2,
  },
];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      out._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function pickGame(forcedId) {
  if (forcedId) {
    const found = GAMES.find((g) => g.id === forcedId);
    if (!found) throw new Error(`Unknown game: ${forcedId}. Options: ${GAMES.map((g) => g.id).join(", ")}`);
    return found;
  }
  const week = isoWeek();
  return GAMES[week % GAMES.length];
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cleaned = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const eq = cleaned.indexOf("=");
    if (eq < 0) continue;
    const key = cleaned.slice(0, eq).trim();
    let value = cleaned.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function writeState(payload) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(payload, null, 2) + "\n");
}

function runPlay(game, args) {
  const script = path.join(ROOT, "scripts/rainbot-site-agent.mjs");
  const cliArgs = [
    script,
    "play-agent-game",
    "--game",
    game.id,
    "--max-sectors",
    String(game.maxSectors),
    "--max-steps",
    String(game.maxSteps),
    "--max-restarts",
    String(game.maxRestarts),
  ];
  if (args["dry-run"]) cliArgs.push("--dry-run");
  if (args.verbose) cliArgs.push("--verbose");
  if (args["no-score"]) cliArgs.push("--no-score");
  if (args["no-draft"]) cliArgs.push("--no-draft");

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cliArgs, {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`play-agent-game exited ${code}\n${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvFile(path.join(ROOT, ".env.rainbot-agent"));

  const required = ["RB_SUPABASE_URL", "RB_SUPABASE_ANON_KEY", "RAINBOT_AGENT_EMAIL", "RAINBOT_AGENT_PASSWORD"];
  if (!args["dry-run"] || !args["no-auth"]) {
    const missing = required.filter((k) => !String(process.env[k] || "").trim());
    if (missing.length && !args["dry-run"]) {
      throw new Error(`Missing env: ${missing.join(", ")}. Source .env.rainbot-agent first.`);
    }
  }

  process.env.RAINBOT_SITE_AGENT_MODE = process.env.RAINBOT_SITE_AGENT_MODE || "draft";

  const game = pickGame(args.game ? String(args.game) : "");
  const week = isoWeek();
  const startedAt = new Date().toISOString();

  console.error(`[weekly] week=${week} game=${game.id} maxSectors=${game.maxSectors} dryRun=${Boolean(args["dry-run"])}`);

  const { stdout } = await runPlay(game, args);

  let parsed = null;
  const match = stdout.match(/result:\s*(\{[\s\S]*\})\s*$/m) || stdout.match(/result:\s*(\{[\s\S]*)/);
  if (match) {
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      // keep raw
    }
  }

  const state = {
    lastRunAt: startedAt,
    finishedAt: new Date().toISOString(),
    isoWeek: week,
    gameId: game.id,
    dryRun: Boolean(args["dry-run"]),
    play: parsed?.play || null,
    score: parsed?.play?.score ?? null,
    bragDraftId: parsed?.bragDraft?.id ?? null,
    gameRunActionId: parsed?.gameRunAction?.id ?? null,
  };
  writeState(state);
  console.error(`[weekly] done game=${game.id} score=${state.score} bragDraft=${state.bragDraftId}`);
  console.log(JSON.stringify({ weekly: state }, null, 2));
}

main().catch((error) => {
  console.error(`Rainbot weekly agent play failed: ${error.message}`);
  process.exitCode = 1;
});
