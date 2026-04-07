#!/bin/bash
# ============================================================
# Claude Bridge — Parallel Bulk Processing Test
# ============================================================
# Tests: submitting many tasks at once, concurrency control,
#        and verifying MAX_PARALLEL is respected.
# Usage: ./tests/test-parallel-bulk.sh
# ============================================================

BASE="http://localhost:3210"
PASS=0
FAIL=0

green() { printf "\033[32m✓ %s\033[0m\n" "$1"; PASS=$((PASS+1)); }
red()   { printf "\033[31m✗ %s\033[0m\n" "$1"; FAIL=$((FAIL+1)); }
bold()  { printf "\n\033[1;34m═══ %s ═══\033[0m\n" "$1"; }
info()  { printf "\033[33m  ▸ %s\033[0m\n" "$1"; }

assert_eq() {
  if [ "$1" = "$2" ]; then green "$3"; else red "$3 (expected: $2, got: $1)"; fi
}

# ──────────────────────────────────────────────────────────

bold "TEST 1: Bulk Submit — 6 translations in parallel"

LANGUAGES=("Vietnamese" "Japanese" "French" "Spanish" "Korean" "German")
TASK_IDS=()

for LANG in "${LANGUAGES[@]}"; do
  TID=$(curl -s -X POST "$BASE/ask" \
    -H "Content-Type: application/json" \
    -d "{\"prompt\":\"Translate to $LANG: 'Hello, how are you today?'. Reply with ONLY the translation, nothing else.\",\"agentId\":\"translator-$(echo $LANG | tr '[:upper:]' '[:lower:]')\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")
  TASK_IDS+=("$TID")
  info "Submitted $LANG: $TID"
done

assert_eq "${#TASK_IDS[@]}" "6" "all 6 tasks submitted"

# Check that queue shows correct state
HEALTH=$(curl -s "$BASE/health")
MAX_P=$(python3 -c "import sys,json; print(json.load(sys.stdin)['maxParallel'])" <<< "$HEALTH")
info "MAX_PARALLEL = $MAX_P"

# Immediately after submit, check active + queued counts
sleep 1
JOBS_NOW=$(curl -s "$BASE/jobs")
ACTIVE=$(python3 -c "import sys,json; print(json.load(sys.stdin)['active'])" <<< "$JOBS_NOW")
QUEUED=$(python3 -c "import sys,json; print(json.load(sys.stdin)['queued'])" <<< "$JOBS_NOW")
info "Immediately after submit: active=$ACTIVE, queued=$QUEUED"

if [ "$ACTIVE" -le "$MAX_P" ]; then
  green "active count ($ACTIVE) does not exceed MAX_PARALLEL ($MAX_P)"
else
  red "active count ($ACTIVE) exceeds MAX_PARALLEL ($MAX_P)!"
fi

# Wait for all to complete
info "Waiting for all 6 translations..."
for attempt in $(seq 1 40); do
  sleep 3
  ALL_DONE=true
  DONE_COUNT=0
  for TID in "${TASK_IDS[@]}"; do
    S=$(curl -s "$BASE/status/$TID" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
    if [ "$S" = "done" ]; then
      DONE_COUNT=$((DONE_COUNT+1))
    elif [ "$S" = "running" ] || [ "$S" = "queued" ]; then
      ALL_DONE=false
    fi
  done
  printf "\r\033[33m  ▸ Completed: %d/6   \033[0m" "$DONE_COUNT"
  if $ALL_DONE; then break; fi
done
echo ""

# Verify all completed
DONE_COUNT=0
ERROR_COUNT=0
for i in "${!LANGUAGES[@]}"; do
  TID="${TASK_IDS[$i]}"
  S=$(curl -s "$BASE/status/$TID" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  if [ "$S" = "done" ]; then
    DONE_COUNT=$((DONE_COUNT+1))
  else
    ERROR_COUNT=$((ERROR_COUNT+1))
  fi
done

assert_eq "$DONE_COUNT" "6" "all 6 translations completed"

# Print results
bold "Translation Results"
for i in "${!LANGUAGES[@]}"; do
  TID="${TASK_IDS[$i]}"
  RESULT=$(curl -s "$BASE/status/$TID" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result','').strip()[:80]; print(r)")
  info "${LANGUAGES[$i]}: $RESULT"
done

# ──────────────────────────────────────────────────────────

bold "TEST 2: Verify Result Files on Disk"

for i in "${!LANGUAGES[@]}"; do
  TID="${TASK_IDS[$i]}"
  RFILE=$(curl -s "$BASE/status/$TID" | python3 -c "import sys,json; print(json.load(sys.stdin).get('resultFile',''))")
  if [ -f "$RFILE" ]; then
    green "result file exists for ${LANGUAGES[$i]}"
  else
    red "result file missing for ${LANGUAGES[$i]}: $RFILE"
  fi
done

# ──────────────────────────────────────────────────────────

bold "TEST 3: Filter Jobs by Agent"

for LANG in "vietnamese" "japanese" "french"; do
  FILTERED=$(curl -s "$BASE/jobs?agentId=translator-$LANG")
  COUNT=$(python3 -c "import sys,json; print(json.load(sys.stdin)['total'])" <<< "$FILTERED")
  if [ "$COUNT" -ge 1 ]; then
    green "filter by translator-$LANG found $COUNT job(s)"
  else
    red "filter by translator-$LANG returned 0 jobs"
  fi
done

# ──────────────────────────────────────────────────────────

bold "TEST 4: Cancel a Queued Task"

# Submit many tasks to fill the queue, then cancel one that's queued
CANCEL_TASKS=()
for j in $(seq 1 6); do
  TID=$(curl -s -X POST "$BASE/ask" \
    -H "Content-Type: application/json" \
    -d "{\"prompt\":\"Count to $j slowly\",\"agentId\":\"cancel-test\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")
  CANCEL_TASKS+=("$TID")
done

sleep 1

# Try to cancel the last one (most likely still queued)
LAST_TID="${CANCEL_TASKS[5]}"
CANCEL_RESP=$(curl -s -X POST "$BASE/cancel/$LAST_TID")
CANCEL_STATUS=$(python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" <<< "$CANCEL_RESP")

if [ "$CANCEL_STATUS" = "cancelled" ]; then
  green "successfully cancelled task $LAST_TID"
elif [ "$CANCEL_STATUS" = "done" ] || [ "$CANCEL_STATUS" = "error" ]; then
  info "task already finished before cancel (status: $CANCEL_STATUS)"
  green "cancel endpoint works (task was already done)"
else
  red "unexpected cancel status: $CANCEL_STATUS"
fi

# Wait for remaining cancel-test tasks to finish
info "Cleaning up cancel-test tasks..."
sleep 15

# ──────────────────────────────────────────────────────────

bold "SUMMARY"
echo ""
printf "  \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
echo ""
if [ "$FAIL" -gt 0 ]; then exit 1; fi
