#!/usr/bin/env bash
# DocAgent launcher — single icon. Starts supervisor (Express + Vite + heartbeat
# monitor) and opens the default browser. When the user closes the browser tab,
# the heartbeat times out → server exits → supervisor kills vite → all gone.

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT/data/logs"
URL="http://localhost:5173"
SERVER_PORT=3000
CLIENT_PORT=5173

mkdir -p "$LOG_DIR"

is_port_alive() { lsof -ti tcp:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

wait_for_port() {
  local port="$1" timeout=30 i=0
  while (( i < timeout )); do
    is_port_alive "$port" && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

# Already running → just open browser
if is_port_alive "$SERVER_PORT" && is_port_alive "$CLIENT_PORT"; then
  open "$URL"
  exit 0
fi

# Free half-started ports
is_port_alive "$SERVER_PORT" && lsof -ti tcp:"$SERVER_PORT" | xargs kill -9 2>/dev/null
is_port_alive "$CLIENT_PORT" && lsof -ti tcp:"$CLIENT_PORT" | xargs kill -9 2>/dev/null

# Find node
NODE_BIN="$(which node 2>/dev/null || echo /usr/local/bin/node)"

if [ ! -x "$NODE_BIN" ] || [ ! -x "$PROJECT/node_modules/.bin/tsx" ]; then
  osascript -e "display alert \"DocAgent kurulumu eksik\" message \"cd $PROJECT && npm install && cd client && npm install\""
  exit 1
fi

# Start supervisor as a detached background process
nohup "$NODE_BIN" "$PROJECT/scripts/supervisor.js" \
  > "$LOG_DIR/supervisor.log" 2>&1 &
disown $! 2>/dev/null

# Wait for both ports and open the browser
if wait_for_port "$SERVER_PORT" && wait_for_port "$CLIENT_PORT"; then
  open "$URL"
else
  osascript -e "display alert \"DocAgent başlatılamadı\" message \"Log: $LOG_DIR/supervisor.log\""
  exit 1
fi
