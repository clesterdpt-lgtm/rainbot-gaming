# Rainbot Draft Generator

OpenClaw can now generate Rainbot site drafts automatically. The generator only
creates `agent_actions` rows with `status='draft'`; the Telegram approval bridge
still controls all public posting.

## What Runs

The local generator script is:

```bash
node scripts/rainbot-draft-generator.mjs generate-once --notify
```

It:

1. Reads local Rainbot site targets from `games.html`, `articles.html`, and `videos.html`.
2. Skips targets where Rainbot already has a top-level comment, a pending draft,
   or a recent agent action.
3. Asks OpenClaw to generate one short Rainbot comment using MiniMax M3.
4. Inserts the result as a draft `agent_actions` row.
5. Notifies the Telegram approval bot.

It never enables `bot_posting_enabled` and never posts publicly by itself.

## Current Schedule

This Mac currently runs one draft-generation check per day at 10:30 local time:

```bash
~/Library/LaunchAgents/com.rainbot.draft-generator.plist
~/Library/Application\ Support/Rainbot/run-draft-generator.sh
~/Library/Logs/Rainbot/draft-generator.log
~/Library/Logs/Rainbot/draft-generator.err.log
```

The script also has its own guardrails:

- Minimum 20 hours between generated drafts.
- Maximum 2 open draft/approved actions.
- Do not revisit the same target for 14 days.
- Do not draft for a page where Rainbot already has a top-level comment.

## Manual Commands

Check status:

```bash
node scripts/rainbot-draft-generator.mjs status
```

Preview without writing a draft:

```bash
node scripts/rainbot-draft-generator.mjs generate-once --dry-run
```

Create one draft and notify Telegram:

```bash
node scripts/rainbot-draft-generator.mjs generate-once --notify
```

List eligible targets:

```bash
node scripts/rainbot-draft-generator.mjs list-targets
```

Target one page:

```bash
node scripts/rainbot-draft-generator.mjs generate-once --target-type game --content-id to-the-moon --notify
```

Check the scheduled job:

```bash
launchctl print gui/$(id -u)/com.rainbot.draft-generator
```

Pause it:

```bash
launchctl bootout gui/$(id -u)/com.rainbot.draft-generator
```

Start it again:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rainbot.draft-generator.plist
```

## Approval Flow

The generator is only the first half:

```text
OpenClaw/MiniMax -> draft row -> Telegram approval -> public post if approved
```

The database still enforces the public-post limits:

- Maximum 3 official bot posts per 24 hours.
- 30-minute cooldown between public bot posts.
- Maximum 1 official bot forum topic per 24 hours.
- No duplicate top-level bot comment on the same content.
- No bot self-replies.
