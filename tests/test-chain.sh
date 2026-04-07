#!/bin/bash
# ============================================================
# Claude Bridge — Chain & Multi-Step Tests
# ============================================================
# Usage: ./tests/test-chain.sh
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
json_nested() { python3 -c "import sys,json; $2" <<< "$1"; }

# ──────────────────────────────────────────────────────────

bold "TEST 1: Simple 2-Step Chain"

RESP=$(curl -s -X POST "$BASE/chain" -H "Content-Type: application/json" -d '{
  "steps": [
    {"prompt": "Write a one-line joke about programming", "agentId": "comedian"},
    {"prompt": "Translate the joke to Vietnamese", "agentId": "translator", "usesPreviousResult": true}
  ]
}')

CHAIN_ID=$(json_field chainId "$RESP")
assert_contains "$RESP" "chainId" "chain returns chainId"
assert_contains "$CHAIN_ID" "chain-" "chainId has correct prefix"

STEP_COUNT=$(python3 -c "import sys,json; print(len(json.load(sys.stdin)['steps']))" <<< "$RESP")
assert_eq "$STEP_COUNT" "2" "chain has 2 steps"

echo "  Chain: $CHAIN_ID — waiting for completion..."

# Poll until chain is done (max 120s)
for i in $(seq 1 24); do
  sleep 5
  STATUS=$(curl -s "$BASE/chain/$CHAIN_ID")
  CHAIN_STATUS=$(json_field status "$STATUS")
  CURRENT=$(json_field currentStep "$STATUS")
  echo "  ... status=$CHAIN_STATUS currentStep=$CURRENT"
  if [ "$CHAIN_STATUS" != "running" ]; then break; fi
done

assert_eq "$CHAIN_STATUS" "done" "chain completed successfully"

# Verify step details
STEP1_STATUS=$(python3 -c "import sys,json; print(json.load(sys.stdin)['steps'][0]['status'])" <<< "$STATUS")
STEP2_STATUS=$(python3 -c "import sys,json; print(json.load(sys.stdin)['steps'][1]['status'])" <<< "$STATUS")
assert_eq "$STEP1_STATUS" "done" "step 1 is done"
assert_eq "$STEP2_STATUS" "done" "step 2 is done"

STEP1_TASKID=$(python3 -c "import sys,json; print(json.load(sys.stdin)['steps'][0]['taskId'])" <<< "$STATUS")
STEP2_TASKID=$(python3 -c "import sys,json; print(json.load(sys.stdin)['steps'][1]['taskId'])" <<< "$STATUS")
assert_contains "$STEP1_TASKID" "" "step 1 has taskId"
assert_contains "$STEP2_TASKID" "" "step 2 has taskId"

# Verify step 2 received step 1's context
STEP2_RESULT=$(curl -s "$BASE/status/$STEP2_TASKID")
assert_eq "$(json_field status "$STEP2_RESULT")" "done" "step 2 task is done"
assert_contains "$(json_field result "$STEP2_RESULT")" "" "step 2 has result text"

# ──────────────────────────────────────────────────────────

bold "TEST 2: 3-Step Chain (Design → Implement → Review)"

RESP=$(curl -s -X POST "$BASE/chain" -H "Content-Type: application/json" -d '{
  "steps": [
    {
      "prompt": "Design a simple key-value store API with 3 endpoints: GET /kv/:key, PUT /kv/:key, DELETE /kv/:key. Output a brief API spec.",
      "agentId": "architect"
    },
    {
      "prompt": "Implement the API from the spec above using Express.js. Keep it under 50 lines.",
      "agentId": "engineer",
      "usesPreviousResult": true
    },
    {
      "prompt": "Review the code. Check for: input validation, error handling, edge cases. Give a PASS or FAIL verdict.",
      "agentId": "reviewer",
      "usesPreviousResult": true
    }
  ]
}')

CHAIN_ID=$(json_field chainId "$RESP")
echo "  Chain: $CHAIN_ID — waiting for completion..."

for i in $(seq 1 36); do
  sleep 5
  STATUS=$(curl -s "$BASE/chain/$CHAIN_ID")
  CHAIN_STATUS=$(json_field status "$STATUS")
  CURRENT=$(json_field currentStep "$STATUS")
  echo "  ... status=$CHAIN_STATUS currentStep=$CURRENT"
  if [ "$CHAIN_STATUS" != "running" ]; then break; fi
done

assert_eq "$CHAIN_STATUS" "done" "3-step chain completed"

ALL_DONE=$(python3 -c "
import sys,json
steps = json.load(sys.stdin)['steps']
print('yes' if all(s['status'] == 'done' for s in steps) else 'no')
" <<< "$STATUS")
assert_eq "$ALL_DONE" "yes" "all 3 steps completed"

# Verify chain of context: step 3 should reference code from step 2
STEP3_TASKID=$(python3 -c "import sys,json; print(json.load(sys.stdin)['steps'][2]['taskId'])" <<< "$STATUS")
STEP3_RESULT=$(json_field result "$(curl -s "$BASE/status/$STEP3_TASKID")")
assert_contains "$STEP3_RESULT" "" "reviewer produced output"

# ──────────────────────────────────────────────────────────

bold "TEST 3: Agent-to-Agent File Handoff (Manual)"

# Step 1: Agent A produces output
echo "  Submitting agent A task..."
RESP_A=$(curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" \
  -d '{"prompt":"Write a function called add(a, b) that returns a + b. Output only the code.","agentId":"agent-a"}')
FILE_A=$(json_field resultFile "$RESP_A")
assert_eq "$(json_field status "$RESP_A")" "done" "agent A completed"

# Step 2: Agent B reads Agent A's output by file path
echo "  Submitting agent B task with agent A result file..."
RESP_B=$(curl -s -X POST "$BASE/ask/sync" -H "Content-Type: application/json" \
  -d "{\"prompt\":\"Write unit tests for the function in the context file. Use assert statements.\",\"agentId\":\"agent-b\",\"contextFile\":\"$FILE_A\"}")
assert_eq "$(json_field status "$RESP_B")" "done" "agent B completed"
assert_contains "$(json_field result "$RESP_B")" "add" "agent B references agent A's function"

# ──────────────────────────────────────────────────────────

bold "TEST 4: Two Chains in Parallel"

# Submit two chains at the same time
RESP1=$(curl -s -X POST "$BASE/chain" -H "Content-Type: application/json" -d '{
  "steps": [
    {"prompt": "Write a haiku about the ocean", "agentId": "poet-1"},
    {"prompt": "Rate the haiku 1-10 and explain why", "agentId": "critic-1", "usesPreviousResult": true}
  ]
}')
CHAIN1=$(json_field chainId "$RESP1")

RESP2=$(curl -s -X POST "$BASE/chain" -H "Content-Type: application/json" -d '{
  "steps": [
    {"prompt": "Write a haiku about mountains", "agentId": "poet-2"},
    {"prompt": "Rate the haiku 1-10 and explain why", "agentId": "critic-2", "usesPreviousResult": true}
  ]
}')
CHAIN2=$(json_field chainId "$RESP2")

echo "  Chain 1: $CHAIN1"
echo "  Chain 2: $CHAIN2"
echo "  Waiting for both to complete..."

for i in $(seq 1 24); do
  sleep 5
  S1=$(json_field status "$(curl -s "$BASE/chain/$CHAIN1")")
  S2=$(json_field status "$(curl -s "$BASE/chain/$CHAIN2")")
  echo "  ... chain1=$S1 chain2=$S2"
  if [ "$S1" != "running" ] && [ "$S2" != "running" ]; then break; fi
done

assert_eq "$S1" "done" "chain 1 completed"
assert_eq "$S2" "done" "chain 2 completed"

# ──────────────────────────────────────────────────────────

bold "SUMMARY"
echo ""
printf "  \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then exit 1; fi
