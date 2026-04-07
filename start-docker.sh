#!/bin/bash
# Start Claude Bridge in Docker, auto-extracting OAuth token from macOS keychain.
# Usage: ./start-docker.sh

set -e

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Extracting Claude OAuth token from macOS keychain..."
  ANTHROPIC_API_KEY=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])" 2>/dev/null)

  if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "ERROR: Could not extract token. Make sure Claude Code CLI is logged in (run: claude login)"
    exit 1
  fi
  echo "Token extracted successfully."
fi

export ANTHROPIC_API_KEY
docker compose up -d "$@"
echo ""
echo "Claude Bridge running at http://localhost:3210"
echo "Health check: curl http://localhost:3210/health"
