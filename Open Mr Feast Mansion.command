#!/bin/zsh

set -u

ROOT_DIR="${0:A:h}"
HOST="127.0.0.1"
PORT="${MR_FEAST_PORT:-8000}"
MANSION_PATH="/games/mr-feast-mansion.html"
MANSION_URL="http://${HOST}:${PORT}${MANSION_PATH}"
PID_FILE="${ROOT_DIR}/.mr-feast-local-server.pid"
LOG_FILE="${ROOT_DIR}/.mr-feast-local-server.log"

page_is_ready() {
  /usr/bin/curl --silent --show-error --fail --max-time 2 "${MANSION_URL}" 2>/dev/null \
    | /usr/bin/grep --fixed-strings --quiet "Mr Feast's Mansion"
}

pause_on_error() {
  print ""
  read "REPLY?Press Return to close this window..."
  exit 1
}

open_mansion() {
  if [[ "${MR_FEAST_NO_OPEN:-0}" != "1" ]]; then
    /usr/bin/open "${MANSION_URL}"
  fi
}

cleanup_server() {
  if [[ -n "${SERVER_PID:-}" ]] && /bin/kill -0 "${SERVER_PID}" 2>/dev/null; then
    /bin/kill "${SERVER_PID}" 2>/dev/null || true
  fi
  if [[ -f "${PID_FILE}" ]] && [[ "$(/bin/cat "${PID_FILE}" 2>/dev/null || true)" == "${SERVER_PID:-}" ]]; then
    /bin/rm -f "${PID_FILE}"
  fi
}

cd "${ROOT_DIR}" || {
  print "Could not open the RainbotGaming folder."
  pause_on_error
}

if page_is_ready; then
  print "Mr Feast's Mansion is already available at:"
  print "${MANSION_URL}"
  open_mansion
  exit 0
fi

if [[ -f "${PID_FILE}" ]]; then
  previous_pid="$(/bin/cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ "${previous_pid}" == <-> ]] && /bin/kill -0 "${previous_pid}" 2>/dev/null; then
    print "Restarting the previous local mansion server..."
    /bin/kill "${previous_pid}" 2>/dev/null || true
    for _ in {1..20}; do
      /bin/kill -0 "${previous_pid}" 2>/dev/null || break
      /bin/sleep 0.1
    done
  fi
  /bin/rm -f "${PID_FILE}"
fi

if /usr/sbin/lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  print "Port ${PORT} is being used by another program."
  print "Close that local server, then double-click this launcher again."
  pause_on_error
fi

PYTHON_BIN="$(command -v python3 2>/dev/null || true)"
if [[ -z "${PYTHON_BIN}" ]]; then
  print "Python 3 is required to start the local mansion server."
  print "Install Python 3, then double-click this launcher again."
  pause_on_error
fi

print "Starting the local mansion server..."
"${PYTHON_BIN}" -m http.server "${PORT}" \
  --bind 127.0.0.1 --directory "${ROOT_DIR}" \
  >"${LOG_FILE}" 2>&1 </dev/null &
SERVER_PID=$!
print "${SERVER_PID}" > "${PID_FILE}"
trap cleanup_server EXIT INT TERM HUP

for _ in {1..60}; do
  if page_is_ready; then
    print "Mr Feast's Mansion is ready:"
    print "${MANSION_URL}"
    open_mansion
    print ""
    print "Keep this window open while testing. Close it to stop the local server."
    wait "${SERVER_PID}"
    exit $?
  fi
  /bin/kill -0 "${SERVER_PID}" 2>/dev/null || break
  /bin/sleep 0.1
done

print "The local mansion server did not start."
print "Details were written to ${LOG_FILE}"
/bin/rm -f "${PID_FILE}"
pause_on_error
