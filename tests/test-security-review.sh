#!/bin/bash
# ============================================================
# Claude Bridge — Security Review Pipeline Test
# ============================================================
# Simulates: Security Auditor → Security Engineer → Pen Tester
# Usage: ./tests/test-security-review.sh
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

bold "Security Review Pipeline"
info "Target: vulnerable Express.js login API"

cat > "$TMPDIR/chain.json" << 'ENDJSON'
{
  "steps": [
    {
      "prompt": "You are a Security Auditor. Audit this Express API against OWASP Top 10. For each vulnerability found: severity (Critical/High/Medium/Low), location, exploit scenario, and recommended fix. Be thorough.\n\nCode:\napp.post(\"/login\", (req, res) => {\n  const { username, password } = req.body;\n  const user = db.query(`SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`);\n  if (user) {\n    const token = jwt.sign({ id: user.id, role: user.role }, \"mysecretkey\");\n    res.cookie(\"token\", token);\n    res.json({ token });\n  } else {\n    res.status(401).json({ error: \"Invalid credentials\" });\n  }\n});\n\napp.get(\"/user/:id\", (req, res) => {\n  const user = db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);\n  res.json(user);\n});",
      "agentId": "security-auditor"
    },
    {
      "prompt": "You are a Security Engineer. Based on the audit findings, rewrite the code with proper security: parameterized queries, bcrypt passwords, secure JWT (expiry, httpOnly, proper secret), input validation. Show the complete hardened code.",
      "agentId": "security-engineer",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are a Penetration Tester. Review the hardened code. Try to find remaining attack vectors: 1) SQL injection still possible? 2) JWT attacks (alg:none, weak secret)? 3) Timing attacks on login? 4) Enumeration via error messages? 5) CSRF? Rate the overall security improvement.",
      "agentId": "pen-tester",
      "usesPreviousResult": true
    }
  ]
}
ENDJSON

RESP=$(curl -s -X POST "$BASE/chain" -H "Content-Type: application/json" -d @"$TMPDIR/chain.json")
CHAIN_ID=$(python3 -c "import sys,json; print(json.load(sys.stdin)['chainId'])" <<< "$RESP")
info "Chain: $CHAIN_ID"

# Poll
info "Running security pipeline..."
for i in $(seq 1 60); do
  sleep 5
  curl -s "$BASE/chain/$CHAIN_ID" > "$TMPDIR/status.json"
  STATUS=$(json_field "$TMPDIR/status.json" status)
  STEP=$(json_field "$TMPDIR/status.json" currentStep)
  NAMES=("security-auditor" "security-engineer" "pen-tester")
  IDX=$((STEP-1))
  if [ $IDX -ge 0 ] && [ $IDX -lt 3 ]; then
    printf "\r\033[33m  ▸ Step %s/3 (%s): %s     \033[0m" "$STEP" "${NAMES[$IDX]}" "$STATUS"
  fi
  if [ "$STATUS" != "running" ]; then break; fi
done
echo ""

assert_eq "$STATUS" "done" "security pipeline completed"

# Verify each agent
NAMES=("security-auditor" "security-engineer" "pen-tester")
for i in 0 1 2; do
  STEP_STATUS=$(python3 -c "import sys,json; print(json.load(open('$TMPDIR/status.json'))['steps'][$i]['status'])")
  assert_eq "$STEP_STATUS" "done" "${NAMES[$i]} completed"
done

# Check auditor found SQL injection
AUDITOR_TID=$(python3 -c "import sys,json; print(json.load(open('$TMPDIR/status.json'))['steps'][0]['taskId'])")
curl -s "$BASE/status/$AUDITOR_TID" > "$TMPDIR/auditor.json"
AUDITOR_RESULT=$(json_field "$TMPDIR/auditor.json" result)
assert_contains "$AUDITOR_RESULT" "injection" "auditor found SQL injection"

# Check engineer used parameterized queries
ENGINEER_TID=$(python3 -c "import sys,json; print(json.load(open('$TMPDIR/status.json'))['steps'][1]['taskId'])")
curl -s "$BASE/status/$ENGINEER_TID" > "$TMPDIR/engineer.json"
ENGINEER_RESULT=$(json_field "$TMPDIR/engineer.json" result)
assert_contains "$ENGINEER_RESULT" "bcrypt" "engineer used bcrypt for passwords"

# ──────────────────────────────────────────────────────────

bold "SUMMARY"
echo ""
printf "  Pipeline: Security Auditor → Security Engineer → Pen Tester\n"
printf "  \033[32m%d passed\033[0m, \033[31m%d failed\033[0m\n" "$PASS" "$FAIL"
echo ""
if [ "$FAIL" -gt 0 ]; then exit 1; fi
