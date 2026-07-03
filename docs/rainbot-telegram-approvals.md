# Rainbot Telegram Approvals

The site agent now has a deterministic Telegram approval bridge. It is separate from OpenClaw's normal Telegram chat loop so approvals do not depend on the model interpreting a message correctly.

## Current OpenClaw Status

OpenClaw is running as Rainbot locally, and its active sessions use MiniMax M3. The site-post helper only queues and publishes drafts. Automated draft creation is handled separately by `scripts/rainbot-draft-generator.mjs`; see `docs/rainbot-draft-generator.md`.

Use this bridge for human approval and posting after OpenClaw/MiniMax creates a draft.

## Why A Dedicated Telegram Bot

OpenClaw already polls Telegram for its own bot. A second process polling the same bot token can steal updates or break callbacks. Use a tiny dedicated BotFather bot for Rainbot site approvals:

- OpenClaw bot: normal Rainbot chat.
- Rainbot approval bot: approve/reject site drafts only.

## Local Env

Keep these files local and ignored:

```bash
# Existing helper credentials
.env.rainbot-agent

# New approval bot credentials
.env.rainbot-telegram
```

Example `.env.rainbot-telegram`:

```bash
export RAINBOT_TELEGRAM_BOT_TOKEN="123456:botfather-token"
export RAINBOT_TELEGRAM_CHAT_ID="123456789"
export RAINBOT_TELEGRAM_TOPIC_ID=""
export RAINBOT_SUPABASE_PROJECT_REF="qzvrrpzmalskayushbrv"
```

`RB_SUPABASE_SERVICE_ROLE_KEY` is optional locally because the script can ask the linked Supabase CLI for the service-role key. For a hosted worker or cron outside this Mac, provide the service-role key through that host's secret manager.

## Find The Chat ID

Send `/start` to the approval bot, then run:

```bash
node scripts/rainbot-telegram-approvals.mjs telegram-updates
```

Copy `chat_id` into `.env.rainbot-telegram`. If you add the bot to a forum topic, copy `message_thread_id` into `RAINBOT_TELEGRAM_TOPIC_ID`.

## Approval Flow

Rainbot drafts first:

```bash
source .env.rainbot-agent
node scripts/rainbot-site-agent.mjs draft-comment \
  --type game \
  --id flappy-stonks \
  --url /games/flappy-stonks.html \
  --title "Flappy Stonks" \
  --body "Rainbot draft awaiting Telegram approval."
```

Notify Telegram:

```bash
node scripts/rainbot-telegram-approvals.mjs notify-drafts
```

The approval bot sends a message with:

- Approve & post
- Reject

Run a short poll to process button taps:

```bash
node scripts/rainbot-telegram-approvals.mjs poll-once
```

Or run the normal local approval listener:

```bash
node scripts/rainbot-telegram-approvals.mjs daemon
```

The daemon checks for new draft rows every 60 seconds and polls Telegram button
taps every 8 seconds. That keeps the buttons responsive without letting a
schedule auto-write new public comments.

When you approve, the script:

1. Verifies the Telegram callback token stored on the draft.
2. Marks that exact `agent_actions` row as approved.
3. Temporarily enables Rainbot posting.
4. Publishes the approved action through the same Supabase tables.
5. Switches Rainbot back to `bot_mode='draft'` and `bot_posting_enabled=false`.

The database still enforces cooldowns, daily limits, duplicate-comment checks, and self-reply protections.

## Manual Fallback

You can approve or reject without Telegram:

```bash
node scripts/rainbot-telegram-approvals.mjs approve --action-id 123
node scripts/rainbot-telegram-approvals.mjs reject --action-id 123
```

Approving this way still flips posting back off after the publish attempt.

## Cron Shape

Start with a local launchd or cron job that runs the approval daemon. Do not let
a schedule auto-write public comments; generation should only create draft rows.

This Mac currently uses:

```bash
~/Library/LaunchAgents/com.rainbot.telegram-approvals.plist
~/Library/Application\ Support/Rainbot/run-telegram-approvals.sh
~/Library/Logs/Rainbot/telegram-approvals.log
~/Library/Logs/Rainbot/telegram-approvals.err.log
```

Manual equivalent:

```bash
cd "/Volumes/External SSD/Projects/RainbotGaming"
node scripts/rainbot-telegram-approvals.mjs daemon --interval 8 --timeout 20 --notify-every 60
```

Check the local watcher:

```bash
launchctl print gui/$(id -u)/com.rainbot.telegram-approvals
```

Draft generation is handled by the separate daily OpenClaw/MiniMax job in `docs/rainbot-draft-generator.md`.
