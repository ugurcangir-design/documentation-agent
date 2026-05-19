#!/usr/bin/env bash
# Run by /api/update/run. Pulls latest from origin/main, installs any new
# deps, rebuilds the client, then kills the running servers and relaunches.
# Output streamed to data/logs/update.log.

set -e

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT/data/logs"
LOG="$LOG_DIR/update.log"
mkdir -p "$LOG_DIR"

# Pull the user's login PATH so git/node/npm/claude all resolve.
LOGIN_PATH="$(/bin/zsh -lic 'echo $PATH' 2>/dev/null)"
export PATH="${LOGIN_PATH}:$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

cd "$PROJECT"

{
  echo
  echo "[$(date)] ============ UPDATE BAŞLADI ============"

  PRE=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  echo "[$(date)] Önceki commit: $PRE"

  echo "[$(date)] git fetch origin main"
  git fetch origin main

  echo "[$(date)] git reset --hard origin/main"
  git reset --hard origin/main

  POST=$(git rev-parse HEAD)
  echo "[$(date)] Yeni commit: $POST"

  if [ "$PRE" = "$POST" ]; then
    echo "[$(date)] Değişiklik yok — zaten güncel"
  else
    CHANGED=$(git diff --name-only "$PRE..$POST" | tr '\n' ' ')
    echo "[$(date)] Değişen dosyalar: $CHANGED"

    # Root deps
    if echo "$CHANGED" | grep -q "package.json\|package-lock.json"; then
      echo "[$(date)] Root npm install gerekli"
      npm install --no-fund --no-audit
    fi

    # Client deps
    if echo "$CHANGED" | grep -qE "(^| )client/package"; then
      echo "[$(date)] Client npm install gerekli"
      (cd client && npm install --no-fund --no-audit)
    fi

    # Client always rebuilt (cheap; ensures latest CSS+JS shipped)
    echo "[$(date)] Client build"
    (cd client && node_modules/.bin/vite build)
  fi

  # Force-relaunch: kill ports, then exec launch.sh which will boot
  # supervisor + open browser.
  echo "[$(date)] Sunucular yeniden başlatılıyor"
  lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti tcp:5173 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
  pkill -f "tsx src/server" 2>/dev/null || true
  pkill -f "node.*supervisor.js" 2>/dev/null || true
  sleep 2

  echo "[$(date)] launch.sh çağrılıyor"
  exec "$PROJECT/scripts/launch.sh"
} >> "$LOG" 2>&1
