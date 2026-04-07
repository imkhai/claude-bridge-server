#!/bin/bash
# ============================================================
# Claude Bridge — Bug Investigation Workflow Test
# ============================================================
# Simulates: Reproducer → Root Cause → Fixer → Verifier
# Usage: ./tests/test-bug-investigation.sh
# ============================================================

BASE="http://localhost:3210"
PASS=0
FAIL=0
TMPDIR=$(mktemp -d)

green() { printf "\033[32m✓ %s\033[0m\n" "$1"; PASS=$((PASS+1)); }
red()   { printf "\033[31m✗ %s\033[0m\n" "$1"; FAIL=$((FAIL+1)); }
bold()  { printf "\n\033[1;34m═══ %s ═══\033[0m\n" "$1"; }
info()  { printf "\033[33m  ▸ %s\033[0m\n" "$1"; }

assert_eq() {
  if [ "$1" = "$2" ]; then green "$3"; else red "$3 (expected: $2, got: $1)"; fi
}

json_field() { python3 -c "import sys,json; print(json.load(open('$1')).get('$2',''))"; }

cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

# ──────────────────────────────────────────────────────────

bold "Bug Investigation Pipeline"
info "Bug: Login form submits twice causing race condition"

cat > "$TMPDIR/chain.json" << 'ENDJSON'
{
  "steps": [
    {
      "prompt": "You are a QA Engineer. Analyze this bug report and produce: 1) Reproduction steps 2) Expected vs actual behavior 3) Affected components 4) Severity. Keep it concise.\n\nBug: Users report the login form submits twice when clicking submit, causing duplicate API calls. Sometimes the user gets logged out immediately after login due to a race condition between the two requests.",
      "agentId": "reproducer"
    },
    {
      "prompt": "You are a Debugger. Based on the bug analysis, determine the root cause. Consider: missing debounce, event bubbling, React double-render in StrictMode, missing loading state guard. Output a clear diagnosis.",
      "agentId": "root-cause-analyst",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are a Senior Engineer. Based on the root cause, write the minimal fix. Show the buggy pattern (before) and fixed code (after). Keep changes minimal.",
      "agentId": "fixer",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are a Code Reviewer. Review the fix: 1) Does it address root cause? 2) Regression risk? 3) Edge cases (rapid clicks, slow network)? Write 3 test cases. End with VERDICT: APPROVED or VERDICT: NEEDS CHANGES.",
      "agentId": "verifier",
      "usesPreviousResult": true
    }
  ]
}
ENDJSON

RESP=$(curl -s -X POST "$BASE/chain" -H "Content-Type: application/json" -d @"$TMPDIR/chain.json")
CHAIN_ID=$(python3 -c "import sys,json; print(json.load(sys.stdin)['chainId'])" <<< "$RESP")
STEP_COUNT=$(python3 -c "import sys,json; print(len(json.load(sys.stdin)['steps']))" <<< "$RESP")

assert_eq "$STEP_COUNT" "4" "chain has 4 steps"
info "Chain: $CHAIN_ID"

# Poll until done
info "Running pipeline (this takes ~2-3 minutes)..."
for i in $(seq 1 60); do
  sleep 5
  curl -s "$BASE/chain/$CHAIN_ID" > "$TMPDIR/status.json"
  STATUS=$(json_field "$TMPDIR/status.json" status)
  STEP=$(json_field "$TMPDIR/status.json" currentStep)
  AGENTS=("reproducer" "root-cause-analyst" "fixer" "verifier")
  CURRENT_AGENT="${AGENTS[$((STEP-1))]}"
  printf "\r\033[33m  ▸ Step %s/4 (%s): %s     \033[0m" "$STEP" "$CURRENT_AGENT" "$STATUS"
  if [ "$STATUS" != "running" ]; then break; fi
done
echo ""

assert_eq "$STATUS" "done" "pipeline completed"

# Verify each step
for i in 0 1 2 3; do
  STEP_STATUS=$(python3 -c "import sys,json; print(json.load(open('$TMPDIR/status.json'))['steps'][$i]['status'])")
  STEP_TASKID=$(python3 -c "import sys,json; print(json.load(open('$TMPDIR/status.json'))['steps'][$i]['taskId'])")
  AGENT_NAMES=("reproducer" "root-cause-analyst" "fixer" "verifier")
  assert_eq "$STEP_STATUS" "done" "${AGENT_NAMES[$i]} completed"

  # Verify result file exists
  curl -s "$BASE/status/$STEP_TASKID" > "$TMPDIR/task-$i.json"
  RFILE=$(json_field "$TMPDIR/task-$i.json" resultFile)
  if [ -f "$RFILE" ]; then
    green "${AGENT_NAMES[$i]} result file exists"
  else
    red "${AGENT_NAMES[$i]} result file missing: $RFILE"
  fi
done

# Check verifier gave a verdict
VERIFIER_TASKID=$(python3 -c "import sys,json; print(json.load(open('$TMPDIR/status.json'))['steps'][3]['taskId'])")
curl -s "$BASE/status/$VERIFIER_TASKID" > "$TMPDIR/verifier.json"
VERIFIER_FILE=$(json_field "$TMPDIR/verifier.json" resultFile)
if grep -qE "VERDICT: (APPROVED|NEEDS CHANGES)" "$VERIFIER_FILE" 2>/dev/null; then
  VERDICT=$(grep -oE "VERDICT: (APPROVED|NEEDS CHANGES)" "$VERIFIER_FILE" | head -1)
  green "verifier gave verdict: $VERDICT"
else
  red "verifier did not give a clear verdict"
fi

# ──────────────────────────────────────────────────────────

bold "SUMMARY"
echo ""
printf "  Pipeline: Reproducer → Root Cause → Fixer → Verifier\n"
printf "  \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
echo ""
if [ "$FAIL" -gt 0 ]; then exit 1; fi
