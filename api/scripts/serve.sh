#!/usr/bin/env bash
# Local/CI helper: (re)start the built API in the background and return once /api/v1/health answers.
# Used as API_RESTART_CMD by scripts/api_native.py. Env: DATABASE_URL, SESSION_SECRET, API_PORT, API_PIDFILE, API_LOG.
set -euo pipefail
cd "$(dirname "$0")/.."
PIDFILE=${API_PIDFILE:-/tmp/dizivat-api.pid}
LOG=${API_LOG:-/tmp/dizivat-api.log}
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  PID=$(cat "$PIDFILE"); kill "$PID"
  while kill -0 "$PID" 2>/dev/null; do sleep 0.2; done
fi
nohup node --enable-source-maps dist/main.js >> "$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"
for _ in $(seq 1 120); do
  curl -sf "http://127.0.0.1:${API_PORT:-4000}/api/v1/health" > /dev/null && exit 0
  sleep 0.5
done
echo "API did not start"; tail -40 "$LOG"; exit 1
