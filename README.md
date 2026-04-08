# Claude Bridge Server

HTTP bridge between AI agents and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code). Submit tasks via HTTP, get results back — with job queuing, concurrency control, multi-step chains, multi-agent team workflows, a visual dashboard, and a chat interface. Data persists in SQLite.

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
│   SQLite (bridge.db) + Result Files     │
└─────────────────────────────────────────┘
```

## Features

- **HTTP API** — async and sync task submission, cancellation, status polling, real-time progress
- **Job queue** — FIFO with configurable concurrency (MAX_PARALLEL), timeout, and buffer limits
- **Multi-step chains** — sequential pipelines where each step can consume the previous step's result
- **SQLite persistence** — conversations, messages, completed jobs, agent stats, and uploaded file metadata survive restarts
- **Dashboard** — visual monitoring at `/dashboard` (Real Mode = animated office, Simple Mode = terminal view) with SSE real-time updates
- **Chat Commander** — conversational interface at `/chat` with intent detection, file upload, and automatic agent team routing
- **Security** — API key auth (timing-safe), input validation, path traversal prevention, tool whitelist enforcement

## Quick Start

```bash
# Install
git clone https://github.com/imkhai/claude-bridge-server.git
cd claude-bridge-server
npm install

# Start
./start.sh                # Foreground
./start.sh --background   # Background (logs to /tmp/bridge-server.log)
./stop.sh                 # Stop

# Verify
curl http://localhost:3210/health
```

**Requirements:** Node.js 20+, [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

## Configuration

All via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `3210` | HTTP server port |
| `BIND_HOST` | `127.0.0.1` | Network interface to bind to |
| `API_KEY` | _(none)_ | API key for auth (disabled if unset) |
| `MAX_PARALLEL` | `4` | Max concurrent claude processes |
| `TIMEOUT_MS` | `600000` | Per-task timeout (10 min) |
| `WORKSPACE` | `./bridge-data` | Root directory for files and SQLite DB |
| `CLAUDE_PATH` | `claude` | Path to claude CLI binary |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `DEFAULT_ALLOWED_TOOLS` | _(none)_ | Default tools for all tasks (comma-separated or `all`) |
| `DEFAULT_MAX_TURNS` | `0` | Default max agentic turns (0 = unlimited) |
| `MAX_QUEUE_SIZE` | `1000` | Max jobs in queue |
| `JOB_TTL_MS` | `3600000` | Job time-to-live in memory (1 hour) |
| `CHAT_WORKING_DIR` | _(WORKSPACE)_ | Working directory for Chat Commander agents |

```bash
# Default start (uses start.sh defaults: 8 workers, all tools, 0.0.0.0)
./start.sh --background

# Override specific settings
MAX_PARALLEL=2 TIMEOUT_MS=300000 ./start.sh

# With auth
API_KEY=my-secret-key ./start.sh --background

# Or run directly with env vars
WORKSPACE=./bridge-data BIND_HOST=0.0.0.0 node server.mjs
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
  "resultFile": "/path/to/bridge-data/results/result-a1b2c3d4.md",
  "duration": 6897
}
```

### Request Body (both /ask and /ask/sync)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | The task/prompt for Claude (max 100,000 chars) |
| `agentId` | string | No | Identifier for the calling agent (default: `unknown`, max 100 chars) |
| `context` | string | No | Inline context text (saved to temp file, passed to Claude, max 500,000 chars) |
| `contextFile` | string | No | Path to an existing file for Claude to read (must be within workspace) |
| `workingDir` | string | No | Working directory for the claude process (must be within workspace) |
| `allowedTools` | string[] | No | Tools Claude can use: `["Read","Write","Edit","Bash","Glob","Grep"]` |
| `disallowedTools` | string[] | No | Tools to explicitly deny |
| `maxTurns` | number | No | Max agentic turns (1-100, limits tool use iterations) |

### GET /status/:taskId — Check Task Status

```bash
curl http://localhost:3210/status/a1b2c3d4
```

Returns task details including real-time progress (output bytes, elapsed time, recent stderr) for running tasks.

**Status values:** `queued`, `running`, `done`, `error`, `timeout`, `cancelled`

### GET /progress — Real-Time Progress

```bash
curl http://localhost:3210/progress
```

Returns progress for all running tasks (output bytes, elapsed time, last activity, recent stderr lines).

### GET /jobs — List Jobs

```bash
curl "http://localhost:3210/jobs?status=done&agentId=researcher&limit=10"
```

### POST /cancel/:taskId — Cancel a Task

```bash
curl -X POST http://localhost:3210/cancel/a1b2c3d4
```

Cancels queued (removed from queue) or running (SIGTERM→SIGKILL) tasks.

### GET /health — Health Check

```bash
curl http://localhost:3210/health
```

```json
{"ok": true, "uptime": 3600, "active": 2, "maxParallel": 4, "queued": 0, "totalProcessed": 42}
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

Each step accepts the same fields as `/ask` plus `usesPreviousResult` (boolean). If a step fails, remaining steps are cancelled.

### GET /chain/:chainId — Check Chain Status

```bash
curl http://localhost:3210/chain/chain-a1b2c3
```

## Dashboard

Visual monitoring interface at `http://localhost:3210/dashboard/`.

- **Real Mode** — animated visual office showing agents at desks, real-time task progress, chain visualizations, and a leaderboard
- **Simple Mode** — terminal-style view with agent status, job list, and timeline events

Data served via REST endpoints and a real-time SSE stream:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard/agents` | Agent status derived from queue jobs |
| GET | `/api/dashboard/chains` | Active/recent chain status |
| GET | `/api/dashboard/timeline` | Recent events (ring buffer, 100 entries) |
| GET | `/api/dashboard/worklog` | Completed job history (from SQLite) |
| GET | `/api/dashboard/leaderboard` | Per-agent performance rankings (from SQLite) |
| GET | `/api/dashboard/stream` | SSE — pushes agents, chains, leaderboard every 2s + real-time timeline events |

## Chat Commander

Conversational interface at `http://localhost:3210/chat`.

- **Natural language** — describe what you need; intent detection routes to the right agent team
- **Intent patterns** — bug-report (with screenshots), implementation (with/without spec), review/audit, bugfix, design/UI, documentation, research, general
- **Agent routing** — spawns single agents, sequential chains, or parallel teams based on detected intent
- **File upload** — attach images, docs, or code files (up to 50MB per file, 10 files per request). Supported extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.md`, `.txt`, `.pdf`, `.js`, `.mjs`, `.ts`, `.tsx`, `.jsx`, `.py`, `.go`, `.rs`, `.java`, `.c`, `.cpp`, `.h`, `.json`, `.yaml`, `.yml`, `.toml`, `.csv`, `.sh`, `.bash`, `.zsh`, `.css`, `.html`, `.svg`
- **Image analysis** — images attached to bug reports trigger an image-analyzer agent automatically before other agents
- **Conversation history** — persisted in SQLite, browsable in the UI
- **Real-time updates** — SSE stream per conversation shows agent status and messages as they complete

### Chat API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat/send` | Send message, detect intent, spawn agents |
| POST | `/api/chat/upload` | Upload files (max 10 files, 50MB each) |
| GET | `/api/chat/conversations` | List all conversations |
| GET | `/api/chat/conversations/:id` | Get conversation with full message history |
| DELETE | `/api/chat/conversations/:id` | Delete a conversation |
| GET | `/api/chat/files` | List uploaded files |
| GET | `/api/chat/stream/:conversationId` | SSE for real-time agent updates |
| GET | `/api/chat/uploads/:filename` | Serve uploaded files |

## Database

SQLite database at `bridge-data/bridge.db` using `better-sqlite3` with WAL mode.

**Tables:**
- `conversations` — id, title, created_at, updated_at
- `messages` — id, conversation_id (FK), role, agent_id, content, files (JSON), routing (JSON), task_id, duration, status, timestamp
- `jobs` — id, agent_id, status, prompt (first 200 chars), result, error, working_dir, timestamps, duration, exit_code, result_file
- `uploaded_files` — id, filename, original_name, path, mimetype, size, conversation_id, created_at
- `agent_stats` — agent_id (PK), total_tasks, success_count, error_count, timeout_count, total_duration, last_active_at

On first startup, existing JSON conversation files in `bridge-data/conversations/` are automatically migrated to SQLite.

## Context Passing

Three ways to give Claude additional context:

```bash
# 1. Inline context (text in request body)
curl -X POST http://localhost:3210/ask/sync \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Review this code", "context": "function add(a,b) { return a+b; }"}'

# 2. Context file (path to existing file within workspace)
curl -X POST http://localhost:3210/ask/sync \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Improve this", "contextFile": "bridge-data/results/result-abc123.md"}'

# 3. Chain auto-pass (previous step's result)
# Set "usesPreviousResult": true in chain steps
```

## Security

- **API key auth** — set `API_KEY` env var to require `Authorization: Bearer <key>` header. Uses timing-safe comparison. Health and dashboard endpoints are exempt
- **Input validation** — prompt length limits (100K chars), context limits (500K chars), agentId length/character checks, maxTurns range (1-100)
- **Path traversal prevention** — `contextFile` and `workingDir` are validated to be within the workspace directory
- **Tool whitelist** — when `DEFAULT_ALLOWED_TOOLS` is set, per-request `allowedTools` are checked against the server whitelist
- **File upload filtering** — only allowed extensions accepted, filenames sanitized
- **Process isolation** — `CLAUDECODE` env var deleted from spawned processes to prevent nested session errors
- **Buffer limits** — 10MB output buffer per process, SIGKILL on exceed
- **Request body limit** — 2MB JSON body limit

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
├── server.mjs                  ← Entry point (Express, SQLite init, shutdown)
├── start.sh                    ← Start script (sets all env vars correctly)
├── stop.sh                     ← Stop script
├── package.json                ← Dependencies: express, better-sqlite3, multer
├── src/
│   ├── config.mjs              ← Environment config
│   ├── db.mjs                  ← SQLite database (schema, queries, migration)
│   ├── queue.mjs               ← Job queue, scheduler, timeline events, agent stats
│   ├── claude-runner.mjs       ← Process spawning, progress tracking
│   ├── middleware/
│   │   ├── auth.mjs            ← API key authentication (timing-safe)
│   │   └── request-logger.mjs  ← Request duration logging
│   ├── routes/
│   │   ├── ask.mjs             ← POST /ask, POST /ask/sync
│   │   ├── chain.mjs           ← POST /chain, GET /chain/:id
│   │   ├── status.mjs          ← GET /status/:id, GET /progress
│   │   ├── jobs.mjs            ← GET /jobs
│   │   ├── health.mjs          ← GET /health
│   │   ├── cancel.mjs          ← POST /cancel/:id
│   │   ├── dashboard-api.mjs   ← Dashboard REST + SSE endpoints
│   │   └── chat-api.mjs        ← Chat Commander REST + SSE + file upload
│   └── utils/
│       ├── logger.mjs          ← Structured console logger with levels
│       ├── file-manager.mjs    ← Workspace directory/file operations
│       └── validators.mjs      ← Input validation, path traversal checks
├── dashboard/                  ← Dashboard static files (Real Mode + Simple Mode)
│   └── chat/                   ← Chat Commander static files
├── docs/
│   ├── architecture.md         ← System design & flow diagrams
│   ├── multi-agent-workflows.md ← Team workflow patterns
│   └── workflow-recipes.md     ← 12 practical recipes
├── postman/
│   ├── Claude_Bridge.postman_collection.json
│   └── Claude_Bridge.postman_environment.json
├── tests/
│   └── *.sh                    ← 8 test suites (119 assertions)
└── bridge-data/                ← Created at runtime
    ├── bridge.db               ← SQLite database
    ├── tasks/                  ← Saved prompts
    ├── results/                ← Claude output files
    ├── contexts/               ← Temp context files
    ├── shared/                 ← Shared documents
    ├── uploads/                ← Files uploaded via Chat Commander
    └── conversations/          ← Legacy JSON files (migrated to SQLite)
```

## Docs

| Document | Description |
|----------|-------------|
| [architecture.md](docs/architecture.md) | System design, request flows, concurrency, job lifecycle |
| [multi-agent-workflows.md](docs/multi-agent-workflows.md) | Team patterns, capabilities, limitations, future enhancements |
| [workflow-recipes.md](docs/workflow-recipes.md) | 12 ready-to-use recipes with curl commands |
