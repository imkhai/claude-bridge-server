#!/bin/bash
# ============================================================
# Claude Bridge — Basic Endpoint Tests
# ============================================================
# Usage: ./tests/test-basic.sh
# Requires: server running on localhost:3210
# ============================================================

BASE="http://localhost:3210"
PASS=0
FAIL=0

green() { printf "\033[32m✓ %s\033[0m\n" "$1"; PASS=$((PASS+1)); }
red()   { printf "\033[31m✗ %s\033[0m\n" "$1"; FAIL=$((FAIL+1)); }
bold()  { printf "\n\033[1m── %s ──\033[0m\n" "$1"; }

assert_eq() {
  local actual="$1" expected="$2" label="$3"
  if [ "$actual" = "$expected" ]; then green "$label"; else red "$label (expected: $expected, got: $actual)"; fi
}

assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  if echo "$haystack" | grep -q "$needle"; then green "$label"; else red "$label (missing: $needle)"; fi
}

json_field() { python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))" <<< "$2"; }

# ──────────────────────────────────────────────────────────

bold "TEST 1: Health Check"

RESP=$(curl -sf "$BASE/health")
assert_eq "$(json_field ok "$RESP")" "True" "health.ok is true"
assert_contains "$RESP" "maxParallel" "health has maxParallel"
assert_contains "$RESP" "workspace" "health has workspace"
assert_contains "$RESP" "uptime" "health has uptime"
assert_contains "$RESP" "totalProcessed" "health has totalProcessed"

# ──────────────────────────────────────────────────────────

bold "TEST 2: Validation — missing prompt"

RESP=$(curl -s -X POST "$BASE/ask" -H "Content-Type: application/json" -d '{}')
assert_contains "$RESP" "prompt" "returns error about prompt"

RESP=$(curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" -d '{"prompt":123}')
assert_contains "$RESP" "prompt" "rejects non-string prompt"

# ──────────────────────────────────────────────────────────

bold "TEST 3: Validation — missing chain steps"

RESP=$(curl -s -X POST "$BASE/chain" -H "Content-Type: application/json" -d '{}')
assert_contains "$RESP" "steps" "chain rejects missing steps"

RESP=$(curl -s -X POST "$BASE/chain" -H "Content-Type: application/json" -d '{"steps":[]}')
assert_contains "$RESP" "steps" "chain rejects empty steps"

# ──────────────────────────────────────────────────────────

bold "TEST 4: 404 — unknown task"

RESP=$(curl -s "$BASE/status/nonexistent")
assert_contains "$RESP" "not found" "status returns 404 message"

HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/status/nonexistent")
assert_eq "$HTTP" "404" "status returns 404 code"

# ──────────────────────────────────────────────────────────

bold "TEST 5: 404 — unknown chain"

RESP=$(curl -s "$BASE/chain/chain-nonexist")
assert_contains "$RESP" "not found" "chain returns 404 message"

HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/chain/chain-nonexist")
assert_eq "$HTTP" "404" "chain returns 404 code"

# ──────────────────────────────────────────────────────────

bold "TEST 6: 404 — cancel unknown task"

RESP=$(curl -s -X POST "$BASE/cancel/nonexistent")
assert_contains "$RESP" "not found" "cancel returns 404 message"

HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/cancel/nonexistent")
assert_eq "$HTTP" "404" "cancel returns 404 code"

# ──────────────────────────────────────────────────────────

bold "TEST 7: Async submit returns taskId"

RESP=$(curl -s -X POST "$BASE/ask" -H "Content-Type: application/json" \
  -d '{"prompt":"What is 1+1? One word.","agentId":"test-basic"}')
TASK_ID=$(json_field taskId "$RESP")
assert_contains "$RESP" "taskId" "async returns taskId"
assert_contains "$RESP" "position" "async returns position"

# Wait for completion
sleep 10

RESP=$(curl -s "$BASE/status/$TASK_ID")
STATUS=$(json_field status "$RESP")
assert_eq "$STATUS" "done" "async task completes"
assert_contains "$RESP" "resultFile" "completed task has resultFile"

# ──────────────────────────────────────────────────────────

bold "TEST 8: Sync submit returns result"

RESP=$(curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" \
  -d '{"prompt":"What is 3+3? Answer with just the number.","agentId":"test-sync"}')
STATUS=$(json_field status "$RESP")
assert_eq "$STATUS" "done" "sync task completes"
assert_contains "$RESP" "result" "sync has result"
assert_contains "$RESP" "duration" "sync has duration"
assert_contains "$RESP" "resultFile" "sync has resultFile"

# ──────────────────────────────────────────────────────────

bold "TEST 9: Inline context"

RESP=$(curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" \
  -d '{"prompt":"What does this function return?","agentId":"test-ctx","context":"function f() { return 42; }"}')
STATUS=$(json_field status "$RESP")
assert_eq "$STATUS" "done" "context task completes"
assert_contains "$RESP" "42" "result references the context"

# ──────────────────────────────────────────────────────────

bold "TEST 10: Jobs list"

RESP=$(curl -s "$BASE/jobs")
assert_contains "$RESP" "active" "jobs has active count"
assert_contains "$RESP" "maxParallel" "jobs has maxParallel"
assert_contains "$RESP" "jobs" "jobs has jobs array"

RESP_FILTERED=$(curl -s "$BASE/jobs?agentId=test-sync")
assert_contains "$RESP_FILTERED" "test-sync" "jobs filter by agentId works"

# ──────────────────────────────────────────────────────────

bold "TEST 11: Result file on disk"

RESULT_FILE=$(json_field resultFile "$(curl -s "$BASE/status/$TASK_ID")")
if [ -f "$RESULT_FILE" ]; then
  green "result file exists on disk"
  assert_contains "$(cat "$RESULT_FILE")" "# Result:" "result file has header"
  assert_contains "$(cat "$RESULT_FILE")" "Agent:" "result file has agent"
  assert_contains "$(cat "$RESULT_FILE")" "Duration:" "result file has duration"
else
  red "result file not found: $RESULT_FILE"
fi

# ──────────────────────────────────────────────────────────

bold "SUMMARY"
echo ""
printf "  \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then exit 1; fi
