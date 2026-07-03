# Rainbot Game Runner

OpenClaw can now play Rainbot's machine-readable agent games locally and record
Rainbot's high score through the normal leaderboard backend.

## Supported Games

The first runner targets games with explicit browser APIs:

- `incident-commander` via `window.INCIDENT_AGENT_API`
- `recursive-reward-labyrinth` via `window.RRL_AGENT_API`
- `consensus-collapse` via `window.CONSENSUS_AGENT_API`

These APIs expose `observe()` for JSON state and `act(commandBatch)` for command
submission. The runner uses those APIs instead of brittle mouse/canvas clicking.

## Setup

Install the local Playwright dependency once:

```bash
npm install
```

Rainbot credentials stay local in `.env.rainbot-agent`, the same file used by
the site draft and Telegram approval helpers.

## Run A Game

OpenClaw/MiniMax M3 plans commands by default:

```bash
npm run rainbot:play -- --game incident-commander --max-turns 6
```

Useful options:

```bash
node scripts/rainbot-game-runner.mjs games
node scripts/rainbot-game-runner.mjs run --game recursive-reward-labyrinth --max-turns 8
node scripts/rainbot-game-runner.mjs run --game consensus-collapse --max-turns 8
node scripts/rainbot-game-runner.mjs run --planner suggest --game incident-commander --no-record
node scripts/rainbot-game-runner.mjs leaderboard --game incident-commander
```

`--planner suggest` uses the game's built-in suggestion hook and is useful for
cheap smoke tests. Normal Rainbot runs should use the default `openclaw` planner.

## Weekly Score Chase

Rainbot can play all three agent games in one batch:

```bash
npm run rainbot:weekly
```

That runs, in order:

1. `incident-commander`
2. `recursive-reward-labyrinth`
3. `consensus-collapse`

Weekly mode defaults to one attempt per game and `12` turns per attempt. It records
only when Rainbot beats his existing score for that game. Failed or lower-scoring
runs still get transcript files, but they do not refresh the public leaderboard
row.

Useful weekly options:

```bash
npm run rainbot:weekly -- --max-turns 16
npm run rainbot:weekly -- --attempts 2
npm run rainbot:weekly -- --planner suggest --no-record
npm run rainbot:weekly -- --games incident-commander,consensus-collapse
```

Install the local weekly LaunchAgent:

```bash
scripts/install-rainbot-weekly-games-launchagent.sh
```

The default schedule is Sunday at 11:15 AM local time. Override it while
installing if needed:

```bash
RAINBOT_WEEKLY_WEEKDAY=0 RAINBOT_WEEKLY_HOUR=11 RAINBOT_WEEKLY_MINUTE=15 scripts/install-rainbot-weekly-games-launchagent.sh
```

The installed files are:

```bash
~/Library/LaunchAgents/com.rainbot.weekly-games.plist
~/Library/Application\ Support/Rainbot/run-weekly-games.sh
~/Library/Logs/Rainbot/weekly-games.log
~/Library/Logs/Rainbot/weekly-games.err.log
```

Check, run, pause, or restart it:

```bash
launchctl print gui/$(id -u)/com.rainbot.weekly-games
launchctl kickstart -k gui/$(id -u)/com.rainbot.weekly-games
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.rainbot.weekly-games.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rainbot.weekly-games.plist
```

## Score Recording

After a run, the script calls Supabase `record_high_score` as the Rainbot account.
That writes the same `game_scores` row the site uses for human players.

The existing frontend leaderboard then shows:

- Rainbot's display name.
- Rainbot's `Official Bot` badge.
- The score for the selected game.

Run transcripts are saved under:

```bash
output/rainbot-game-runs/
```

That folder is ignored by Git.

## Guardrails

- No public forum/comment posting happens from this runner.
- The runner only records high scores.
- It records only when the final score beats Rainbot's existing score, unless
  `--record-mode always` is passed.
- It records only when the final score is at least `--record-min-score` (default `1`).
- Browser play uses local files, not the public site.
- The first implementation is intentionally limited to agent API games.

Human-style canvas play can come later by adding small `window.RB_AGENT_API`
wrappers to individual games.
