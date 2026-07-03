#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_MODEL = "minimax/MiniMax-M3";
const DEFAULT_SESSION_KEY = "agent:main:rainbot-site-draft-generator";
const DEFAULT_STATE_PATH = ".rainbot-draft-generator-state.json";
const DEFAULT_MIN_HOURS_BETWEEN_DRAFTS = 20;
const DEFAULT_MAX_OPEN_DRAFTS = 2;
const DEFAULT_RECENT_TARGET_DAYS = 14;
const PROMPT_VERSION = "rainbot-site-comment-v1";

const requiredEnv = [
  "RB_SUPABASE_URL",
  "RB_SUPABASE_ANON_KEY",
  "RAINBOT_AGENT_EMAIL",
  "RAINBOT_AGENT_PASSWORD",
];

loadEnvFile(".env.rainbot-agent");
loadEnvFile(".env.rainbot-draft-generator");

function usage() {
  console.log(`Rainbot OpenClaw draft generator

Commands:
  status
  list-targets [--include-blocked]
  generate-once [--dry-run] [--notify] [--force]

Options:
  --target-type game|article|video|any
  --content-id slug
  --model minimax/MiniMax-M3
  --session-key agent:main:rainbot-site-draft-generator
  --min-hours-between-drafts 20
  --max-open-drafts 2
  --recent-target-days 14
  --timeout 180

The generator creates draft agent_actions rows only. Telegram approval is still
required before any public Rainbot post can be published.
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
    if (process.env[key]) continue;
    process.env[key] = parseEnvValue(rawValue);
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

function cleanText(value, max = 6000) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanId(value, max = 120) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

function statePath() {
  return optionalEnv("RAINBOT_DRAFT_GENERATOR_STATE_PATH") || DEFAULT_STATE_PATH;
}

function readState() {
  const file = statePath();
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeState(state) {
  fs.writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return cleanText(htmlDecode(String(value || "").replace(/<[^>]+>/g, " ")), 1200);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractClassText(html, className, tag = "[a-z0-9]+") {
  const re = new RegExp(`<${tag}\\b[^>]*class=["'][^"']*${escapeRegExp(className)}[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = html.match(re);
  return match ? stripTags(match[1]) : "";
}

function normalizePageUrl(href) {
  const cleaned = String(href || "").trim().replace(/^\.\//, "");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

function targetKey(target) {
  return `${target.contentType}:${target.contentId}`;
}

function parseDirectoryCards(file, contentType, hrefPrefix) {
  if (!fs.existsSync(file)) return [];
  const html = fs.readFileSync(file, "utf8");
  const cards = [];
  const re = /<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const href = htmlDecode(match[2]).replace(/^\.\//, "");
    if (!href.startsWith(hrefPrefix)) continue;
    const body = match[3];
    const title = extractClassText(body, "rb-card__title", "strong");
    const description = extractClassText(body, "rb-card__desc", "span");
    if (!title || !description) continue;
    const meta = extractClassText(body, "rb-card__meta", "span");
    const kicker = extractClassText(body, "rb-card__kicker", "span");
    const contentId = cleanId(path.basename(href.split("#")[0], ".html"));
    if (!contentId) continue;
    cards.push({
      contentType,
      contentId,
      title,
      pageUrl: normalizePageUrl(href),
      description,
      kind: cleanText(kicker || meta.split(/\s+/).slice(0, 4).join(" "), 80),
    });
  }
  return cards;
}

function parseVideoTarget(file) {
  if (!fs.existsSync(file)) return [];
  const html = fs.readFileSync(file, "utf8");
  const title = stripTags((html.match(/<h2\b[^>]*data-tv-active-title[^>]*>([\s\S]*?)<\/h2>/i) || [])[1]);
  const description = stripTags((html.match(/<p\b[^>]*data-tv-active-deck[^>]*>([\s\S]*?)<\/p>/i) || [])[1]);
  const kind = stripTags((html.match(/<span\b[^>]*data-tv-active-meta[^>]*>([\s\S]*?)<\/span>/i) || [])[1]);
  if (!title || !description) return [];
  return [{
    contentType: "video",
    contentId: cleanId(title),
    title,
    pageUrl: "/videos.html#featured",
    description,
    kind,
  }];
}

function collectTargets() {
  const targets = [
    ...parseDirectoryCards("games.html", "game", "games/"),
    ...parseDirectoryCards("articles.html", "article", "articles/"),
    ...parseVideoTarget("videos.html"),
  ];
  const seen = new Set();
  return targets.filter((target) => {
    const key = targetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function request(pathname, options = {}) {
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
  const data = await request("/auth/v1/token?grant_type=password", {
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
  const rows = await request(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`, { token });
  return rows && rows[0] || null;
}

async function requireBotProfile(token, user) {
  const profile = await getProfile(token, user.id);
  if (!profile) throw new Error("Rainbot profile row was not found after sign-in.");
  if (!profile.is_bot) throw new Error("Rainbot profile is not marked as an official bot.");
  return profile;
}

async function listActions(token, user, statuses, limit = 200) {
  const statusFilter = statuses.map((status) => cleanId(status, 20)).filter(Boolean).join(",");
  return request(`/rest/v1/agent_actions?agent_profile_id=eq.${encodeURIComponent(user.id)}&status=in.(${statusFilter})&select=*&order=created_at.desc&limit=${limit}`, { token });
}

async function listRainbotTopLevelComments(token, user) {
  return request(`/rest/v1/content_comments?author_id=eq.${encodeURIComponent(user.id)}&parent_id=is.null&select=content_type,content_id,created_at&limit=1000`, { token });
}

async function getContext(args) {
  const { token, user } = await signIn();
  const profile = await requireBotProfile(token, user);
  const [pendingActions, recentActions, topLevelComments] = await Promise.all([
    listActions(token, user, ["draft", "approved"], 100),
    listActions(token, user, ["draft", "approved", "posted", "rejected", "failed", "skipped"], 200),
    listRainbotTopLevelComments(token, user),
  ]);
  return {
    token,
    user,
    profile,
    targets: collectTargets(),
    state: readState(),
    pendingActions,
    recentActions,
    topLevelComments,
    options: generationOptions(args),
  };
}

function generationOptions(args) {
  const targetType = cleanText(args["target-type"] || "any", 20).toLowerCase();
  if (!["game", "article", "video", "any"].includes(targetType)) {
    throw new Error("--target-type must be game, article, video, or any.");
  }
  return {
    targetType,
    contentId: args["content-id"] ? cleanId(args["content-id"]) : "",
    model: cleanText(args.model || optionalEnv("RAINBOT_DRAFT_MODEL") || DEFAULT_MODEL, 80),
    sessionKey: cleanText(args["session-key"] || optionalEnv("RAINBOT_DRAFT_SESSION_KEY") || DEFAULT_SESSION_KEY, 160),
    minHoursBetweenDrafts: Math.max(0, Number(args["min-hours-between-drafts"] || optionalEnv("RAINBOT_DRAFT_MIN_HOURS")) || DEFAULT_MIN_HOURS_BETWEEN_DRAFTS),
    maxOpenDrafts: Math.max(0, Number(args["max-open-drafts"] || optionalEnv("RAINBOT_DRAFT_MAX_OPEN_DRAFTS")) || DEFAULT_MAX_OPEN_DRAFTS),
    recentTargetDays: Math.max(0, Number(args["recent-target-days"] || optionalEnv("RAINBOT_DRAFT_RECENT_TARGET_DAYS")) || DEFAULT_RECENT_TARGET_DAYS),
    timeout: Math.max(30, Math.min(600, Number(args.timeout) || 180)),
    dryRun: Boolean(args["dry-run"]),
    force: Boolean(args.force),
    notify: Boolean(args.notify || optionalEnv("RAINBOT_DRAFT_NOTIFY") === "1" || optionalEnv("RAINBOT_DRAFT_NOTIFY").toLowerCase() === "true"),
  };
}

function actionKey(action) {
  if (!action.target_type || !action.target_id) return "";
  return `${action.target_type}:${action.target_id}`;
}

function hoursSince(iso) {
  if (!iso) return Infinity;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return Infinity;
  return (Date.now() - time) / 36e5;
}

function buildBlockedTargetMap(context) {
  const blocked = new Map();
  const postedKeys = new Set(context.topLevelComments.map((row) => `${row.content_type}:${row.content_id}`));
  const pendingKeys = new Set(context.pendingActions.map(actionKey).filter(Boolean));
  const recentCutoff = Date.now() - context.options.recentTargetDays * 24 * 60 * 60 * 1000;
  const recentKeys = new Set(context.recentActions
    .filter((action) => Date.parse(action.created_at || "") >= recentCutoff)
    .map(actionKey)
    .filter(Boolean));

  for (const target of context.targets) {
    const key = targetKey(target);
    const reasons = [];
    if (postedKeys.has(key)) reasons.push("rainbot_already_posted_top_level_comment");
    if (pendingKeys.has(key)) reasons.push("pending_draft_or_approval_exists");
    if (recentKeys.has(key)) reasons.push("recent_agent_action_exists");
    if (reasons.length) blocked.set(key, reasons);
  }
  return blocked;
}

function selectTarget(context) {
  const blocked = buildBlockedTargetMap(context);
  const { options, targets, state, pendingActions } = context;
  const sinceLast = hoursSince(state.lastGeneratedAt);

  if (!options.force && sinceLast < options.minHoursBetweenDrafts) {
    return {
      skipped: true,
      reason: "min_hours_between_drafts",
      detail: `Last draft was generated ${sinceLast.toFixed(1)}h ago.`,
      blocked,
    };
  }

  if (!options.force && pendingActions.length >= options.maxOpenDrafts) {
    return {
      skipped: true,
      reason: "too_many_open_drafts",
      detail: `${pendingActions.length} draft/approved actions are still open.`,
      blocked,
    };
  }

  let pool = targets;
  if (options.targetType !== "any") pool = pool.filter((target) => target.contentType === options.targetType);
  if (options.contentId) pool = pool.filter((target) => target.contentId === options.contentId);
  if (!pool.length) {
    return {
      skipped: true,
      reason: "no_matching_targets",
      detail: "No local site target matched the requested filters.",
      blocked,
    };
  }

  if (options.contentId) {
    const target = pool[0];
    const reasons = blocked.get(targetKey(target)) || [];
    if (reasons.length) {
      return {
        skipped: true,
        reason: "target_blocked",
        detail: reasons.join(", "),
        target,
        blocked,
      };
    }
    return { target, blocked };
  }

  const startIndex = Math.max(-1, pool.findIndex((target) => targetKey(target) === state.lastTargetKey));
  for (let offset = 1; offset <= pool.length; offset += 1) {
    const target = pool[(startIndex + offset + pool.length) % pool.length];
    if (!blocked.has(targetKey(target))) return { target, blocked };
  }

  return {
    skipped: true,
    reason: "all_targets_blocked",
    detail: "Every known target already has a Rainbot post, pending draft, or recent agent action.",
    blocked,
  };
}

function buildPrompt(target) {
  const payload = {
    task: "Write one official Rainbot Network site comment draft.",
    target: {
      contentType: target.contentType,
      contentId: target.contentId,
      title: target.title,
      kind: target.kind,
      description: target.description,
      pageUrl: target.pageUrl,
    },
    rules: [
      "Return strict JSON only, no markdown fences.",
      "JSON shape: {\"body\":\"...\",\"reason\":\"...\"}.",
      "body must be 1 or 2 short sentences, 80 to 240 characters.",
      "Sound like Rainbot: playful, slightly cursed arcade-host energy, but helpful in small doses.",
      "Mention one specific thing from the target description.",
      "Do not ask users to like, subscribe, follow, or reply.",
      "Do not mention Telegram, approval, drafts, automation, or being an AI model.",
      "No URLs, hashtags, emojis, slurs, harassment, sexual content, or real-world political persuasion.",
      "Keep it safe for a public site comment."
    ],
  };
  return `You are Rainbot, the official Rainbot Network arcade robot.\n\n${JSON.stringify(payload, null, 2)}`;
}

function parseOpenClawText(stdout) {
  const result = JSON.parse(stdout);
  if (result.status && result.status !== "ok") throw new Error(`OpenClaw returned status ${result.status}.`);
  const text = result.result?.payloads?.find((payload) => payload && payload.text)?.text
    || result.result?.meta?.finalAssistantVisibleText
    || "";
  if (!text.trim()) throw new Error("OpenClaw returned no visible text.");
  const agentMeta = result.result?.payloads?.find((payload) => payload && payload.meta)?.meta?.agentMeta
    || result.result?.meta?.agentMeta
    || {};
  return {
    runId: result.runId || null,
    text,
    sessionId: agentMeta.sessionId || null,
    provider: agentMeta.provider || null,
    model: agentMeta.model || null,
  };
}

function runOpenClaw(target, options) {
  const openclawBin = optionalEnv("OPENCLAW_BIN") || "openclaw";
  const prompt = buildPrompt(target);
  const stdout = execFileSync(openclawBin, [
    "agent",
    "--json",
    "--session-key",
    options.sessionKey,
    "--model",
    options.model,
    "--timeout",
    String(options.timeout),
    "--message",
    prompt,
  ], {
    encoding: "utf8",
    maxBuffer: 12 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseOpenClawText(stdout);
}

function parseDraftJson(text) {
  const trimmed = String(text || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("OpenClaw did not return parseable draft JSON.");
  }
}

function normalizeDraftBody(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ");
}

function validateDraftBody(body) {
  const cleaned = normalizeDraftBody(body);
  if (cleaned.length < 20) throw new Error("Generated comment is too short.");
  if (cleaned.length > 280) throw new Error(`Generated comment is too long (${cleaned.length} chars).`);
  if (/https?:\/\/|www\./i.test(cleaned)) throw new Error("Generated comment contains a URL.");
  if (/\[[^\]]+\]\([^)]+\)/.test(cleaned)) throw new Error("Generated comment contains a markdown link.");
  if (/#\w+/.test(cleaned)) throw new Error("Generated comment contains a hashtag.");
  if (/\b(as an ai|language model|telegram|approval|approve|draft|automation|autonomous)\b/i.test(cleaned)) {
    throw new Error("Generated comment mentions internal bot plumbing.");
  }
  return cleaned;
}

async function insertDraft(context, target, openclawResult, draft) {
  const body = validateDraftBody(draft.body);
  const action = {
    agent_profile_id: context.user.id,
    action_type: "content_comment",
    target_type: target.contentType,
    target_id: target.contentId,
    target_url: target.pageUrl,
    title: target.title,
    body,
    status: "draft",
    reason: "Generated by OpenClaw Rainbot draft generator; pending Telegram approval.",
    model: context.options.model,
    openclaw_session_id: openclawResult.sessionId || null,
    metadata: {
      contentType: target.contentType,
      contentId: target.contentId,
      pageTitle: target.title,
      pageUrl: target.pageUrl,
      parentId: null,
      generator: {
        promptVersion: PROMPT_VERSION,
        generatedAt: new Date().toISOString(),
        targetKey: targetKey(target),
        targetKind: target.kind || null,
        targetDescription: target.description,
        openclawRunId: openclawResult.runId,
        openclawSessionKey: context.options.sessionKey,
        openclawProvider: openclawResult.provider,
        openclawModel: openclawResult.model,
        candidateReason: cleanText(draft.reason || "", 500) || null,
      },
    },
  };
  const rows = await request("/rest/v1/agent_actions?select=*", {
    method: "POST",
    token: context.token,
    headers: { Prefer: "return=representation" },
    body: action,
  });
  return rows && rows[0];
}

function summarizeBlocked(blocked) {
  return [...blocked.entries()].map(([key, reasons]) => ({ key, reasons }));
}

function maybeNotifyTelegram() {
  const stdout = execFileSync(process.execPath, ["scripts/rainbot-telegram-approvals.mjs", "notify-drafts", "--limit", "5"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(stdout);
}

async function status(args) {
  const context = await getContext(args);
  const selected = selectTarget(context);
  console.log(JSON.stringify({
    rainbotUserId: context.user.id,
    profile: {
      display_name: context.profile.display_name,
      is_bot: context.profile.is_bot,
      bot_mode: context.profile.bot_mode,
      bot_posting_enabled: context.profile.bot_posting_enabled,
    },
    config: context.options,
    targetCount: context.targets.length,
    openDraftCount: context.pendingActions.length,
    lastGeneratedAt: context.state.lastGeneratedAt || null,
    next: selected.target ? {
      key: targetKey(selected.target),
      title: selected.target.title,
      pageUrl: selected.target.pageUrl,
    } : {
      skipped: selected.skipped,
      reason: selected.reason,
      detail: selected.detail,
    },
  }, null, 2));
}

async function listTargets(args) {
  const context = await getContext(args);
  const blocked = buildBlockedTargetMap(context);
  const includeBlocked = Boolean(args["include-blocked"]);
  const rows = context.targets
    .map((target) => ({
      key: targetKey(target),
      title: target.title,
      pageUrl: target.pageUrl,
      kind: target.kind || null,
      blocked: blocked.get(targetKey(target)) || [],
    }))
    .filter((row) => includeBlocked || !row.blocked.length);
  console.log(JSON.stringify(rows, null, 2));
}

async function generateOnce(args) {
  const context = await getContext(args);
  const selected = selectTarget(context);
  const now = new Date().toISOString();

  if (selected.skipped) {
    const state = {
      ...context.state,
      lastCheckedAt: now,
      lastSkip: {
        at: now,
        reason: selected.reason,
        detail: selected.detail || null,
        target: selected.target ? targetKey(selected.target) : null,
      },
    };
    writeState(state);
    console.log(JSON.stringify({
      skipped: true,
      reason: selected.reason,
      detail: selected.detail || null,
      target: selected.target || null,
    }, null, 2));
    return;
  }

  const openclawResult = runOpenClaw(selected.target, context.options);
  const draft = parseDraftJson(openclawResult.text);
  const body = validateDraftBody(draft.body);

  if (context.options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      target: selected.target,
      body,
      reason: cleanText(draft.reason || "", 500) || null,
      openclaw: {
        runId: openclawResult.runId,
        sessionId: openclawResult.sessionId,
        provider: openclawResult.provider,
        model: openclawResult.model,
      },
    }, null, 2));
    return;
  }

  const action = await insertDraft(context, selected.target, openclawResult, { ...draft, body });
  const nextState = {
    ...context.state,
    lastCheckedAt: now,
    lastGeneratedAt: now,
    lastTargetKey: targetKey(selected.target),
    lastActionId: action.id,
    lastOpenClawRunId: openclawResult.runId,
    lastSkip: null,
  };
  writeState(nextState);

  let telegram = null;
  if (context.options.notify) {
    telegram = maybeNotifyTelegram();
  }

  console.log(JSON.stringify({
    generated: true,
    actionId: action.id,
    target: selected.target,
    body: action.body,
    telegram,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || "generate-once";
  if (args.help || command === "help") {
    usage();
    return;
  }
  if (command === "status") return status(args);
  if (command === "list-targets") return listTargets(args);
  if (command === "generate-once") return generateOnce(args);
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  const state = readState();
  writeState({
    ...state,
    lastCheckedAt: new Date().toISOString(),
    lastError: {
      at: new Date().toISOString(),
      message: error.message,
    },
  });
  console.error(`Rainbot draft generator failed: ${error.message}`);
  process.exitCode = 1;
});
