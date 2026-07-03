#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

const DEFAULT_STATE_PATH = ".rainbot-telegram-approvals-state.json";
const DEFAULT_PROJECT_REF = "qzvrrpzmalskayushbrv";

loadEnvFile(".env.rainbot-agent");
loadEnvFile(".env.rainbot-telegram");

function usage() {
  console.log(`Rainbot Telegram approvals

Commands:
  status
  telegram-updates [--timeout 10]
  notify-drafts [--limit 5] [--force]
  poll-once [--timeout 20]
  daemon [--interval 8] [--timeout 20] [--notify-every 60]
  approve --action-id 123
  reject --action-id 123
  handle-callback --data rbok:123:token

Environment:
  RB_SUPABASE_URL
  RB_SUPABASE_ANON_KEY
  RAINBOT_AGENT_EMAIL
  RAINBOT_AGENT_PASSWORD
  RAINBOT_TELEGRAM_BOT_TOKEN
  RAINBOT_TELEGRAM_CHAT_ID
  RAINBOT_TELEGRAM_TOPIC_ID optional
  RB_SUPABASE_SERVICE_ROLE_KEY optional; falls back to Supabase CLI locally

Use a dedicated approval bot token. Do not point this poller at the same
Telegram bot token that OpenClaw is already polling.
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

function env(name, options = {}) {
  const value = String(process.env[name] || "").trim();
  if (!value && !options.optional) throw new Error(`Missing ${name}`);
  return value;
}

function optionalEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function supabaseUrl() {
  return env("RB_SUPABASE_URL").replace(/\/+$/, "");
}

function anonKey() {
  return env("RB_SUPABASE_ANON_KEY");
}

function telegramToken() {
  return env("RAINBOT_TELEGRAM_BOT_TOKEN");
}

function telegramChatId() {
  return env("RAINBOT_TELEGRAM_CHAT_ID");
}

function telegramTopicId() {
  return optionalEnv("RAINBOT_TELEGRAM_TOPIC_ID");
}

function statePath() {
  return optionalEnv("RAINBOT_TELEGRAM_STATE_PATH") || DEFAULT_STATE_PATH;
}

function readState() {
  const file = statePath();
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeState(state) {
  fs.writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function rest(path, options = {}) {
  const key = options.serviceRole ? await serviceRoleKey() : anonKey();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${options.token || key}`,
    Accept: "application/json",
    ...options.headers,
  };
  let body;
  if (Object.prototype.hasOwnProperty.call(options, "body")) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${supabaseUrl()}${path}`, {
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

async function telegram(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${telegramToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${data.description || response.statusText}`);
  }
  return data.result;
}

function isStaleCallbackError(error) {
  return /query is too old|response timeout expired|query ID is invalid/i.test(error.message || "");
}

async function answerCallbackQuery(callbackId, payload = {}) {
  try {
    await telegram("answerCallbackQuery", { callback_query_id: callbackId, ...payload });
    return { ok: true };
  } catch (error) {
    if (isStaleCallbackError(error)) return { ok: false, stale: true, error: error.message };
    throw error;
  }
}

async function editCallbackMessage(callback, text) {
  if (!callback.message?.chat?.id || !callback.message?.message_id) return { ok: false, skipped: true };
  try {
    await telegram("editMessageText", {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      text: `${callback.message.text || ""}\n\n${text}`,
      reply_markup: { inline_keyboard: [] },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function signIn() {
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

async function serviceRoleKey() {
  const fromEnv = optionalEnv("RB_SUPABASE_SERVICE_ROLE_KEY", "RAINBOT_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY");
  if (fromEnv) return fromEnv;

  const projectRef = optionalEnv("RAINBOT_SUPABASE_PROJECT_REF", "SUPABASE_PROJECT_REF") || DEFAULT_PROJECT_REF;
  const stdout = execFileSync("supabase", ["projects", "api-keys", "--project-ref", projectRef, "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const keys = JSON.parse(stdout);
  const service = keys.find((key) => key.name === "service_role" || key.key_name === "service_role");
  const key = service && (service.api_key || service.key);
  if (!key) throw new Error("Could not resolve Supabase service role key.");
  return key;
}

async function getProfile(token, userId) {
  const rows = await rest(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`, { token });
  return rows && rows[0] || null;
}

async function listActions(token, user, status, limit) {
  return rest(`/rest/v1/agent_actions?agent_profile_id=eq.${encodeURIComponent(user.id)}&status=eq.${encodeURIComponent(status)}&select=*&order=created_at.desc&limit=${limit}`, { token });
}

async function getAction(actionId) {
  const rows = await rest(`/rest/v1/agent_actions?id=eq.${encodeURIComponent(actionId)}&select=*`, { serviceRole: true });
  return rows && rows[0] || null;
}

async function patchAction(actionId, patch, options = {}) {
  const keyOptions = options.serviceRole ? { serviceRole: true } : { token: options.token };
  const rows = await rest(`/rest/v1/agent_actions?id=eq.${encodeURIComponent(actionId)}&select=*`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: patch,
    ...keyOptions,
  });
  return rows && rows[0] || null;
}

async function patchRainbotProfile(userId, patch) {
  await rest(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    serviceRole: true,
    body: patch,
  });
}

function compactText(value, max = 420) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function actionSummary(action) {
  const lines = [
    `Rainbot draft #${action.id}`,
    `Type: ${action.action_type}`,
    `Target: ${action.target_type}${action.target_id ? ` / ${action.target_id}` : ""}`,
  ];
  if (action.title) lines.push(`Title: ${action.title}`);
  if (action.target_url) lines.push(`URL: ${action.target_url}`);
  lines.push("");
  lines.push(compactText(action.body || "(no body)"));
  lines.push("");
  lines.push(`Model: ${action.model || "unknown"}`);
  return lines.join("\n");
}

function buildCallbackData(decision, actionId, token) {
  return `${decision === "approve" ? "rbok" : "rbno"}:${actionId}:${token}`;
}

function parseCallbackData(data) {
  const match = String(data || "").match(/^(rbok|rbno):(\d+):([a-f0-9]{12,32})$/i);
  if (!match) return null;
  return {
    decision: match[1] === "rbok" ? "approve" : "reject",
    actionId: Number(match[2]),
    token: match[3],
  };
}

async function notifyDraft(action, token) {
  const approvalToken = crypto.randomBytes(8).toString("hex");
  const payload = {
    chat_id: telegramChatId(),
    text: actionSummary(action),
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[
        { text: "Approve & post", callback_data: buildCallbackData("approve", action.id, approvalToken) },
        { text: "Reject", callback_data: buildCallbackData("reject", action.id, approvalToken) },
      ]],
    },
  };
  const topic = telegramTopicId();
  if (topic) payload.message_thread_id = Number(topic);
  const sent = await telegram("sendMessage", payload);
  const metadata = action.metadata && typeof action.metadata === "object" && !Array.isArray(action.metadata)
    ? action.metadata
    : {};
  await patchAction(action.id, {
    metadata: {
      ...metadata,
      telegramApproval: {
        token: approvalToken,
        chatId: String(telegramChatId()),
        topicId: topic ? String(topic) : null,
        messageId: sent.message_id,
        notifiedAt: new Date().toISOString(),
      },
    },
  }, { token });
  return { actionId: action.id, messageId: sent.message_id };
}

async function notifyDrafts(args) {
  const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
  const force = Boolean(args.force);
  const { token, user } = await signIn();
  const profile = await getProfile(token, user.id);
  if (!profile || !profile.is_bot) throw new Error("Rainbot profile is not marked as an official bot.");
  const actions = await listActions(token, user, "draft", limit);
  const candidates = actions.filter((action) => force || !action.metadata?.telegramApproval?.messageId);
  const sent = [];
  for (const action of candidates) sent.push(await notifyDraft(action, token));
  console.log(JSON.stringify({ checked: actions.length, sent }, null, 2));
}

async function publishApprovedAction(token, user, action) {
  const meta = action.metadata || {};
  if (action.action_type === "content_comment") {
    return rest("/rest/v1/content_comments?select=*", {
      method: "POST",
      token,
      headers: { Prefer: "return=representation" },
      body: {
        agent_action_id: action.id,
        author_id: user.id,
        content_type: meta.contentType || action.target_type,
        content_id: meta.contentId || action.target_id,
        page_url: meta.pageUrl || action.target_url || "/",
        page_title: meta.pageTitle || action.title || "Rainbot",
        parent_id: meta.parentId || null,
        body: action.body,
      },
    });
  }
  if (action.action_type === "forum_topic") {
    return rest("/rest/v1/forum_topics?select=*", {
      method: "POST",
      token,
      headers: { Prefer: "return=representation" },
      body: {
        agent_action_id: action.id,
        author_id: user.id,
        title: action.title,
        body: action.body,
        category: meta.category || "general",
        game_id: meta.gameId || null,
      },
    });
  }
  if (action.action_type === "forum_reply") {
    return rest("/rest/v1/forum_replies?select=*", {
      method: "POST",
      token,
      headers: { Prefer: "return=representation" },
      body: {
        agent_action_id: action.id,
        topic_id: Number(meta.topicId || action.target_id),
        author_id: user.id,
        parent_id: meta.parentId || null,
        body: action.body,
      },
    });
  }
  throw new Error(`Cannot publish action type ${action.action_type}.`);
}

async function approveAndPublish(actionId) {
  const { token, user } = await signIn();
  let action = await getAction(actionId);
  if (!action) throw new Error(`Action ${actionId} was not found.`);
  if (action.agent_profile_id !== user.id) throw new Error(`Action ${actionId} does not belong to Rainbot.`);
  if (!["draft", "approved"].includes(action.status)) throw new Error(`Action ${actionId} is ${action.status}, not draft/approved.`);

  if (action.status === "draft") {
    action = await patchAction(action.id, { status: "approved", error_text: null }, { serviceRole: true });
  }

  try {
    await patchRainbotProfile(user.id, { bot_mode: "approved", bot_posting_enabled: true });
    const posted = await publishApprovedAction(token, user, action);
    return { actionId: action.id, posted };
  } catch (error) {
    await patchAction(action.id, {
      status: "failed",
      error_text: compactText(error.message, 800),
      executed_at: new Date().toISOString(),
    }, { serviceRole: true });
    throw error;
  } finally {
    await patchRainbotProfile(user.id, { bot_mode: "draft", bot_posting_enabled: false });
  }
}

async function rejectAction(actionId) {
  const action = await getAction(actionId);
  if (!action) throw new Error(`Action ${actionId} was not found.`);
  if (!["draft", "approved"].includes(action.status)) throw new Error(`Action ${actionId} is ${action.status}, not draft/approved.`);
  return patchAction(actionId, {
    status: "rejected",
    executed_at: new Date().toISOString(),
    error_text: null,
  }, { serviceRole: true });
}

async function verifyCallbackToken(actionId, token) {
  const action = await getAction(actionId);
  if (!action) throw new Error(`Action ${actionId} was not found.`);
  const expected = action.metadata?.telegramApproval?.token;
  if (!expected || expected !== token) throw new Error(`Telegram approval token mismatch for action ${actionId}.`);
  return action;
}

async function processDecision(parsed) {
  await verifyCallbackToken(parsed.actionId, parsed.token);
  if (parsed.decision === "reject") {
    const rejected = await rejectAction(parsed.actionId);
    return { decision: parsed.decision, actionId: parsed.actionId, status: rejected.status };
  }
  const result = await approveAndPublish(parsed.actionId);
  return {
    decision: parsed.decision,
    actionId: parsed.actionId,
    postedCount: Array.isArray(result.posted) ? result.posted.length : 0,
  };
}

async function handleCallbackData(data) {
  const parsed = parseCallbackData(data);
  if (!parsed) throw new Error("Callback data is not a Rainbot approval action.");
  console.log(JSON.stringify(await processDecision(parsed), null, 2));
}

function callbackChatMatches(update) {
  const chatId = update.callback_query?.message?.chat?.id;
  return String(chatId) === String(telegramChatId());
}

async function processUpdate(update) {
  const callback = update.callback_query;
  if (!callback) return { ignored: true, reason: "not callback" };
  const parsed = parseCallbackData(callback.data);
  if (!parsed) return { ignored: true, reason: "not rainbot callback" };
  if (!callbackChatMatches(update)) {
    await answerCallbackQuery(callback.id, {
      text: "Rainbot approval denied: wrong chat.",
      show_alert: true,
    });
    return { ignored: true, reason: "wrong chat" };
  }

  try {
    const result = await processDecision(parsed);
    const text = parsed.decision === "approve"
      ? `Rainbot action #${parsed.actionId} approved and posted. Posting has been switched back off.`
      : `Rainbot action #${parsed.actionId} rejected.`;
    await answerCallbackQuery(callback.id, { text });
    await editCallbackMessage(callback, text);
    return result;
  } catch (error) {
    const text = `Rainbot approval failed: ${error.message}`;
    await answerCallbackQuery(callback.id, {
      text,
      show_alert: true,
    });
    await editCallbackMessage(callback, text);
    return { error: error.message };
  }
}

async function pollOnce(args) {
  const timeout = Math.max(0, Math.min(50, Number(args.timeout) || 20));
  const state = readState();
  const payload = {
    timeout,
    allowed_updates: ["callback_query"],
  };
  if (Number.isFinite(Number(state.updateOffset))) payload.offset = Number(state.updateOffset);
  const updates = await telegram("getUpdates", payload);
  const results = [];
  for (const update of updates) {
    results.push(await processUpdate(update));
    state.updateOffset = Number(update.update_id) + 1;
  }
  writeState(state);
  console.log(JSON.stringify({ updates: updates.length, results }, null, 2));
}

async function daemon(args) {
  const intervalMs = Math.max(2, Number(args.interval) || 8) * 1000;
  const notifyEvery = Number(args["notify-every"]);
  const notifyEveryMs = notifyEvery === 0 ? 0 : Math.max(intervalMs, (Number.isFinite(notifyEvery) ? notifyEvery : 60) * 1000);
  let nextNotifyAt = 0;
  for (;;) {
    if (notifyEveryMs && Date.now() >= nextNotifyAt) {
      try {
        await notifyDrafts({ limit: args.limit || 5 });
      } catch (error) {
        console.error(JSON.stringify({ notifyError: error.message }));
      }
      nextNotifyAt = Date.now() + notifyEveryMs;
    }
    await pollOnce(args);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function telegramUpdates(args) {
  const timeout = Math.max(0, Math.min(50, Number(args.timeout) || 10));
  const updates = await telegram("getUpdates", { timeout, allowed_updates: ["message", "callback_query"] });
  const summary = updates.map((update) => {
    const message = update.message || update.callback_query?.message || {};
    return {
      update_id: update.update_id,
      chat_id: message.chat?.id,
      message_thread_id: message.message_thread_id,
      from: update.message?.from?.username || update.callback_query?.from?.username || null,
      text: update.message?.text || update.callback_query?.data || "",
    };
  });
  console.log(JSON.stringify(summary, null, 2));
}

async function status() {
  const { token, user } = await signIn();
  const profile = await getProfile(token, user.id);
  console.log(JSON.stringify({
    rainbotUserId: user.id,
    rainbotEmail: user.email,
    profile: profile ? {
      display_name: profile.display_name,
      is_bot: profile.is_bot,
      bot_mode: profile.bot_mode,
      bot_posting_enabled: profile.bot_posting_enabled,
    } : null,
    telegram: {
      hasToken: Boolean(optionalEnv("RAINBOT_TELEGRAM_BOT_TOKEN")),
      chatId: optionalEnv("RAINBOT_TELEGRAM_CHAT_ID") || null,
      topicId: optionalEnv("RAINBOT_TELEGRAM_TOPIC_ID") || null,
      statePath: statePath(),
    },
    serviceRole: {
      hasEnvKey: Boolean(optionalEnv("RB_SUPABASE_SERVICE_ROLE_KEY", "RAINBOT_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY")),
      cliFallbackProjectRef: optionalEnv("RAINBOT_SUPABASE_PROJECT_REF", "SUPABASE_PROJECT_REF") || DEFAULT_PROJECT_REF,
    },
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) {
    usage();
    return;
  }
  if (command === "status") return status();
  if (command === "telegram-updates") return telegramUpdates(args);
  if (command === "notify-drafts") return notifyDrafts(args);
  if (command === "poll-once") return pollOnce(args);
  if (command === "daemon") return daemon(args);
  if (command === "approve") {
    const actionId = Number(args["action-id"]);
    if (!Number.isFinite(actionId) || actionId <= 0) throw new Error("Missing --action-id.");
    console.log(JSON.stringify(await approveAndPublish(actionId), null, 2));
    return;
  }
  if (command === "reject") {
    const actionId = Number(args["action-id"]);
    if (!Number.isFinite(actionId) || actionId <= 0) throw new Error("Missing --action-id.");
    console.log(JSON.stringify(await rejectAction(actionId), null, 2));
    return;
  }
  if (command === "handle-callback") {
    if (!args.data) throw new Error("Missing --data.");
    return handleCallbackData(args.data);
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Rainbot Telegram approvals failed: ${error.message}`);
  process.exitCode = 1;
});
