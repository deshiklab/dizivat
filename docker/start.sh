#!/usr/bin/env bash
# Starts the API (migrations + first-boot seed), waits until it is healthy, then the web server.
# If either process exits, the container exits so the platform restarts it.
set -uo pipefail

node --max-old-space-size="${API_HEAP_MB:-192}" --enable-source-maps api/dist/main.js &
API=$!
trap 'kill -TERM $API ${WEB:-} 2>/dev/null; wait; exit 0' TERM INT

for i in $(seq 1 180); do
  if node -e "fetch('http://127.0.0.1:${API_PORT:-4000}/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then break; fi
  kill -0 $API 2>/dev/null || { echo "API exited during start-up"; exit 1; }
  sleep 1
done

node --max-old-space-size="${WEB_HEAP_MB:-224}" server.js &
WEB=$!
wait -n $API $WEB
echo "a process exited — stopping the container"
kill -TERM $API $WEB 2>/dev/null
wait
exit 1
