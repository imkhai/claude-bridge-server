# Claude Bridge Server

HTTP bridge between AI agents and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). Submit tasks via HTTP, get results back — with job queuing, concurrency control, multi-step chains, and multi-agent team workflows.

```
  Agent-1  Agent-2  Agent-3  ...  Agent-N
     │        │        │            │
     ▼        ▼        ▼            ▼
┌─────────────────────────────────────────┐
│      Claude Bridge (localhost:3210)      │
│                                         │
│   Job Queue (FIFO, MAX_PARALLEL slots)  │
│         │         │         │           │
│     claude -p  claude -p  claude -p     │
│                                         │
│   workspace/results/result-{id}.md      │
└─────────────────────────────────────────┘
```

## Quick Start

```bash
# Install
git clone https://github.com/imkhai/claude-bridge-server.git
cd claude-bridge-server
npm install

# Start
npm start
# or with live reload:
npm run dev

# Verify
curl http://localhost:3210/health
```

**Requirements:** Node.js 20+, [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

## Configuration

All via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `3210` | HTTP server port |
| `MAX_PARALLEL` | `4` | Max concurrent claude processes |
| `TIMEOUT_MS` | `600000` | Per-task timeout (10 min) |
| `WORKSPACE` | `./workspace` | Root directory for all files |
| `CLAUDE_PATH` | `claude` | Path to claude CLI binary |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

```bash
MAX_PARALLEL=8 TIMEOUT_MS=300000 npm start
```

## API Reference

### POST /ask — Submit Task (Async)

Returns immediately with a `taskId`. Poll `/status/:taskId` for the result.

```bash
curl -X POST http://localhost:3210/ask \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain binary search", "agentId": "teacher"}'
```

```json
{"taskId": "a1b2c3d4", "status": "queued", "position": 1}
```

### POST /ask/sync — Submit Task (Synchronous)

Waits for completion, returns the full result.

```bash
curl -X POST http://localhost:3210/ask/sync \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 2+2?", "agentId": "math"}'
```

```json
{
  "taskId": "a1b2c3d4",
  "agentId": "math",
  "status": "done",
  "result": "Four\n",
  "error": null,
  "resultFile": "/path/to/workspace/results/result-a1b2c3d4.md",
  "duration": 6897,
  "tokensEstimate": null
}
```

### Request Body (both /ask and /ask/sync)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | The task/prompt for Claude |
| `agentId` | string | No | Identifier for the calling agent (default: `unknown`) |
| `context` | string | No | Inline context text (saved to temp file, passed to Claude) |
| `contextFile` | string | No | Path to an existing file for Claude to read |
| `workingDir` | string | No | Working directory for the claude process |

### GET /status/:taskId — Check Task Status

```bash
curl http://localhost:3210/status/a1b2c3d4
```

**Status values:** `queued`, `running`, `done`, `error`, `timeout`, `cancelled`

### GET /jobs — List All Jobs

```bash
curl "http://localhost:3210/jobs?status=done&agentId=researcher&limit=10"
```

### POST /cancel/:taskId — Cancel a Task

```bash
curl -X POST http://localhost:3210/cancel/a1b2c3d4
```

### GET /health — Health Check

```bash
curl http://localhost:3210/health
```

### POST /chain — Multi-Step Chain

Sequential pipeline where each step can read the previous step's result.

```bash
curl -X POST http://localhost:3210/chain \
  -H "Content-Type: application/json" \
  -d '{
    "steps": [
      {"prompt": "Write a haiku about coding", "agentId": "poet"},
      {"prompt": "Translate to Vietnamese", "agentId": "translator", "usesPreviousResult": true}
    ]
  }'
```

```json
{
  "chainId": "chain-a1b2c3",
  "steps": [
    {"taskId": null, "step": 1, "status": "running"},
    {"taskId": null, "step": 2, "status": "pending"}
  ]
}
```

### GET /chain/:chainId — Check Chain Status

```bash
curl http://localhost:3210/chain/chain-a1b2c3
```

## Context Passing

Three ways to give Claude additional context:

```bash
# 1. Inline context (text in request body)
curl -X POST http://localhost:3210/ask/sync \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Review this code", "context": "function add(a,b) { return a+b; }"}'

# 2. Context file (path to existing file)
curl -X POST http://localhost:3210/ask/sync \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Improve this", "contextFile": "workspace/results/result-abc123.md"}'

# 3. Chain auto-pass (previous step's result)
# Set "usesPreviousResult": true in chain steps
```

## Workflow Examples

### Bug Investigation

```bash
curl -X POST http://localhost:3210/chain -H "Content-Type: application/json" -d '{
  "steps": [
    {"prompt": "Analyze this bug: login form submits twice causing race condition. List repro steps and severity.", "agentId": "reproducer"},
    {"prompt": "Determine the root cause based on the analysis.", "agentId": "root-cause-analyst", "usesPreviousResult": true},
    {"prompt": "Write the minimal fix. Show before/after code.", "agentId": "fixer", "usesPreviousResult": true},
    {"prompt": "Review the fix. Check for regressions. Write 3 test cases. End with VERDICT: APPROVED or NEEDS CHANGES.", "agentId": "verifier", "usesPreviousResult": true}
  ]
}'
```

### Security Review

```bash
curl -X POST http://localhost:3210/chain -H "Content-Type: application/json" -d '{
  "steps": [
    {"prompt": "Audit this code against OWASP Top 10...", "agentId": "security-auditor"},
    {"prompt": "Rewrite with proper security controls.", "agentId": "security-engineer", "usesPreviousResult": true},
    {"prompt": "Pen test the hardened code for remaining vulnerabilities.", "agentId": "pen-tester", "usesPreviousResult": true}
  ]
}'
```

### Parallel Tasks

```bash
# Submit multiple tasks at once — they run in parallel up to MAX_PARALLEL
curl -X POST http://localhost:3210/ask -d '{"prompt":"Research React","agentId":"r1"}' -H "Content-Type: application/json"
curl -X POST http://localhost:3210/ask -d '{"prompt":"Research Vue","agentId":"r2"}' -H "Content-Type: application/json"
curl -X POST http://localhost:3210/ask -d '{"prompt":"Research Svelte","agentId":"r3"}' -H "Content-Type: application/json"
```

See [docs/workflow-recipes.md](docs/workflow-recipes.md) for 12 complete recipes with curl commands.

## Postman Collection

Import these files into Postman for a ready-to-use API workspace:

```
postman/Claude_Bridge.postman_collection.json    ← 30 requests across 10 folders
postman/Claude_Bridge.postman_environment.json   ← Environment variables
```

Includes workflow folders: Quick Tasks, Bug Investigation, Security Review, Code Refactoring, Test Generation, Performance Audit, PR Review, and Learning Path.

## Testing

```bash
# Start the server first
npm start

# In another terminal — run test suites
./tests/test-basic.sh              # Health, validation, async/sync, context
./tests/test-chain.sh              # Chains, file handoff, parallel chains
./tests/test-multi-agent.sh        # Full team: Designer→Architect→Engineer→Reviewer
./tests/test-quick-tasks.sh        # Code explain, error decode, SQL, regex
./tests/test-bug-investigation.sh  # 4-step bug pipeline
./tests/test-refactoring.sh        # 3-step refactoring pipeline
./tests/test-security-review.sh    # 3-step security pipeline
./tests/test-parallel-bulk.sh      # Bulk submit, concurrency, cancel
```

## Project Structure

```
claude-bridge-server/
├── server.mjs                  ← Entry point
├── package.json
├── src/
│   ├── config.mjs              ← Environment config
│   ├── queue.mjs               ← Job queue & scheduler
│   ├── claude-runner.mjs       ← Process spawning
│   ├── routes/
│   │   ├── ask.mjs             ← POST /ask, POST /ask/sync
│   │   ├── chain.mjs           ← POST /chain, GET /chain/:id
│   │   ├── status.mjs          ← GET /status/:id
│   │   ├── jobs.mjs            ← GET /jobs
│   │   ├── health.mjs          ← GET /health
│   │   └── cancel.mjs          ← POST /cancel/:id
│   └── utils/
│       ├── logger.mjs          ← Structured console logger
│       └── file-manager.mjs    ← Workspace file operations
├── docs/
│   ├── architecture.md         ← System design & flow diagrams
│   ├── multi-agent-workflows.md ← Team workflow patterns
│   └── workflow-recipes.md     ← 12 practical recipes
├── postman/
│   ├── Claude_Bridge.postman_collection.json
│   └── Claude_Bridge.postman_environment.json
├── tests/
│   └── *.sh                    ← 8 test suites (119 assertions)
└── workspace/                  ← Created at runtime
    ├── tasks/                  ← Saved prompts
    ├── results/                ← Claude output files
    ├── contexts/               ← Temp context files
    └── shared/                 ← Shared documents
```

## Docs

| Document | Description |
|----------|-------------|
| [architecture.md](docs/architecture.md) | System design, request flows, concurrency, job lifecycle |
| [multi-agent-workflows.md](docs/multi-agent-workflows.md) | Team patterns, capabilities, limitations, future enhancements |
| [workflow-recipes.md](docs/workflow-recipes.md) | 12 ready-to-use recipes with curl commands |
