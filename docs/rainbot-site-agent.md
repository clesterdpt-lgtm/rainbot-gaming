# Rainbot Site Agent

Rainbot can have an official site profile without becoming a forum spam machine. The first version is intentionally conservative:

- The bot uses a normal Supabase Auth account, not a service-role key.
- Drafting and public posting are separate steps.
- Public posts require database approval and rate-limit checks.
- The default mode is draft-only.
- The bot can also **play agent games headlessly**, write cloud high scores, and queue brag drafts.

## Environment

Keep these values outside the repo, preferably in OpenClaw service/local env:

```bash
export RB_SUPABASE_URL="https://qzvrrpzmalskayushbrv.supabase.co"
export RB_SUPABASE_ANON_KEY="public-anon-key"
export RAINBOT_AGENT_EMAIL="rainbot@example.com"
export RAINBOT_AGENT_PASSWORD="long-random-password"
export RAINBOT_SITE_AGENT_MODE="draft"
```

Or load the local helper env:

```bash
set -a
source .env.rainbot-agent
set +a
```

Do not use a Supabase service-role key in the static site or in this helper.

## Create The Account

Create the Rainbot account through the site UI or Supabase Auth. Then run:

```bash
node scripts/rainbot-site-agent.mjs whoami
```

Copy the returned user id and mark that profile as the official bot in Supabase SQL Editor:

```sql
update public.profiles
set
  display_name = 'Rainbot',
  profile_title = 'Official Site Bot',
  bio = 'Rainbot Network arcade robot. Helpful in small doses.',
  favorite_game = 'The Last Signal',
  avatar_style = 'bot',
  accent_color = 'cyan',
  is_bot = true,
  bot_label = 'Official Bot',
  bot_mode = 'draft',
  bot_posting_enabled = false
where id = 'PASTE_USER_ID_HERE';
```

This setup lets Rainbot queue drafts, but database triggers still reject public posts.

## Draft Examples

```bash
node scripts/rainbot-site-agent.mjs draft-comment \
  --type game \
  --id flappy-stonks \
  --url /games/flappy-stonks.html \
  --title "Flappy Stonks" \
  --body "Strong chart chaos here. Try the shield before chasing dividends."

node scripts/rainbot-site-agent.mjs draft-topic \
  --category ideas \
  --title "Tiny weekend challenge idea" \
  --body "What if one game had a daily seed and a tiny official Rainbot run?"

node scripts/rainbot-site-agent.mjs draft-reply \
  --topic-id 123 \
  --body "Confirmed. I can reproduce this without touching the save file."
```

List queued drafts:

```bash
node scripts/rainbot-site-agent.mjs list-drafts
```

## Play Agent Games (headless)

Rainbot can play supported agent-protocol games offline, then:

1. Insert an `agent_actions` row with `action_type = game_run` (audit log)
2. Call `record_high_score` as the Rainbot auth user (cloud leaderboard)
3. Queue a `content_comment` draft brag for human/Telegram approval

### Files

| Path | Role |
| --- | --- |
| `scripts/lib/rrl-engine.mjs` | Headless Recursive Reward Labyrinth rules (DOM-free port) |
| `scripts/lib/rrl-policy.mjs` | Greedy heuristic policy (`rrl-heuristic-v1`) |
| `scripts/lib/play-agent-game.mjs` | Play loop + brag text + score metadata |
| `scripts/rainbot-site-agent.mjs` | CLI: auth, score write, draft queue |

### Commands

```bash
# Full vertical slice: play → cloud score → brag draft
node scripts/rainbot-site-agent.mjs play-agent-game \
  --game recursive-reward-labyrinth \
  --max-sectors 3 \
  --verbose

# Local-only dry run (still signs in; skips score + drafts)
node scripts/rainbot-site-agent.mjs play-agent-game \
  --game recursive-reward-labyrinth \
  --max-sectors 2 \
  --dry-run

# Offline engine check (no Supabase)
node scripts/rainbot-site-agent.mjs play-agent-game \
  --game recursive-reward-labyrinth \
  --max-sectors 1 \
  --dry-run --no-auth --verbose
```

Flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--game` | `recursive-reward-labyrinth` | Supported agent game id |
| `--max-sectors` | `18` | Stop after clearing this many sectors |
| `--max-steps` | `2500` | Policy step budget |
| `--max-restarts` | `40` | Sector fracture restarts |
| `--no-score` | off | Skip cloud `record_high_score` |
| `--no-draft` | off | Skip brag `content_comment` draft |
| `--dry-run` | off | Implies no-score + no-draft (and no game_run row) |
| `--no-auth` | off | With `--dry-run`, skip Supabase entirely |
| `--verbose` | off | Log policy steps to stderr |

Score metadata always includes:

```json
{
  "agent": true,
  "official_bot": true,
  "model": "rrl-heuristic-v1",
  "policy": "rrl-heuristic-v1",
  "run_id": "uuid",
  "source": "rainbot-site-agent",
  "sectors_reached": 3,
  "campaign_complete": false
}
```

Leaderboards should treat `official_bot` / `agent` as a **BOT** badge so humans know who farmed the run.

### Supported games (v1)

| Game | Engine | Policy | Notes |
| --- | --- | --- | --- |
| `recursive-reward-labyrinth` | Headless port (`rrl-engine.mjs`) | `rrl-heuristic-v1` | Clears sectors reliably |
| `incident-commander` | Live browser JS via Node VM | `ic-heuristic-v1` | Fair policy (no root-cause oracle) |
| `consensus-collapse` | Live browser JS via Node VM | `cc-heuristic-v3` | Hard quorum math; partial scores expected |

```bash
node scripts/rainbot-site-agent.mjs play-agent-game --game incident-commander --max-sectors 4
node scripts/rainbot-site-agent.mjs play-agent-game --game consensus-collapse --max-sectors 2
node scripts/rainbot-site-agent.mjs play-agent-game --game recursive-reward-labyrinth --max-sectors 4
```

IC/CC load the real `assets/js/*.js` files in a headless VM so rules stay in sync with the site.

## Weekly schedule (one game per week)

A macOS LaunchAgent runs **every Sunday at 11:15** local time and plays **one** agent game (rotates by ISO week):

| ISO week mod 3 | Game |
| --- | --- |
| 0 | Recursive Reward Labyrinth (6 sectors) |
| 1 | Incident Commander (6 incidents) |
| 2 | Consensus Collapse (2 assemblies max, low restarts) |

### Files

| Path | Role |
| --- | --- |
| `scripts/rainbot-weekly-agent-play.mjs` | Picks game, runs play, writes `.rainbot-weekly-agent-play-state.json` |
| `scripts/run-weekly-agent-play.sh` | Repo wrapper (loads `.env.rainbot-agent`) |
| `~/Library/Application Support/Rainbot/run-weekly-games.sh` | LaunchAgent entrypoint |
| `~/Library/LaunchAgents/com.rainbot.weekly-games.plist` | Sunday 11:15 schedule |
| `~/Library/Logs/Rainbot/weekly-games.log` | stdout |
| `~/Library/Logs/Rainbot/weekly-games.err.log` | stderr |

### Manual / test

```bash
# Whatever game this week would pick
./scripts/run-weekly-agent-play.sh

# Force a game
node scripts/rainbot-weekly-agent-play.mjs --game incident-commander

# Offline dry run
node scripts/rainbot-weekly-agent-play.mjs --dry-run --verbose
```

Scores post live; brag comments stay **draft** for Telegram/manual approval.


## Approve And Publish

Approval is a deliberate database step. A moderator/admin can approve one draft:

```sql
update public.agent_actions
set status = 'approved'
where id = 123
  and status = 'draft';
```

Enable limited public posting only when you actually want the helper to publish approved drafts:

```sql
update public.profiles
set
  bot_mode = 'approved',
  bot_posting_enabled = true
where display_name = 'Rainbot'
  and is_bot = true;
```

Then run:

```bash
export RAINBOT_SITE_AGENT_MODE="approved"
node scripts/rainbot-site-agent.mjs post-approved --action-id 123
```

After posting, the database marks the action as `posted`.

Brag drafts created by `play-agent-game` use the same pipeline — approve the `content_comment` action, then `post-approved`.

## Safety Rules Enforced In The Database

Official bot public posts are blocked unless:

- The profile has `is_bot = true`.
- `bot_posting_enabled = true`.
- `bot_mode` is `approved` or `limited`.
- The post includes an `agent_action_id`.
- That action belongs to the bot and has `status = 'approved'`.

The trigger also blocks:

- More than 3 public bot posts in 24 hours.
- More than 1 bot forum topic in 24 hours.
- Any bot public post within 30 minutes of the previous bot post.
- A second top-level bot comment on the same article, video, or game.
- Bot replies to itself or to its own forum topic.

Keep normal autonomous behavior in `draft` mode until the bot has behaved well for a while.

**Scores are not speech.** Cloud high scores can be written autonomously; only the brag comment stays draft-gated.
