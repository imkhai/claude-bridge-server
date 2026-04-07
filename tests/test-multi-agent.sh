#!/bin/bash
# ============================================================
# Claude Bridge — Multi-Agent Team Workflow Test
# ============================================================
# Simulates a full software team building a feature:
#
#   Phase 1 (parallel):  UI/UX Designer + Architect
#   Phase 2 (parallel):  Frontend Engineer + Backend Engineer
#   Phase 3 (sequential): Code Reviewer
#   Phase 4 (conditional): Fix if review fails
#
# Usage: ./tests/test-multi-agent.sh
# Requires: server running on localhost:3210
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
  local actual="$1" expected="$2" label="$3"
  if [ "$actual" = "$expected" ]; then green "$label"; else red "$label (expected: $expected, got: $actual)"; fi
}

json_field() { python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))" <<< "$2"; }

wait_task() {
  local task_id="$1" label="$2" max_wait="${3:-120}"
  local elapsed=0
  while [ $elapsed -lt $max_wait ]; do
    sleep 5
    elapsed=$((elapsed+5))
    local status=$(json_field status "$(curl -s "$BASE/status/$task_id")")
    if [ "$status" != "running" ] && [ "$status" != "queued" ]; then
      echo ""
      return 0
    fi
    printf "\r\033[33m  ▸ %s: %s (%ds)\033[0m" "$label" "$status" "$elapsed"
  done
  echo ""
  return 1
}

cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

# ──────────────────────────────────────────────────────────

bold "PHASE 1: Requirements & Design (Parallel)"
info "Submitting UI/UX Designer and Architect in parallel..."

# UI/UX Designer
cat > "$TMPDIR/designer.json" << 'ENDJSON'
{
  "prompt": "You are a UI/UX Designer. Design the user interface for user authentication with email/password login and JWT tokens. Include: 1) Screen list (login, register, forgot password) 2) Component layout for each screen 3) Validation rules 4) Error states and messages 5) Success flow. Output as a structured UI spec. Keep it concise.",
  "agentId": "ui-designer"
}
ENDJSON

RESP=$(curl -s -X POST "$BASE/ask" -H "Content-Type: application/json" -d @"$TMPDIR/designer.json")
DESIGNER_TASK=$(json_field taskId "$RESP")
info "UI/UX Designer: task=$DESIGNER_TASK"

# Architect
cat > "$TMPDIR/architect.json" << 'ENDJSON'
{
  "prompt": "You are a Software Architect. Design the system architecture for user authentication with email/password login and JWT tokens. Include: 1) API endpoints (method, path, request/response) 2) Data model (User table) 3) Auth flow (register, login, token refresh) 4) Security considerations. Output as a technical spec. Keep it concise.",
  "agentId": "architect"
}
ENDJSON

RESP=$(curl -s -X POST "$BASE/ask" -H "Content-Type: application/json" -d @"$TMPDIR/architect.json")
ARCHITECT_TASK=$(json_field taskId "$RESP")
info "Architect: task=$ARCHITECT_TASK"

# Wait for both
info "Waiting for Phase 1 to complete..."
wait_task "$DESIGNER_TASK" "UI/UX Designer"
wait_task "$ARCHITECT_TASK" "Architect"

DESIGNER_STATUS=$(json_field status "$(curl -s "$BASE/status/$DESIGNER_TASK")")
ARCHITECT_STATUS=$(json_field status "$(curl -s "$BASE/status/$ARCHITECT_TASK")")
assert_eq "$DESIGNER_STATUS" "done" "UI/UX Designer completed"
assert_eq "$ARCHITECT_STATUS" "done" "Architect completed"

DESIGNER_FILE=$(json_field resultFile "$(curl -s "$BASE/status/$DESIGNER_TASK")")
ARCHITECT_FILE=$(json_field resultFile "$(curl -s "$BASE/status/$ARCHITECT_TASK")")
info "Designer output: $DESIGNER_FILE"
info "Architect output: $ARCHITECT_FILE"

# ──────────────────────────────────────────────────────────

bold "PHASE 2: Implementation (Parallel)"
info "Submitting Frontend and Backend Engineers in parallel..."

# Frontend Engineer — reads UI design
python3 -c "
import json
print(json.dumps({
    'prompt': 'You are a Senior Frontend Engineer. Based on the UI spec in the context file, implement a React login form component in TypeScript. Include: form fields, validation, error display, submit handler. Keep it under 80 lines. Output only code.',
    'agentId': 'frontend-engineer',
    'contextFile': '$DESIGNER_FILE'
}))
" > "$TMPDIR/frontend.json"

RESP=$(curl -s -X POST "$BASE/ask" -H "Content-Type: application/json" -d @"$TMPDIR/frontend.json")
FRONTEND_TASK=$(json_field taskId "$RESP")
info "Frontend Engineer: task=$FRONTEND_TASK (reads UI design)"

# Backend Engineer — reads architecture
python3 -c "
import json
print(json.dumps({
    'prompt': 'You are a Senior Backend Engineer. Based on the architecture spec in the context file, implement the auth API with Express.js. Include: POST /register, POST /login routes with bcrypt and JWT. Keep it under 80 lines. Output only code.',
    'agentId': 'backend-engineer',
    'contextFile': '$ARCHITECT_FILE'
}))
" > "$TMPDIR/backend.json"

RESP=$(curl -s -X POST "$BASE/ask" -H "Content-Type: application/json" -d @"$TMPDIR/backend.json")
BACKEND_TASK=$(json_field taskId "$RESP")
info "Backend Engineer: task=$BACKEND_TASK (reads architecture)"

# Wait for both
info "Waiting for Phase 2 to complete..."
wait_task "$FRONTEND_TASK" "Frontend Engineer" 180
wait_task "$BACKEND_TASK" "Backend Engineer" 180

FRONTEND_STATUS=$(json_field status "$(curl -s "$BASE/status/$FRONTEND_TASK")")
BACKEND_STATUS=$(json_field status "$(curl -s "$BASE/status/$BACKEND_TASK")")
assert_eq "$FRONTEND_STATUS" "done" "Frontend Engineer completed"
assert_eq "$BACKEND_STATUS" "done" "Backend Engineer completed"

FRONTEND_FILE=$(json_field resultFile "$(curl -s "$BASE/status/$FRONTEND_TASK")")
BACKEND_FILE=$(json_field resultFile "$(curl -s "$BASE/status/$BACKEND_TASK")")
info "Frontend output: $FRONTEND_FILE"
info "Backend output: $BACKEND_FILE"

# ──────────────────────────────────────────────────────────

bold "PHASE 3: Code Review"

# Merge frontend + backend results as inline context for the reviewer
# (current limitation: only 1 contextFile per task, so we merge into a shared file)
info "Merging frontend + backend code for reviewer..."

MERGED_FILE="$TMPDIR/merged-code.md"
echo "=== FRONTEND CODE ===" > "$MERGED_FILE"
cat "$FRONTEND_FILE" >> "$MERGED_FILE"
echo "" >> "$MERGED_FILE"
echo "=== BACKEND CODE ===" >> "$MERGED_FILE"
cat "$BACKEND_FILE" >> "$MERGED_FILE"

# Build review JSON using python reading from the merged file
python3 -c "
import json
with open('$MERGED_FILE', 'r') as f:
    merged = f.read()[:6000]
print(json.dumps({
    'prompt': 'You are a Code Reviewer. Review the frontend and backend code in context. Check: 1) Security issues 2) Error handling 3) Code quality 4) Integration consistency. End with exactly VERDICT: PASS or VERDICT: FAIL.',
    'agentId': 'code-reviewer',
    'context': merged
}))
" > "$TMPDIR/review.json"

info "Submitting code review (sync)..."
curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" -d @"$TMPDIR/review.json" > "$TMPDIR/review-resp.json"

REVIEW_STATUS=$(python3 -c "import json; print(json.load(open('$TMPDIR/review-resp.json')).get('status',''))")
REVIEW_FILE=$(python3 -c "import json; print(json.load(open('$TMPDIR/review-resp.json')).get('resultFile',''))")
REVIEW_TASKID=$(python3 -c "import json; print(json.load(open('$TMPDIR/review-resp.json')).get('taskId',''))")
assert_eq "$REVIEW_STATUS" "done" "Code Reviewer completed"
info "Review output: $REVIEW_FILE"

# Check verdict from result file on disk (avoids JSON escaping issues)
if [ -n "$REVIEW_FILE" ] && [ -f "$REVIEW_FILE" ]; then
  if grep -q "VERDICT: PASS" "$REVIEW_FILE"; then
    VERDICT="PASS"
  elif grep -q "VERDICT: FAIL" "$REVIEW_FILE"; then
    VERDICT="FAIL"
  else
    VERDICT="UNKNOWN"
  fi
else
  VERDICT="UNKNOWN"
fi
info "Reviewer verdict: $VERDICT"

# ──────────────────────────────────────────────────────────

bold "PHASE 4: Fix (Conditional)"

if [ "$VERDICT" = "FAIL" ]; then
  info "Review FAILED — submitting fix task..."

  python3 -c "
import json
print(json.dumps({
    'prompt': 'You are a Senior Engineer. Read the code review in context and fix ALL issues. Output corrected code with comments on each fix.',
    'agentId': 'senior-engineer-fix',
    'contextFile': '$REVIEW_FILE'
}))
" > "$TMPDIR/fix.json"

  RESP=$(curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" -d @"$TMPDIR/fix.json")
  FIX_STATUS=$(json_field status "$RESP")
  assert_eq "$FIX_STATUS" "done" "Fix task completed"
  info "Fix applied: $(json_field resultFile "$RESP")"
  green "Feedback loop executed (review → fix)"
else
  info "Review PASSED — no fixes needed"
  green "Code passed review"
fi

# ──────────────────────────────────────────────────────────

bold "VERIFICATION: All artifacts created"

for F in "$DESIGNER_FILE" "$ARCHITECT_FILE" "$FRONTEND_FILE" "$BACKEND_FILE" "$REVIEW_FILE"; do
  if [ -n "$F" ] && [ -f "$F" ]; then
    green "artifact exists: $(basename "$F")"
  else
    red "artifact missing: $F"
  fi
done

# ──────────────────────────────────────────────────────────

bold "VERIFICATION: Jobs list shows all agents"

JOBS=$(curl -s "$BASE/jobs?limit=100")
for AGENT in "ui-designer" "architect" "frontend-engineer" "backend-engineer" "code-reviewer"; do
  if echo "$JOBS" | grep -q "$AGENT"; then
    green "agent '$AGENT' found in jobs list"
  else
    red "agent '$AGENT' missing from jobs list"
  fi
done

# ──────────────────────────────────────────────────────────

bold "SUMMARY"
echo ""
printf "  Agents involved:  UI/UX Designer, Architect, Frontend Engineer,\n"
printf "                    Backend Engineer, Code Reviewer"
if [ "$VERDICT" = "FAIL" ]; then printf ", Senior Engineer (fix)"; fi
echo ""
printf "  Workflow:         Phase 1 (parallel) → Phase 2 (parallel) → Phase 3 → Phase 4 (conditional)\n"
echo ""
printf "  \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then exit 1; fi
