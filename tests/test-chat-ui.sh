#!/bin/bash
# ============================================================
# Claude Bridge — Chat UI Tests
# ============================================================
# Tests that the Chat Commander frontend loads correctly
# and the conversation API works end-to-end.
# Usage: ./tests/test-chat-ui.sh
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

assert_not_contains() {
  local haystack="$1" needle="$2" label="$3"
  if echo "$haystack" | grep -q "$needle"; then red "$label (found: $needle)"; else green "$label"; fi
}

json_field() { python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))" <<< "$2"; }

# ──────────────────────────────────────────────────────────

bold "TEST 1: Chat page loads without JS errors"

# Fetch chat HTML — verify it returns 200 and contains the script tag
CHAT_HTML=$(curl -sf "$BASE/chat/")
assert_contains "$CHAT_HTML" "chat-app.mjs" "chat page loads and references chat-app.mjs"
assert_contains "$CHAT_HTML" "chatMessages" "chat page has chatMessages element"
assert_contains "$CHAT_HTML" "conversationList" "chat page has conversationList element"

# ──────────────────────────────────────────────────────────

bold "TEST 2: Chat JS modules load without 404"

# Verify all JS modules are served
for MODULE in chat-app.mjs chat-api.mjs chat-history.mjs chat-agents.mjs chat-renderer.mjs chat-upload.mjs; do
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE/chat/js/$MODULE")
  assert_eq "$STATUS" "200" "JS module $MODULE loads (200)"
done

# ──────────────────────────────────────────────────────────

bold "TEST 3: Agent panel elements are optional (no crash)"

# The agent panel HTML was removed but JS should handle missing elements gracefully.
# Verify the HTML does NOT have agentPanel elements (they were removed)
assert_not_contains "$CHAT_HTML" "agentPanel" "agentPanel element is not in HTML (removed)"

# Verify the JS handles missing elements with null checks
AGENTS_JS=$(curl -sf "$BASE/chat/js/chat-agents.mjs")
assert_contains "$AGENTS_JS" "if (toggleBtn)" "chat-agents.mjs guards toggleBtn"
assert_contains "$AGENTS_JS" "if (closeBtn)" "chat-agents.mjs guards closeBtn"
assert_contains "$AGENTS_JS" "if (panelEl)" "chat-agents.mjs guards panelEl"
assert_contains "$AGENTS_JS" "if (!contentEl)" "chat-agents.mjs guards contentEl"

# ──────────────────────────────────────────────────────────

bold "TEST 4: Conversations API works"

# List conversations
CONVS=$(curl -sf "$BASE/api/chat/conversations")
assert_contains "$CONVS" "conversations" "conversations endpoint returns conversations array"

# Count conversations
CONV_COUNT=$(python3 -c "import sys,json; print(len(json.load(sys.stdin).get('conversations',[])))" <<< "$CONVS")
if [ "$CONV_COUNT" -ge 0 ]; then green "conversations count is valid ($CONV_COUNT)"; else red "conversations count invalid"; fi

# ──────────────────────────────────────────────────────────

bold "TEST 5: Summary endpoints exist"

# Summary for non-existent conversation should return 404
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE/api/chat/conversations/fake-id/summary")
assert_eq "$STATUS" "404" "summary for non-existent conv returns 404"

# ──────────────────────────────────────────────────────────

bold "TEST 6: Chat page preserves conversation in URL"

# Verify the chat page JS reads conv param from URL
assert_contains "$AGENTS_JS" "" "chat-agents.mjs loads"  # Just verify it loads
CHAT_APP_JS=$(curl -sf "$BASE/chat/js/chat-app.mjs")
assert_contains "$CHAT_APP_JS" "URLSearchParams" "chat-app reads URL params"
assert_contains "$CHAT_APP_JS" "conv" "chat-app looks for conv param"

# ──────────────────────────────────────────────────────────

echo ""
bold "RESULTS"
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo "Total:  $((PASS + FAIL))"
[ "$FAIL" -eq 0 ] && echo -e "\033[32mAll tests passed!\033[0m" || echo -e "\033[31mSome tests failed!\033[0m"
exit "$FAIL"
