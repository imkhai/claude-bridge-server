#!/usr/bin/env bash
set -euo pipefail

# Claude Bridge Server — startup script
# Usage: ./start.sh [--background]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Defaults (override with env vars)
echo $HOME
export WORKSPACE="$HOME/prod-data/bridge-data"
export BIND_HOST="${BIND_HOST:-0.0.0.0}"
export BRIDGE_PORT="${BRIDGE_PORT:-3210}"
export MAX_PARALLEL="${MAX_PARALLEL:-8}"
export TIMEOUT_MS="${TIMEOUT_MS:-900000}"
export DEFAULT_ALLOWED_TOOLS="${DEFAULT_ALLOWED_TOOLS:-Read,Write,Edit,Bash,Glob,Grep}"
export CHAT_WORKING_DIR="${CHAT_WORKING_DIR:-$SCRIPT_DIR}"
export LOG_LEVEL="${LOG_LEVEL:-info}"

if [[ "${1:-}" == "--background" ]]; then
  node "$SCRIPT_DIR/server.mjs" > /tmp/bridge-server.log 2>&1 &
  PID=$!
  sleep 2
  if kill -0 "$PID" 2>/dev/null; then
    echo "Bridge server started (PID $PID)"
    echo "  Port:         $BRIDGE_PORT"
    echo "  Workspace:    $WORKSPACE"
    echo "  Workers:      $MAX_PARALLEL"
    echo "  Log:          /tmp/bridge-server.log"
    echo "  Dashboard:    http://localhost:$BRIDGE_PORT/dashboard/"
    echo "  Chat:         http://localhost:$BRIDGE_PORT/chat/"
  else
    echo "Failed to start. Check /tmp/bridge-server.log"
    exit 1
  fi
else
  exec node "$SCRIPT_DIR/server.mjs"
fi
