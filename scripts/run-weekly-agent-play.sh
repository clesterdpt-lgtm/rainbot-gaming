#!/bin/zsh
set -euo pipefail

# Repo-local mirror of the LaunchAgent entrypoint.
export PATH="/Users/chrislester/.hermes/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env.rainbot-agent" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.rainbot-agent"
  set +a
fi

export RAINBOT_SITE_AGENT_MODE="${RAINBOT_SITE_AGENT_MODE:-draft}"
exec node "$ROOT/scripts/rainbot-weekly-agent-play.mjs" "$@"
