#!/usr/bin/env bash
set -euo pipefail

# Claude Bridge Server — stop script

PORT="${BRIDGE_PORT:-3210}"
PIDS=$(lsof -ti:"$PORT" 2>/dev/null || true)

if [[ -z "$PIDS" ]]; then
  echo "No bridge server running on port $PORT"
  exit 0
fi

echo "$PIDS" | xargs kill -9
echo "Bridge server stopped (port $PORT)"
