#!/usr/bin/env node

import { playAgentGame, listPlayableGames, getGameSpec } from "./lib/play-agent-game.mjs";

const required = [
  "RB_SUPABASE_URL",
  "RB_SUPABASE_ANON_KEY",
  "RAINBOT_AGENT_EMAIL",
  "RAINBOT_AGENT_PASSWORD",
];

const mode = process.env.RAINBOT_SITE_AGENT_MODE || "draft";

function usage() {
  console.log(`Rainbot site agent helper

Draft mode is the default. Public posting requires:
- RAINBOT_SITE_AGENT_MODE=approved or limited
- profiles.is_bot = true
- profiles.bot_posting_enabled = true
- profiles.bot_mode = approved or limited
- an agent_actions row already set to status=approved

Commands:
  whoami
  draft-comment --type game|video|article --id content-id --url /path --title "Page title" --body "Text"
  draft-topic --category general --title "Title" --body "Text" [--game-id game-slug]
  draft-reply --topic-id 123 --body "Text" [--parent-id 456]
  list-drafts [--status draft|approved|posted|rejected|failed|skipped] [--limit 20]
  post-approved --action-id 123
  play-agent-game [--game recursive-reward-labyrinth] [--max-sectors 18] [--max-steps 2500]
                  [--max-restarts 40] [--no-score] [--no-draft] [--dry-run] [--verbose]

Environment:
  RB_SUPABASE_URL
  RB_SUPABASE_ANON_KEY
  RAINBOT_AGENT_EMAIL
  RAINBOT_AGENT_PASSWORD
  RAINBOT_SITE_AGENT_MODE=draft|approved|limited

Playable agent games:
  ${listPlayableGames().join(", ")}
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

function env(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assertEnv() {
  const missing = required.filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) throw new Error(`Missing environment: ${missing.join(", ")}`);
}

function cleanText(value, max = 6000) {
  return String(value || "").trim().slice(0, max);
}

function cleanId(value, max = 120) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

function jsonLine(label, value) {
  console.log(`${label}: ${JSON.stringify(value, null, 2)}`);
}

async function readBodyArg(args) {
  if (args.body) return cleanText(args.body);
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return cleanText(Buffer.concat(chunks).toString("utf8"));
  }
  return "";
}

async function request(path, options = {}) {
  const base = env("RB_SUPABASE_URL").replace(/\/+$/, "");
  const anonKey = env("RB_SUPABASE_ANON_KEY");
  const headers = {
    apikey: anonKey,
    Authorization: `Bearer ${options.token || anonKey}`,
    Accept: "application/json",
    ...options.headers,
  };
  let body;
  if (Object.prototype.hasOwnProperty.call(options, "body")) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${base}${path}`, {
    method: options.method || "GET",
    headers,
    body,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = (data && (data.message || data.error_description || data.error || data.msg)) || text || response.statusText;
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
  return (rows && rows[0]) || null;
}

async function requireBotProfile(token, user) {
  const profile = await getProfile(token, user.id);
  if (!profile) throw new Error("Rainbot profile row was not found after sign-in.");
  if (!profile.is_bot) {
    throw new Error(
      `Profile ${user.id} is not marked as an official bot. Run the setup SQL in docs/rainbot-site-agent.md first.`
    );
  }
  return profile;
}

async function insertAction(token, action) {
  const rows = await request("/rest/v1/agent_actions?select=*", {
    method: "POST",
    token,
    headers: { Prefer: "return=representation" },
    body: action,
  });
  return rows && rows[0];
}

function baseAction(user, args, body) {
  return {
    agent_profile_id: user.id,
    target_url: cleanText(args.url || "", 300) || null,
    title: cleanText(args.title || "", 160) || null,
    body: cleanText(body, 6000) || null,
    status: "draft",
    reason: cleanText(args.reason || "Queued by local Rainbot site-agent helper.", 800),
    model: cleanText(args.model || "minimax/MiniMax-M3", 80),
    openclaw_session_id: cleanText(args.session || "", 120) || null,
    metadata: {},
  };
}

async function draftComment(token, user, args) {
  const body = await readBodyArg(args);
  const contentType = cleanText(args.type || "game", 20);
  if (!["game", "video", "article"].includes(contentType)) throw new Error("--type must be game, video, or article.");
  const contentId = cleanId(args.id);
  if (!contentId) throw new Error("Missing --id content id.");
  if (body.length < 2) throw new Error("Missing --body comment text.");
  const action = {
    ...baseAction(user, args, body),
    action_type: "content_comment",
    target_type: contentType,
    target_id: contentId,
    metadata: {
      contentType,
      contentId,
      pageTitle: cleanText(args.title || "Rainbot", 140),
      pageUrl: cleanText(args.url || "/", 300),
      parentId: args["parent-id"] ? Number(args["parent-id"]) : null,
    },
  };
  return insertAction(token, action);
}

async function draftTopic(token, user, args) {
  const body = await readBodyArg(args);
  const title = cleanText(args.title, 110);
  if (title.length < 4) throw new Error("Missing --title with at least 4 characters.");
  if (body.length < 4) throw new Error("Missing --body with at least 4 characters.");
  const action = {
    ...baseAction(user, args, body),
    action_type: "forum_topic",
    target_type: "site",
    title,
    metadata: {
      category: cleanId(args.category || "general", 40),
      gameId: args["game-id"] ? cleanId(args["game-id"], 96) : null,
    },
  };
  return insertAction(token, action);
}

async function draftReply(token, user, args) {
  const body = await readBodyArg(args);
  const topicId = Number(args["topic-id"]);
  if (!Number.isFinite(topicId) || topicId <= 0) throw new Error("Missing --topic-id.");
  if (body.length < 2) throw new Error("Missing --body reply text.");
  const action = {
    ...baseAction(user, args, body),
    action_type: "forum_reply",
    target_type: "forum_topic",
    target_id: String(topicId),
    metadata: {
      topicId,
      parentId: args["parent-id"] ? Number(args["parent-id"]) : null,
    },
  };
  return insertAction(token, action);
}

async function listActions(token, user, args) {
  const status = cleanId(args.status || "draft", 20);
  const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
  return request(
    `/rest/v1/agent_actions?agent_profile_id=eq.${encodeURIComponent(user.id)}&status=eq.${encodeURIComponent(status)}&select=*&order=created_at.desc&limit=${limit}`,
    { token }
  );
}

async function loadApprovedAction(token, user, actionId) {
  const rows = await request(
    `/rest/v1/agent_actions?id=eq.${encodeURIComponent(actionId)}&agent_profile_id=eq.${encodeURIComponent(user.id)}&status=eq.approved&select=*`,
    { token }
  );
  if (!rows || !rows[0]) throw new Error("Approved agent action was not found.");
  return rows[0];
}

async function postApproved(token, user, args) {
  if (!["approved", "limited"].includes(mode)) {
    throw new Error("Refusing to publish because RAINBOT_SITE_AGENT_MODE is not approved or limited.");
  }
  const actionId = Number(args["action-id"]);
  if (!Number.isFinite(actionId) || actionId <= 0) throw new Error("Missing --action-id.");
  const action = await loadApprovedAction(token, user, actionId);
  const meta = action.metadata || {};

  if (action.action_type === "content_comment") {
    return request("/rest/v1/content_comments?select=*", {
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
    return request("/rest/v1/forum_topics?select=*", {
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
    return request("/rest/v1/forum_replies?select=*", {
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

async function recordCloudScore(token, gameId, score, metadata) {
  const data = await request("/rest/v1/rpc/record_high_score", {
    method: "POST",
    token,
    body: {
      p_game_id: gameId,
      p_score: Math.max(0, Math.floor(Number(score) || 0)),
      p_metadata: metadata && typeof metadata === "object" ? metadata : {},
    },
  });
  return data;
}

async function playAndPublish(token, user, args) {
  const game = cleanId(args.game || "recursive-reward-labyrinth", 96);
  const spec = getGameSpec(game);
  if (!spec) {
    throw new Error(`Unsupported game "${game}". Supported: ${listPlayableGames().join(", ")}`);
  }

  const dryRun = Boolean(args["dry-run"]);
  const noScore = Boolean(args["no-score"]) || dryRun;
  const noDraft = Boolean(args["no-draft"]) || dryRun;
  const verbose = Boolean(args.verbose);

  const result = playAgentGame({
    game,
    maxSectors: args["max-sectors"] ? Number(args["max-sectors"]) : undefined,
    maxSteps: args["max-steps"] ? Number(args["max-steps"]) : undefined,
    maxRestarts: args["max-restarts"] != null ? Number(args["max-restarts"]) : undefined,
    model: args.model ? cleanText(args.model, 80) : undefined,
    verbose,
    log: (msg) => console.error(`[play] ${msg}`),
  });

  const out = {
    play: {
      runId: result.runId,
      gameId: result.gameId,
      score: result.score,
      complete: result.complete,
      sectorsReached: result.sectorsReached,
      maxSectors: result.maxSectors,
      steps: result.steps,
      restarts: result.restarts,
      policyId: result.policyId,
      model: result.model,
    },
    scoreRow: null,
    gameRunAction: null,
    bragDraft: null,
    dryRun,
  };

  // Audit row for the run (always draft; does not post publicly)
  if (!dryRun) {
    out.gameRunAction = await insertAction(token, {
      agent_profile_id: user.id,
      action_type: "game_run",
      target_type: "game",
      target_id: result.gameId,
      target_url: result.url,
      title: `${result.title} run`,
      body: `score=${result.score}; sectors=${result.sectorsReached}/${result.maxSectors}; complete=${result.complete}; steps=${result.steps}; restarts=${result.restarts}`,
      status: "draft",
      reason: "Headless official Rainbot agent game run.",
      model: result.model,
      openclaw_session_id: cleanText(args.session || "", 120) || null,
      metadata: {
        ...result.scoreMetadata,
        bragBody: result.bragBody,
        bragTechnical: result.bragTechnical,
        memory: result.memory,
        lastEvents: result.lastEvents,
      },
    });
  }

  if (!noScore && result.score > 0) {
    out.scoreRow = await recordCloudScore(token, result.gameId, result.score, {
      ...result.scoreMetadata,
      source: "rainbot-site-agent",
      game_run_action_id: out.gameRunAction?.id || null,
    });
  }

  if (!noDraft && result.score > 0) {
    out.bragDraft = await insertAction(token, {
      agent_profile_id: user.id,
      action_type: "content_comment",
      target_type: "game",
      target_id: result.gameId,
      target_url: result.url,
      title: result.title,
      body: result.bragBody,
      status: "draft",
      reason: "Auto-drafted brag from official bot high-score run. Awaiting human approval.",
      model: result.model,
      openclaw_session_id: cleanText(args.session || "", 120) || null,
      metadata: {
        contentType: "game",
        contentId: result.gameId,
        pageTitle: result.title,
        pageUrl: result.url,
        parentId: null,
        runId: result.runId,
        score: result.score,
        gameRunActionId: out.gameRunAction?.id || null,
        bragTechnical: result.bragTechnical,
        publicComment: true,
      },
    });
  }

  return out;
}

function resultModelDefault(args) {
  return args.model || "rrl-heuristic-v1";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) {
    usage();
    return;
  }

  // dry-run play can skip auth if requested with --no-auth, but default still signs in for real runs
  if (command === "play-agent-game" && args["dry-run"] && args["no-auth"]) {
    const result = playAgentGame({
      game: cleanId(args.game || "recursive-reward-labyrinth", 96),
      maxSectors: args["max-sectors"] ? Number(args["max-sectors"]) : undefined,
      maxSteps: args["max-steps"] ? Number(args["max-steps"]) : undefined,
      maxRestarts: args["max-restarts"] ? Number(args["max-restarts"]) : undefined,
      model: cleanText(args.model || "rrl-heuristic-v1", 80),
      verbose: Boolean(args.verbose),
      log: (msg) => console.error(`[play] ${msg}`),
    });
    jsonLine("play", result);
    return;
  }

  const { token, user } = await signIn();
  const profile = await getProfile(token, user.id);

  if (command === "whoami") {
    jsonLine("user", { id: user.id, email: user.email });
    jsonLine("profile", profile);
    return;
  }

  await requireBotProfile(token, user);

  if (command === "draft-comment") {
    jsonLine("draft", await draftComment(token, user, args));
    return;
  }
  if (command === "draft-topic") {
    jsonLine("draft", await draftTopic(token, user, args));
    return;
  }
  if (command === "draft-reply") {
    jsonLine("draft", await draftReply(token, user, args));
    return;
  }
  if (command === "list-drafts") {
    jsonLine("actions", await listActions(token, user, args));
    return;
  }
  if (command === "post-approved") {
    jsonLine("posted", await postApproved(token, user, args));
    return;
  }
  if (command === "play-agent-game") {
    jsonLine("result", await playAndPublish(token, user, args));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Rainbot site agent failed: ${error.message}`);
  process.exitCode = 1;
});
