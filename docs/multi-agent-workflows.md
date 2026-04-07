# Multi-Agent Team Workflows

## 1. Vision: Software Development Team

A real-world project needs multiple specialized agents working together:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  UI/UX       │  │  Architect   │  │  Senior      │  │  Code        │
│  Designer    │  │              │  │  Engineer    │  │  Reviewer    │
│              │  │  • System    │  │              │  │              │
│  • Wireframe │  │    design    │  │  • Implement │  │  • Quality   │
│  • UX flows  │  │  • API spec │  │  • Tests     │  │  • Security  │
│  • Component │  │  • Data     │  │  • Integrate │  │  • Standards │
│    specs     │  │    model    │  │              │  │  • Feedback  │
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │                 │                 │                 │
       └────────────┬────┴────────┬────────┴─────────────────┘
                    │             │
                    ▼             ▼
              Claude Bridge Server
```

---

## 2. Current Capabilities

### What Works Today

| Pattern | Supported | How |
|---------|-----------|-----|
| Sequential pipeline (A → B → C) | YES | `POST /chain` with `usesPreviousResult` |
| Parallel independent tasks | YES | Multiple `POST /ask` calls |
| Agent reads another agent's output | YES | Pass `contextFile` to previous `resultFile` |
| Multiple chains at same time | YES | Each `POST /chain` runs independently |
| Queue with concurrency limit | YES | `MAX_PARALLEL` slots, FIFO ordering |
| Cancel in-progress work | YES | `POST /cancel/:taskId` |

### What's NOT Supported Yet

| Pattern | Status | Gap |
|---------|--------|-----|
| Multi-input steps (merge 2+ results) | NOT SUPPORTED | Only 1 `contextFile` per task |
| Fan-out (1 step → N parallel tasks) | NOT SUPPORTED | Chains are strictly sequential |
| Fan-in (wait for N tasks → 1 step) | NOT SUPPORTED | No dependency graph |
| Conditional branching | NOT SUPPORTED | No if/else in chains |
| Feedback loops (reviewer → engineer → reviewer) | NOT SUPPORTED | No cycles in chains |
| Priority queue | NOT SUPPORTED | FIFO only |
| Human approval gates | NOT SUPPORTED | No pause/resume mechanism |

---

## 3. Workflow Patterns You CAN Build Today

### Pattern A: Linear Pipeline (Chain)

The simplest multi-agent pattern. Each agent passes its output to the next.

```
Designer ──→ Architect ──→ Engineer ──→ Reviewer
   │              │            │            │
   ▼              ▼            ▼            ▼
 design.md    arch.md      code.md     review.md
```

```bash
curl -X POST http://localhost:3210/chain \
  -H "Content-Type: application/json" \
  -d '{
    "steps": [
      {
        "prompt": "Design a user registration form. Include: field layout, validation rules, error states, success flow. Output as a component specification.",
        "agentId": "ui-designer"
      },
      {
        "prompt": "Based on the UI design, create the system architecture: API endpoints, data model, authentication flow, validation layer. Output as a technical specification.",
        "agentId": "architect",
        "usesPreviousResult": true
      },
      {
        "prompt": "Based on the architecture spec, implement the registration feature in TypeScript/React. Include: React component, API route handler, database schema, input validation. Write production-ready code.",
        "agentId": "senior-engineer",
        "usesPreviousResult": true
      },
      {
        "prompt": "Review the implementation for: code quality, security vulnerabilities (XSS, injection, auth bypass), error handling, test coverage gaps, performance issues. Provide specific line-by-line feedback and a pass/fail verdict.",
        "agentId": "code-reviewer",
        "usesPreviousResult": true
      }
    ]
  }'
```

**Limitation:** The reviewer only sees the engineer's code, not the original design or architecture. Each step only receives the immediately previous result.

### Pattern B: Parallel Research + Merge (Client-Orchestrated)

Run multiple agents in parallel, then merge their outputs manually.

```
         ┌─── Researcher-1 (frontend) ───┐
         │                                │
Task ────┼─── Researcher-2 (backend)  ────┼──→ Client merges ──→ Synthesizer
         │                                │
         └─── Researcher-3 (security) ────┘
```

```bash
# Step 1: Submit 3 parallel research tasks
TASK1=$(curl -s -X POST http://localhost:3210/ask \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Research best practices for React form components in 2026","agentId":"researcher-frontend"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")

TASK2=$(curl -s -X POST http://localhost:3210/ask \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Research Node.js authentication patterns and libraries in 2026","agentId":"researcher-backend"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")

TASK3=$(curl -s -X POST http://localhost:3210/ask \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Research OWASP top 10 for user registration forms","agentId":"researcher-security"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")

echo "Submitted: $TASK1 $TASK2 $TASK3"

# Step 2: Poll until all done
while true; do
  S1=$(curl -s http://localhost:3210/status/$TASK1 | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  S2=$(curl -s http://localhost:3210/status/$TASK2 | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  S3=$(curl -s http://localhost:3210/status/$TASK3 | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  echo "Status: $S1 $S2 $S3"
  if [[ "$S1" != "running" && "$S1" != "queued" && \
        "$S2" != "running" && "$S2" != "queued" && \
        "$S3" != "running" && "$S3" != "queued" ]]; then
    break
  fi
  sleep 5
done

# Step 3: Get result files
FILE1=$(curl -s http://localhost:3210/status/$TASK1 | python3 -c "import sys,json; print(json.load(sys.stdin)['resultFile'])")
FILE2=$(curl -s http://localhost:3210/status/$TASK2 | python3 -c "import sys,json; print(json.load(sys.stdin)['resultFile'])")
FILE3=$(curl -s http://localhost:3210/status/$TASK3 | python3 -c "import sys,json; print(json.load(sys.stdin)['resultFile'])")

# Step 4: Merge context inline and send to synthesizer
MERGED=$(cat "$FILE1" "$FILE2" "$FILE3")

curl -s -X POST http://localhost:3210/ask/sync \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'prompt': 'Synthesize these three research reports into a unified technical recommendation. Highlight agreements and conflicts between the sources.',
    'agentId': 'synthesizer',
    'context': '''$MERGED'''
}))")" | python3 -m json.tool
```

### Pattern C: Review Loop (Client-Orchestrated)

Simulate feedback loops by submitting sequential sync tasks.

```
Engineer ──→ Reviewer ──→ [pass?] ──→ Done
                │                      ▲
                │ [fail]               │
                ▼                      │
            Engineer (fix) ──→ Reviewer (re-review) ──┘
```

```bash
# Round 1: Engineer implements
IMPL=$(curl -s -X POST http://localhost:3210/ask/sync \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Implement a rate limiter middleware in Express.js","agentId":"engineer"}')
IMPL_FILE=$(echo $IMPL | python3 -c "import sys,json; print(json.load(sys.stdin)['resultFile'])")

# Round 1: Reviewer reviews
REVIEW=$(curl -s -X POST http://localhost:3210/ask/sync \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"Review this code. End with VERDICT: PASS or VERDICT: FAIL with specific issues to fix.\",\"agentId\":\"reviewer\",\"contextFile\":\"$IMPL_FILE\"}")

VERDICT=$(echo $REVIEW | python3 -c "import sys,json; r=json.load(sys.stdin)['result']; print('PASS' if 'VERDICT: PASS' in r else 'FAIL')")
REVIEW_FILE=$(echo $REVIEW | python3 -c "import sys,json; print(json.load(sys.stdin)['resultFile'])")

if [ "$VERDICT" = "FAIL" ]; then
  # Round 2: Engineer fixes based on review feedback
  curl -s -X POST http://localhost:3210/ask/sync \
    -H "Content-Type: application/json" \
    -d "{\"prompt\":\"Fix the issues found in the code review. Apply all feedback.\",\"agentId\":\"engineer\",\"contextFile\":\"$REVIEW_FILE\"}" \
    | python3 -m json.tool
fi
```

### Pattern D: Agent-to-Agent File Handoff (Manual)

Any agent can read any other agent's result file directly.

```bash
# Agent 1 produces output
RESULT=$(curl -s -X POST http://localhost:3210/ask/sync \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Write a REST API spec for user management","agentId":"architect"}')
FILE=$(echo $RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['resultFile'])")

# Agent 2 reads Agent 1's output file
curl -s -X POST http://localhost:3210/ask/sync \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"Implement this API spec\",\"agentId\":\"engineer\",\"contextFile\":\"$FILE\"}"

# Agent 3 also reads Agent 1's output file (not Agent 2's)
curl -s -X POST http://localhost:3210/ask/sync \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"Write integration tests for this API spec\",\"agentId\":\"qa-engineer\",\"contextFile\":\"$FILE\"}"
```

---

## 4. Full Team Example: Build a Feature

This is the most complex workflow you can build today using client orchestration.

```
Phase 1: Requirements & Design (parallel)
──────────────────────────────────────────
  ┌─── UI/UX Designer (wireframe + UX spec)
  │
  └─── Architect (system design + API spec)

Phase 2: Implementation (parallel, depends on Phase 1)
──────────────────────────────────────────────────────
  ┌─── Frontend Engineer (React components, reads UI + API spec)
  │
  └─── Backend Engineer (API + DB, reads Architecture)

Phase 3: Review (sequential, depends on Phase 2)
─────────────────────────────────────────────────
  Code Reviewer (reviews both frontend + backend code)

Phase 4: Fix (conditional, depends on Phase 3)
──────────────────────────────────────────────
  If review fails → Engineers fix → Re-review
```

See `tests/test-multi-agent.sh` for the full runnable script.

---

## 5. Recommendations for Future Enhancement

### Priority 1: Multi-Context Support

Allow a task to receive multiple context files. This is the #1 gap for team workflows.

```json
{
  "prompt": "Implement based on both design and architecture",
  "contextFiles": [
    "workspace/results/result-design.md",
    "workspace/results/result-arch.md"
  ]
}
```

### Priority 2: Fan-Out / Fan-In in Chains

Allow chain steps to run in parallel and merge results.

```json
{
  "steps": [
    { "prompt": "Design UI", "agentId": "designer" },
    { "prompt": "Design API", "agentId": "architect" },
    {
      "prompt": "Implement",
      "agentId": "engineer",
      "dependsOn": [1, 2]
    }
  ]
}
```

### Priority 3: Conditional Steps

Allow branching based on previous results.

```json
{
  "prompt": "Review code. End with VERDICT: PASS or FAIL",
  "agentId": "reviewer",
  "onFail": {
    "prompt": "Fix the issues",
    "agentId": "engineer",
    "maxRetries": 2
  }
}
```

### Priority 4: Workspace File API

```
GET  /workspace/files              ← list all files
GET  /workspace/files/:path        ← read file content
POST /workspace/files/:path        ← upload/create file
DELETE /workspace/files/:path      ← delete file
```
