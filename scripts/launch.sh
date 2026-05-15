#!/usr/bin/env bash
# DocAgent launcher — starts Express + Vite as detached background
# processes and opens the default browser. Idempotent.

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT/data/logs"
PID_FILE="$LOG_DIR/docagent.pids"
URL="http://localhost:5173"
SERVER_PORT=3000
CLIENT_PORT=5173

mkdir -p "$LOG_DIR"

is_port_alive() {
  lsof -ti tcp:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_port() {
  local port="$1"
  local timeout=30
  local i=0
  while (( i < timeout )); do
    is_port_alive "$port" && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# ── If both servers already running, just open browser ────────────
if is_port_alive "$SERVER_PORT" && is_port_alive "$CLIENT_PORT"; then
  echo "[DocAgent] Already running — opening browser"
  open "$URL"
  exit 0
fi

# ── Free any half-started ports ──────────────────────────────────
is_port_alive "$SERVER_PORT" && lsof -ti tcp:"$SERVER_PORT" | xargs kill -9 2>/dev/null
is_port_alive "$CLIENT_PORT" && lsof -ti tcp:"$CLIENT_PORT" | xargs kill -9 2>/dev/null

# ── Resolve binaries ─────────────────────────────────────────────
TSX_BIN="$PROJECT/node_modules/.bin/tsx"
VITE_BIN="$PROJECT/client/node_modules/.bin/vite"

if [ ! -x "$TSX_BIN" ] || [ ! -x "$VITE_BIN" ]; then
  osascript -e "display alert \"DocAgent kurulumu eksik\" message \"Önce şunu çalıştır:\n\ncd $PROJECT\nnpm install\ncd client && npm install\""
  exit 1
fi

# ── Start servers detached ───────────────────────────────────────
echo "[DocAgent] Starting Express…"
nohup "$TSX_BIN" "$PROJECT/src/server/app.ts" \
  > "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!
disown $SERVER_PID 2>/dev/null

echo "[DocAgent] Starting Vite…"
(
  cd "$PROJECT/client"
  nohup "$VITE_BIN" > "$LOG_DIR/client.log" 2>&1 &
  echo $! > "$LOG_DIR/.client_pid"
)
CLIENT_PID=$(cat "$LOG_DIR/.client_pid")
rm -f "$LOG_DIR/.client_pid"

# Save PIDs for later stop
{
  echo "$SERVER_PID"
  echo "$CLIENT_PID"
} > "$PID_FILE"

# ── Wait for both ports ──────────────────────────────────────────
echo "[DocAgent] Waiting for servers…"
if wait_for_port "$SERVER_PORT" && wait_for_port "$CLIENT_PORT"; then
  echo "[DocAgent] Ready → $URL"
  open "$URL"
else
  osascript -e "display alert \"DocAgent başlatılamadı\" message \"Loglar: $LOG_DIR/server.log, $LOG_DIR/client.log\""
  exit 1
fi
