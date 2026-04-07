#!/bin/bash
# ============================================================
# Claude Bridge — Code Refactoring Pipeline Test
# ============================================================
# Simulates: Analyzer → Refactorer → Reviewer
# Usage: ./tests/test-refactoring.sh
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
assert_contains() {
  if echo "$1" | grep -qi "$2"; then green "$3"; else red "$3 (missing: $2)"; fi
}

json_field() { python3 -c "import sys,json; print(json.load(open('$1')).get('$2',''))"; }

cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

# ──────────────────────────────────────────────────────────

bold "Code Refactoring Pipeline"
info "Target: messy UserService with code smells"

cat > "$TMPDIR/chain.json" << 'ENDJSON'
{
  "steps": [
    {
      "prompt": "You are a Code Quality Analyst. Analyze this code for smells and issues: 1) Code smells (long method, deep nesting, magic values, boolean params) 2) SOLID violations 3) SQL injection risk 4) Readability problems. Rank each issue by severity.\n\nCode:\nclass UserService {\n  async getUser(id, type, includeOrders, includeAddress, format) {\n    let user = await db.query(\"SELECT * FROM users WHERE id = \" + id);\n    if (user) {\n      if (type === \"admin\") {\n        user.permissions = [\"read\", \"write\", \"delete\", \"admin\"];\n        if (includeOrders) {\n          user.orders = await db.query(\"SELECT * FROM orders WHERE user_id = \" + id);\n          if (format === \"summary\") {\n            user.orders = user.orders.map(o => ({ id: o.id, total: o.total }));\n          }\n        }\n        if (includeAddress) {\n          user.address = await db.query(\"SELECT * FROM addresses WHERE user_id = \" + id + \" LIMIT 1\");\n        }\n      } else if (type === \"customer\") {\n        user.permissions = [\"read\"];\n        if (includeOrders) {\n          user.orders = await db.query(\"SELECT * FROM orders WHERE user_id = \" + id + \" AND status != 'cancelled'\");\n        }\n      }\n    }\n    return user;\n  }\n}",
      "agentId": "code-analyst"
    },
    {
      "prompt": "You are a Senior Engineer. Based on the analysis, refactor the code. Apply: parameterized queries, early returns, extract methods, use constants/enums, reduce boolean parameters (use options object). Show complete refactored code. Preserve behavior exactly.",
      "agentId": "refactorer",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are a Code Reviewer. Compare the refactored code with the original issues. Check: 1) All issues addressed? 2) Behavior preserved? 3) Any new issues? 4) Suggest 3 unit tests to verify equivalence. End with VERDICT: APPROVED or VERDICT: NEEDS CHANGES.",
      "agentId": "refactor-reviewer",
      "usesPreviousResult": true
    }
  ]
}
ENDJSON

RESP=$(curl -s -X POST "$BASE/chain" -H "Content-Type: application/json" -d @"$TMPDIR/chain.json")
CHAIN_ID=$(python3 -c "import sys,json; print(json.load(sys.stdin)['chainId'])" <<< "$RESP")
info "Chain: $CHAIN_ID"

info "Running refactoring pipeline..."
for i in $(seq 1 60); do
  sleep 5
  curl -s "$BASE/chain/$CHAIN_ID" > "$TMPDIR/status.json"
  STATUS=$(json_field "$TMPDIR/status.json" status)
  STEP=$(json_field "$TMPDIR/status.json" currentStep)
  NAMES=("code-analyst" "refactorer" "refactor-reviewer")
  IDX=$((STEP-1))
  if [ $IDX -ge 0 ] && [ $IDX -lt 3 ]; then
    printf "\r\033[33m  ▸ Step %s/3 (%s): %s     \033[0m" "$STEP" "${NAMES[$IDX]}" "$STATUS"
  fi
  if [ "$STATUS" != "running" ]; then break; fi
done
echo ""

assert_eq "$STATUS" "done" "refactoring pipeline completed"

# Verify each step
NAMES=("code-analyst" "refactorer" "refactor-reviewer")
for i in 0 1 2; do
  STEP_STATUS=$(python3 -c "import sys,json; print(json.load(open('$TMPDIR/status.json'))['steps'][$i]['status'])")
  assert_eq "$STEP_STATUS" "done" "${NAMES[$i]} completed"
done

# Check analyst found SQL injection
ANALYST_TID=$(python3 -c "import sys,json; print(json.load(open('$TMPDIR/status.json'))['steps'][0]['taskId'])")
curl -s "$BASE/status/$ANALYST_TID" > "$TMPDIR/analyst.json"
assert_contains "$(json_field "$TMPDIR/analyst.json" result)" "injection" "analyst found SQL injection risk"

# Check refactorer produced code
REFACTORER_TID=$(python3 -c "import sys,json; print(json.load(open('$TMPDIR/status.json'))['steps'][1]['taskId'])")
curl -s "$BASE/status/$REFACTORER_TID" > "$TMPDIR/refactorer.json"
assert_contains "$(json_field "$TMPDIR/refactorer.json" result)" "class" "refactorer output contains class definition"

# Check reviewer gave verdict
REVIEWER_TID=$(python3 -c "import sys,json; print(json.load(open('$TMPDIR/status.json'))['steps'][2]['taskId'])")
curl -s "$BASE/status/$REVIEWER_TID" > "$TMPDIR/reviewer.json"
RFILE=$(json_field "$TMPDIR/reviewer.json" resultFile)
if grep -qE "VERDICT:" "$RFILE" 2>/dev/null; then
  VERDICT=$(grep -oE "VERDICT: [A-Z ]+" "$RFILE" | head -1)
  green "reviewer gave verdict: $VERDICT"
else
  red "reviewer did not give a verdict"
fi

# ──────────────────────────────────────────────────────────

bold "SUMMARY"
echo ""
printf "  Pipeline: Code Analyst → Refactorer → Reviewer\n"
printf "  \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
echo ""
if [ "$FAIL" -gt 0 ]; then exit 1; fi
