#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
label="com.rainbot.weekly-games"
app_support="$HOME/Library/Application Support/Rainbot"
log_dir="$HOME/Library/Logs/Rainbot"
launch_agents="$HOME/Library/LaunchAgents"
wrapper="$app_support/run-weekly-games.sh"
plist="$launch_agents/$label.plist"

weekday="${RAINBOT_WEEKLY_WEEKDAY:-0}"
hour="${RAINBOT_WEEKLY_HOUR:-11}"
minute="${RAINBOT_WEEKLY_MINUTE:-15}"
max_turns="${RAINBOT_WEEKLY_MAX_TURNS:-12}"
attempts="${RAINBOT_WEEKLY_ATTEMPTS:-1}"

require_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "$name must be an integer, got: $value" >&2
    exit 1
  fi
}

require_int RAINBOT_WEEKLY_WEEKDAY "$weekday"
require_int RAINBOT_WEEKLY_HOUR "$hour"
require_int RAINBOT_WEEKLY_MINUTE "$minute"
require_int RAINBOT_WEEKLY_MAX_TURNS "$max_turns"
require_int RAINBOT_WEEKLY_ATTEMPTS "$attempts"

mkdir -p "$app_support" "$log_dir" "$launch_agents"

cat > "$wrapper" <<EOF
#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:\$PATH"
cd "$repo_root"

exec /usr/bin/env npm run rainbot:weekly -- \\
  --max-turns "$max_turns" \\
  --attempts "$attempts"
EOF
chmod 755 "$wrapper"

cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$wrapper</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$repo_root</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>$weekday</integer>
    <key>Hour</key>
    <integer>$hour</integer>
    <key>Minute</key>
    <integer>$minute</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$log_dir/weekly-games.log</string>
  <key>StandardErrorPath</key>
  <string>$log_dir/weekly-games.err.log</string>
</dict>
</plist>
EOF

plutil -lint "$plist"
launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$plist"
launchctl print "gui/$(id -u)/$label"

echo "Installed $label"
echo "Schedule: weekday=$weekday hour=$hour minute=$minute"
echo "Wrapper: $wrapper"
echo "Logs: $log_dir/weekly-games.log"
