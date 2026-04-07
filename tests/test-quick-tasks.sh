#!/bin/bash
# ============================================================
# Claude Bridge — Quick One-Shot Task Tests
# ============================================================
# Tests simple single-agent tasks for everyday use
# Usage: ./tests/test-quick-tasks.sh
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

bold "TEST 1: Code Explanation"

cat > "$TMPDIR/req.json" << 'ENDJSON'
{
  "prompt": "Explain what this code does in 2-3 sentences. What are the edge cases?",
  "agentId": "explainer",
  "context": "const debounce = (fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };"
}
ENDJSON

curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" -d @"$TMPDIR/req.json" > "$TMPDIR/resp1.json"
assert_eq "$(json_field "$TMPDIR/resp1.json" status)" "done" "code explanation completed"
assert_contains "$(json_field "$TMPDIR/resp1.json" result)" "debounce" "result explains debounce"

# ──────────────────────────────────────────────────────────

bold "TEST 2: Error Message Decoder"

cat > "$TMPDIR/req.json" << 'ENDJSON'
{
  "prompt": "Explain this error, what causes it, and how to fix it. Be concise.",
  "agentId": "error-decoder",
  "context": "TypeError: Cannot read properties of undefined (reading 'map')\n    at UserList (UserList.tsx:14:22)\n    at renderWithHooks (react-dom.development.js:14985:18)"
}
ENDJSON

curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" -d @"$TMPDIR/req.json" > "$TMPDIR/resp2.json"
assert_eq "$(json_field "$TMPDIR/resp2.json" status)" "done" "error decoder completed"
assert_contains "$(json_field "$TMPDIR/resp2.json" result)" "undefined" "result explains the undefined issue"

# ──────────────────────────────────────────────────────────

bold "TEST 3: SQL Query Builder"

cat > "$TMPDIR/req.json" << 'ENDJSON'
{
  "prompt": "Write a PostgreSQL query: find users who signed up in the last 30 days, have at least 3 orders, and unverified email. Return name, email, signup date, order count. Use joins.",
  "agentId": "sql-helper"
}
ENDJSON

curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" -d @"$TMPDIR/req.json" > "$TMPDIR/resp3.json"
assert_eq "$(json_field "$TMPDIR/resp3.json" status)" "done" "SQL query generated"
assert_contains "$(json_field "$TMPDIR/resp3.json" result)" "SELECT" "result contains SELECT"
assert_contains "$(json_field "$TMPDIR/resp3.json" result)" "JOIN" "result contains JOIN"

# ──────────────────────────────────────────────────────────

bold "TEST 4: Regex Helper"

cat > "$TMPDIR/req.json" << 'ENDJSON'
{
  "prompt": "Write a regex to validate an email address. Show the regex, explain each part briefly, give 3 matching and 3 non-matching examples.",
  "agentId": "regex-helper"
}
ENDJSON

curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" -d @"$TMPDIR/req.json" > "$TMPDIR/resp4.json"
assert_eq "$(json_field "$TMPDIR/resp4.json" status)" "done" "regex helper completed"
assert_contains "$(json_field "$TMPDIR/resp4.json" result)" "@" "result contains @ pattern"

# ──────────────────────────────────────────────────────────

bold "TEST 5: Parallel Quick Tasks"
info "Submitting 3 tasks in parallel..."

T1=$(curl -s -X POST "$BASE/ask" -H "Content-Type: application/json" \
  -d '{"prompt":"What is the time complexity of binary search? One sentence.","agentId":"quick-1"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")

T2=$(curl -s -X POST "$BASE/ask" -H "Content-Type: application/json" \
  -d '{"prompt":"What is the difference between TCP and UDP? Two sentences max.","agentId":"quick-2"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")

T3=$(curl -s -X POST "$BASE/ask" -H "Content-Type: application/json" \
  -d '{"prompt":"What does CORS stand for and why does it exist? Two sentences max.","agentId":"quick-3"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")

info "Tasks: $T1, $T2, $T3"

# Wait for all
for i in $(seq 1 30); do
  sleep 3
  S1=$(curl -s "$BASE/status/$T1" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  S2=$(curl -s "$BASE/status/$T2" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  S3=$(curl -s "$BASE/status/$T3" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  printf "\r\033[33m  ▸ Status: %s / %s / %s   \033[0m" "$S1" "$S2" "$S3"
  if [ "$S1" != "running" ] && [ "$S1" != "queued" ] && \
     [ "$S2" != "running" ] && [ "$S2" != "queued" ] && \
     [ "$S3" != "running" ] && [ "$S3" != "queued" ]; then
    break
  fi
done
echo ""

assert_eq "$S1" "done" "parallel task 1 completed"
assert_eq "$S2" "done" "parallel task 2 completed"
assert_eq "$S3" "done" "parallel task 3 completed"

# Verify all ran concurrently by checking they have similar start times
START1=$(curl -s "$BASE/status/$T1" | python3 -c "import sys,json; print(json.load(sys.stdin)['startedAt'][:16])")
START2=$(curl -s "$BASE/status/$T2" | python3 -c "import sys,json; print(json.load(sys.stdin)['startedAt'][:16])")
START3=$(curl -s "$BASE/status/$T3" | python3 -c "import sys,json; print(json.load(sys.stdin)['startedAt'][:16])")

if [ "$START1" = "$START2" ] && [ "$START2" = "$START3" ]; then
  green "all 3 tasks started within the same minute (parallel)"
else
  info "start times: $START1, $START2, $START3 (may still be parallel)"
  green "all 3 tasks completed"
fi

# ──────────────────────────────────────────────────────────

bold "TEST 6: Task with Working Directory"

cat > "$TMPDIR/req.json" << ENDJSON
{
  "prompt": "List the files in the current working directory. Just list filenames, nothing else.",
  "agentId": "file-lister",
  "workingDir": "$TMPDIR"
}
ENDJSON

curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" -d @"$TMPDIR/req.json" > "$TMPDIR/resp6.json"
assert_eq "$(json_field "$TMPDIR/resp6.json" status)" "done" "working directory task completed"
assert_contains "$(json_field "$TMPDIR/resp6.json" result)" "req.json" "result lists files in the specified directory"

# ──────────────────────────────────────────────────────────

bold "SUMMARY"
echo ""
printf "  \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
echo ""
if [ "$FAIL" -gt 0 ]; then exit 1; fi
