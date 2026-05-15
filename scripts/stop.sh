#!/usr/bin/env bash
# DocAgent stop script — kills background server processes.

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$PROJECT/data/logs/docagent.pids"
SERVER_PORT=3000
CLIENT_PORT=5173

# Kill by saved PIDs
if [ -f "$PID_FILE" ]; then
  while IFS= read -r pid; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done < "$PID_FILE"
  rm -f "$PID_FILE"
fi

# Belt + suspenders: kill anything still on our ports
lsof -ti tcp:"$SERVER_PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
lsof -ti tcp:"$CLIENT_PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null

osascript -e 'display notification "Sunucular kapatıldı" with title "DocAgent"' 2>/dev/null || true
