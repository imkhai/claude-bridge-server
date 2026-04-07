# Workflow Recipes

Practical workflow patterns for common software engineering tasks.
Each recipe includes the curl commands to run it and the agent roles involved.

---

## Recipe 1: Bug Investigation

A structured approach to diagnosing and fixing bugs with multiple specialist agents.

```
  Bug Report
      │
      ▼
  ┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
  │ Reproducer  │────>│ Root Cause │────>│   Fixer    │────>│  Verifier  │
  │             │     │  Analyst   │     │            │     │            │
  │ • Analyze   │     │ • Trace    │     │ • Write    │     │ • Review   │
  │   symptoms  │     │   the bug  │     │   the fix  │     │   the fix  │
  │ • Identify  │     │ • Explain  │     │ • Minimal  │     │ • Check    │
  │   repro     │     │   why it   │     │   change   │     │   for side │
  │   steps     │     │   happens  │     │   only     │     │   effects  │
  └────────────┘     └────────────┘     └────────────┘     └────────────┘
```

```bash
curl -X POST http://localhost:3210/chain -H "Content-Type: application/json" -d '{
  "steps": [
    {
      "prompt": "You are a QA Engineer. Analyze this bug report and produce: 1) Clear reproduction steps 2) Expected vs actual behavior 3) Affected components 4) Severity assessment.\n\nBug Report: Users report that the login form submits twice when clicking the submit button, causing duplicate API calls and sometimes a race condition that logs the user out immediately after login.",
      "agentId": "reproducer"
    },
    {
      "prompt": "You are a Senior Debugger. Based on the bug analysis, determine the root cause. Consider: 1) Common causes (missing debounce, event bubbling, React re-renders, missing loading state) 2) The exact code pattern that causes this 3) Why it only happens sometimes (race condition). Output a clear root cause explanation.",
      "agentId": "root-cause-analyst",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are a Senior Engineer. Based on the root cause analysis, write the minimal fix. Show: 1) The buggy code pattern (before) 2) The fixed code (after) 3) Explanation of why the fix works. Keep the change as small as possible — do not refactor surrounding code.",
      "agentId": "fixer",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are a Code Reviewer and QA. Review the proposed fix: 1) Does it address the root cause? 2) Could it introduce regressions? 3) Are edge cases handled (rapid clicks, slow network, concurrent tabs)? 4) Write 3 test cases to verify the fix. End with VERDICT: APPROVED or VERDICT: NEEDS CHANGES.",
      "agentId": "verifier",
      "usesPreviousResult": true
    }
  ]
}'
```

---

## Recipe 2: Quick One-Shot Tasks

Simple single-agent tasks for everyday work.

### Code Explanation

```bash
curl -X POST http://localhost:3210/ask/sync -H "Content-Type: application/json" -d '{
  "prompt": "Explain this code in plain English. What does it do, what are the edge cases, and what could go wrong?",
  "agentId": "explainer",
  "context": "const debounce = (fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };"
}'
```

### Regex Helper

```bash
curl -X POST http://localhost:3210/ask/sync -H "Content-Type: application/json" -d '{
  "prompt": "Write a regex that matches email addresses. Show the regex, explain each part, and give 5 examples of strings that match and 5 that do not.",
  "agentId": "regex-helper"
}'
```

### SQL Query Builder

```bash
curl -X POST http://localhost:3210/ask/sync -H "Content-Type: application/json" -d '{
  "prompt": "Write a PostgreSQL query to find all users who signed up in the last 30 days, have made at least 3 orders, and have not verified their email. Include the user name, email, signup date, and order count. Use proper joins, not subqueries.",
  "agentId": "sql-helper"
}'
```

### Error Message Decoder

```bash
curl -X POST http://localhost:3210/ask/sync -H "Content-Type: application/json" -d '{
  "prompt": "Explain this error and suggest fixes",
  "agentId": "error-decoder",
  "context": "TypeError: Cannot read properties of undefined (reading '\''map'\'')\n    at UserList (UserList.tsx:14:22)\n    at renderWithHooks (react-dom.development.js:14985:18)\n    at mountIndeterminateComponent (react-dom.development.js:17811:13)"
}'
```

---

## Recipe 3: Code Refactoring Pipeline

Safely refactor code with analysis, implementation, and verification.

```
  Original Code
       │
       ▼
  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ Analyzer  │────>│Refactorer│────>│ Reviewer  │
  │           │     │          │     │           │
  │ • Smell   │     │ • Apply  │     │ • Verify  │
  │   detect  │     │   best   │     │   no      │
  │ • Plan    │     │   practs │     │   behavior│
  │   changes │     │ • Clean  │     │   change  │
  └──────────┘     └──────────┘     └──────────┘
```

```bash
curl -X POST http://localhost:3210/chain -H "Content-Type: application/json" -d '{
  "steps": [
    {
      "prompt": "You are a Code Quality Analyst. Analyze this code for: 1) Code smells (long methods, deep nesting, magic numbers, etc.) 2) SOLID violations 3) Performance issues 4) Readability problems. Rank issues by severity and suggest specific refactoring techniques for each.",
      "agentId": "analyzer",
      "context": "class UserService {\n  async getUser(id, type, includeOrders, includeAddress, format) {\n    let user = await db.query(\"SELECT * FROM users WHERE id = \" + id);\n    if (user) {\n      if (type === \"admin\") {\n        user.permissions = [\"read\", \"write\", \"delete\", \"admin\"];\n        if (includeOrders) {\n          user.orders = await db.query(\"SELECT * FROM orders WHERE user_id = \" + id);\n          if (format === \"summary\") {\n            user.orders = user.orders.map(o => ({ id: o.id, total: o.total }));\n          }\n        }\n        if (includeAddress) {\n          user.address = await db.query(\"SELECT * FROM addresses WHERE user_id = \" + id + \" LIMIT 1\");\n        }\n      } else if (type === \"customer\") {\n        user.permissions = [\"read\"];\n        if (includeOrders) {\n          user.orders = await db.query(\"SELECT * FROM orders WHERE user_id = \" + id + \" AND status != '\"+ \"cancelled\" + \"'\");\n        }\n      }\n    }\n    return user;\n  }\n}"
    },
    {
      "prompt": "You are a Senior Engineer. Based on the code analysis, refactor the code. Apply the suggested improvements while preserving exact behavior. Use: parameterized queries, early returns, extracted methods, enums/constants. Show the complete refactored code.",
      "agentId": "refactorer",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are a Code Reviewer. Compare the refactored code against the original analysis. Check: 1) All identified issues addressed? 2) Behavior preserved exactly? 3) Any new issues introduced? 4) Test cases needed to verify equivalence. End with VERDICT: APPROVED or VERDICT: NEEDS CHANGES.",
      "agentId": "reviewer",
      "usesPreviousResult": true
    }
  ]
}'
```

---

## Recipe 4: Documentation Generator

Generate comprehensive docs from code with multiple specialist writers.

```
  Source Code
       │
  ┌────┴────┐
  ▼         ▼                    ▼
┌──────┐ ┌──────┐          ┌──────────┐
│ API  │ │Usage │ ───────> │ Compiler │
│ Docs │ │Guide │          │          │
└──────┘ └──────┘          └──────────┘
  (parallel)               (merges all)
```

```bash
# Step 1: Generate API docs and usage guide in parallel
TASK1=$(curl -s -X POST http://localhost:3210/ask \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "You are a Technical Writer. Write API reference documentation for this Express router. For each endpoint: method, path, parameters, request body, response body, status codes, example curl command.",
    "agentId": "api-doc-writer",
    "contextFile": "workspace/shared/router.js"
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")

TASK2=$(curl -s -X POST http://localhost:3210/ask \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "You are a Developer Advocate. Write a Getting Started guide for this API. Include: installation, configuration, first API call, common patterns, error handling, and 3 real-world examples.",
    "agentId": "guide-writer",
    "contextFile": "workspace/shared/router.js"
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")

echo "API docs: $TASK1, Guide: $TASK2 — poll /status for results"
```

---

## Recipe 5: Test Generation

Generate comprehensive tests with different testing perspectives.

```bash
curl -X POST http://localhost:3210/chain -H "Content-Type: application/json" -d '{
  "steps": [
    {
      "prompt": "You are a Test Architect. Analyze this function and produce a test plan: 1) List all behaviors to test 2) Identify edge cases (empty input, null, boundary values, overflow) 3) Identify error scenarios 4) Group tests into logical suites. Do NOT write code yet — just the plan.",
      "agentId": "test-architect",
      "context": "async function transferMoney(fromAccount, toAccount, amount, currency = \"USD\") {\n  if (!fromAccount || !toAccount) throw new Error(\"Both accounts required\");\n  if (fromAccount === toAccount) throw new Error(\"Cannot transfer to same account\");\n  if (amount <= 0) throw new Error(\"Amount must be positive\");\n  if (amount > 1000000) throw new Error(\"Amount exceeds limit\");\n  const rate = await getExchangeRate(currency, \"USD\");\n  const usdAmount = amount * rate;\n  const balance = await getBalance(fromAccount);\n  if (balance < usdAmount) throw new Error(\"Insufficient funds\");\n  await debit(fromAccount, usdAmount);\n  try {\n    await credit(toAccount, usdAmount);\n  } catch (e) {\n    await credit(fromAccount, usdAmount); // rollback\n    throw new Error(\"Transfer failed: \" + e.message);\n  }\n  return { fromAccount, toAccount, amount, currency, usdAmount, newBalance: balance - usdAmount };\n}"
    },
    {
      "prompt": "You are a Senior QA Engineer. Based on the test plan, write the complete test suite using Jest. Include: describe blocks matching the plan groups, proper mocking of getExchangeRate/getBalance/debit/credit, beforeEach setup, and clear test names. Cover every case from the plan.",
      "agentId": "test-writer",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are a QA Lead. Review the test suite for: 1) Coverage gaps — any scenarios from the plan not tested? 2) Test quality — are assertions specific enough? 3) Mock correctness — do mocks match real behavior? 4) Missing edge cases the plan overlooked. Add any missing tests.",
      "agentId": "test-reviewer",
      "usesPreviousResult": true
    }
  ]
}'
```

---

## Recipe 6: Performance Audit

Analyze code for performance issues with specialized agents.

```bash
curl -X POST http://localhost:3210/chain -H "Content-Type: application/json" -d '{
  "steps": [
    {
      "prompt": "You are a Performance Engineer. Audit this code for performance issues: 1) N+1 queries 2) Missing indexes (suggest based on query patterns) 3) Unnecessary data fetching 4) Blocking operations 5) Memory leaks (event listeners, closures, caches without eviction) 6) Algorithmic complexity. Rate each issue: Critical / Major / Minor.",
      "agentId": "perf-auditor",
      "context": "app.get(\"/dashboard\", async (req, res) => {\n  const users = await User.findAll();\n  const dashboardData = [];\n  for (const user of users) {\n    const orders = await Order.findAll({ where: { userId: user.id } });\n    const reviews = await Review.findAll({ where: { userId: user.id } });\n    let totalSpent = 0;\n    orders.forEach(o => { totalSpent += o.items.reduce((sum, i) => sum + i.price * i.qty, 0); });\n    dashboardData.push({\n      user: user.toJSON(),\n      orderCount: orders.length,\n      reviewCount: reviews.length,\n      totalSpent,\n      recentOrders: orders.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5)\n    });\n  }\n  globalCache[req.path] = dashboardData;\n  res.json(dashboardData);\n});"
    },
    {
      "prompt": "You are a Senior Backend Engineer. Based on the performance audit, rewrite the code to fix ALL identified issues. Use: eager loading / joins, pagination, proper caching with TTL, aggregation queries instead of application-level loops. Show before and after with performance impact estimates.",
      "agentId": "perf-optimizer",
      "usesPreviousResult": true
    }
  ]
}'
```

---

## Recipe 7: Security Review

Dedicated security analysis pipeline.

```bash
curl -X POST http://localhost:3210/chain -H "Content-Type: application/json" -d '{
  "steps": [
    {
      "prompt": "You are a Security Auditor (OWASP specialist). Audit this Express.js API for vulnerabilities. Check against OWASP Top 10: 1) Injection (SQL, NoSQL, command) 2) Broken authentication 3) Sensitive data exposure 4) XXE 5) Broken access control 6) Security misconfiguration 7) XSS 8) Insecure deserialization 9) Known vulnerabilities 10) Insufficient logging. For each finding: severity (Critical/High/Medium/Low), code location, exploit scenario, and fix.",
      "agentId": "security-auditor",
      "context": "app.post(\"/login\", (req, res) => {\n  const { username, password } = req.body;\n  const user = db.query(`SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`);\n  if (user) {\n    const token = jwt.sign({ id: user.id, role: user.role }, \"mysecretkey\");\n    res.cookie(\"token\", token);\n    res.json({ token });\n  } else {\n    res.status(401).json({ error: \"Invalid credentials\" });\n  }\n});\n\napp.get(\"/user/:id\", (req, res) => {\n  const user = db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);\n  res.json(user);\n});\n\napp.post(\"/profile\", (req, res) => {\n  const token = req.cookies.token;\n  const decoded = jwt.verify(token, \"mysecretkey\");\n  db.query(`UPDATE users SET bio = '${req.body.bio}' WHERE id = ${decoded.id}`);\n  res.json({ success: true });\n});"
    },
    {
      "prompt": "You are a Security Engineer. Based on the security audit findings, rewrite ALL the vulnerable code with proper security controls. Use: parameterized queries, bcrypt for passwords, secure JWT configuration (expiry, httpOnly cookies, proper secret management), input validation, rate limiting, CORS. Show the complete hardened code.",
      "agentId": "security-engineer",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are a Penetration Tester. Review the hardened code. Try to find remaining vulnerabilities. Check: 1) Are all injection points fixed? 2) Is the JWT implementation secure? 3) Are there timing attacks possible? 4) CSRF protection? 5) Rate limiting bypass? Write specific attack scenarios that would or would not work against the new code.",
      "agentId": "pen-tester",
      "usesPreviousResult": true
    }
  ]
}'
```

---

## Recipe 8: Migration Planner

Plan and generate database or API migrations safely.

```bash
curl -X POST http://localhost:3210/chain -H "Content-Type: application/json" -d '{
  "steps": [
    {
      "prompt": "You are a Database Architect. Plan a migration to add multi-tenancy to this schema. Current schema: users(id, name, email), orders(id, user_id, total, status), products(id, name, price). Requirements: 1) Add tenant_id to all tables 2) Ensure data isolation between tenants 3) Support a super-admin that sees all tenants. Output: migration steps in order, rollback plan, data migration strategy, and risks.",
      "agentId": "db-architect"
    },
    {
      "prompt": "You are a Senior Backend Engineer. Based on the migration plan, write the actual migration files (up and down) in SQL. Include: ALTER TABLE statements, index creation, data migration queries, constraint additions. Also write the middleware/helper code for tenant isolation (Row Level Security or application-level filtering).",
      "agentId": "migration-writer",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are a DBA. Review the migration for: 1) Will it lock tables during migration? For how long? 2) Is the rollback plan complete and tested? 3) Index strategy correct for tenant queries? 4) Any data integrity risks during migration? 5) Performance impact on existing queries. Suggest improvements.",
      "agentId": "dba-reviewer",
      "usesPreviousResult": true
    }
  ]
}'
```

---

## Recipe 9: Incident Response

Structured incident investigation with parallel analysis.

```
  Error Logs + Metrics
         │
    ┌────┴────┐
    ▼         ▼
┌──────┐  ┌──────┐
│ Log  │  │Metric│     ┌──────────┐     ┌──────────┐
│Analyz│  │Analyz│────>│ Diagnose │────>│ Runbook  │
└──────┘  └──────┘     └──────────┘     └──────────┘
  (parallel)            (merge)          (action plan)
```

```bash
# Parallel: analyze logs and metrics separately
TASK1=$(curl -s -X POST http://localhost:3210/ask \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "You are an SRE analyzing error logs. Find patterns: 1) Error frequency and timing 2) Affected endpoints 3) Common error messages 4) Correlation with deployments or config changes. Timeline the incident.",
    "agentId": "log-analyst",
    "context": "[2026-04-07 03:15:22] ERROR /api/checkout 500 \"Connection refused: payment-service:8080\"\n[2026-04-07 03:15:23] ERROR /api/checkout 500 \"Connection refused: payment-service:8080\"\n[2026-04-07 03:15:25] WARN /api/cart 200 \"Slow query: 4502ms\"\n[2026-04-07 03:15:30] ERROR /api/checkout 500 \"Connection refused: payment-service:8080\"\n[2026-04-07 03:16:01] ERROR /api/checkout 500 \"ETIMEDOUT: payment-service:8080\"\n[2026-04-07 03:16:05] ERROR /api/orders 500 \"Cannot read property status of null\"\n[2026-04-07 03:16:10] WARN health-check payment-service UNHEALTHY\n[2026-04-07 03:17:00] ERROR /api/checkout 503 \"Circuit breaker OPEN for payment-service\"\n[2026-04-07 03:20:00] INFO payment-service restarted by k8s\n[2026-04-07 03:20:15] INFO health-check payment-service HEALTHY\n[2026-04-07 03:20:30] INFO /api/checkout 200 OK (circuit breaker CLOSED)"
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")

TASK2=$(curl -s -X POST http://localhost:3210/ask \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "You are an SRE analyzing metrics. Identify: 1) When did the issue start and resolve? 2) Impact scope (% of requests affected) 3) Cascading failures 4) Recovery pattern. Quantify the impact.",
    "agentId": "metric-analyst",
    "context": "Time          | checkout_rps | error_rate | p99_latency | payment_svc_up\n03:10:00      | 45           | 0.2%       | 180ms       | 1\n03:15:00      | 48           | 85%        | 12000ms     | 0\n03:16:00      | 52           | 92%        | timeout     | 0\n03:17:00      | 12           | 100%       | timeout     | 0\n03:18:00      | 8            | 100%       | timeout     | 0\n03:19:00      | 5            | 100%       | timeout     | 0\n03:20:00      | 15           | 40%        | 5000ms      | 1\n03:21:00      | 35           | 5%         | 300ms       | 1\n03:22:00      | 44           | 0.3%       | 190ms       | 1"
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")

echo "Log analysis: $TASK1, Metric analysis: $TASK2"
echo "After both complete, merge results and submit to diagnostician..."
```

---

## Recipe 10: PR Review Simulation

Simulate a thorough pull request review with multiple perspectives.

```bash
curl -X POST http://localhost:3210/chain -H "Content-Type: application/json" -d '{
  "steps": [
    {
      "prompt": "You are reviewing a Pull Request as a Senior Engineer focused on CORRECTNESS. Check: 1) Logic errors 2) Off-by-one bugs 3) Null/undefined handling 4) Race conditions 5) State management issues. Only flag real problems, not style preferences.",
      "agentId": "correctness-reviewer",
      "context": "// PR: Add retry logic to API client\n\nclass ApiClient {\n  constructor(baseUrl, maxRetries = 3) {\n    this.baseUrl = baseUrl;\n    this.maxRetries = maxRetries;\n  }\n\n  async request(method, path, body) {\n    let lastError;\n    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {\n      try {\n        const resp = await fetch(this.baseUrl + path, {\n          method,\n          headers: { \"Content-Type\": \"application/json\" },\n          body: body ? JSON.stringify(body) : undefined,\n        });\n        if (resp.status >= 500) throw new Error(`Server error: ${resp.status}`);\n        if (resp.status === 429) {\n          await this.sleep(1000 * attempt);\n          continue;\n        }\n        return await resp.json();\n      } catch (e) {\n        lastError = e;\n        if (attempt < this.maxRetries) {\n          await this.sleep(1000 * Math.pow(2, attempt));\n        }\n      }\n    }\n    throw lastError;\n  }\n\n  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }\n}"
    },
    {
      "prompt": "You are reviewing the same PR as a Senior Engineer focused on ROBUSTNESS and EDGE CASES. Based on the correctness review and the original code, check: 1) What happens with network timeouts? 2) What if the response is not JSON? 3) What about 4xx errors — should they retry? 4) AbortController for cancellation? 5) Concurrent request limits? Add any issues the correctness reviewer missed.",
      "agentId": "robustness-reviewer",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are the PR Author. Read both reviews and write: 1) Acknowledge valid points 2) Push back on anything you disagree with (with reasoning) 3) A concrete list of changes you will make 4) Updated code with all agreed fixes applied.",
      "agentId": "pr-author",
      "usesPreviousResult": true
    }
  ]
}'
```

---

## Recipe 11: Learning / Explanation

Deep dive into a concept with progressive complexity.

```bash
curl -X POST http://localhost:3210/chain -H "Content-Type: application/json" -d '{
  "steps": [
    {
      "prompt": "You are a Teacher. Explain JavaScript Promises to a developer who knows callbacks but has never used Promises. Use simple analogies. No code yet — just the concept. Cover: what problem they solve, how they work (pending/resolved/rejected), and why they are better than callbacks.",
      "agentId": "teacher-beginner"
    },
    {
      "prompt": "You are a Teacher. The student now understands the basics. Build on the previous explanation and teach: 1) Promise.all, Promise.race, Promise.allSettled with practical examples 2) Error handling with .catch and try/catch 3) Common mistakes (forgetting to return, unhandled rejections) 4) async/await as syntax sugar. Include code examples for each concept.",
      "agentId": "teacher-intermediate",
      "usesPreviousResult": true
    },
    {
      "prompt": "You are a Teacher. The student understands Promises and async/await. Now teach advanced patterns: 1) Promise.withResolvers() 2) Building a retry wrapper 3) Concurrency control (process N items with max M parallel) 4) Cancellation with AbortController 5) Common interview questions. Include production-ready code examples.",
      "agentId": "teacher-advanced",
      "usesPreviousResult": true
    }
  ]
}'
```

---

## Recipe 12: Parallel Bulk Processing

Process multiple independent items in parallel using async tasks.

```bash
# Submit 5 translations in parallel (all independent)
LANGUAGES=("Vietnamese" "Japanese" "Korean" "French" "Spanish")
TASK_IDS=()

for LANG in "${LANGUAGES[@]}"; do
  TID=$(curl -s -X POST http://localhost:3210/ask \
    -H "Content-Type: application/json" \
    -d "{\"prompt\":\"Translate to $LANG: 'The quick brown fox jumps over the lazy dog'\",\"agentId\":\"translator-$LANG\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")
  TASK_IDS+=("$TID")
  echo "Submitted $LANG translation: $TID"
done

# Poll until all complete
echo "Waiting for all translations..."
while true; do
  ALL_DONE=true
  for TID in "${TASK_IDS[@]}"; do
    STATUS=$(curl -s http://localhost:3210/status/$TID \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
    if [ "$STATUS" = "running" ] || [ "$STATUS" = "queued" ]; then
      ALL_DONE=false
    fi
  done
  if $ALL_DONE; then break; fi
  sleep 3
done

# Collect results
for i in "${!LANGUAGES[@]}"; do
  RESULT=$(curl -s http://localhost:3210/status/${TASK_IDS[$i]} \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])")
  echo "${LANGUAGES[$i]}: $RESULT"
done
```
