# Claude Bridge Server — Project Guide

## What This Is

HTTP bridge server that lets AI agents submit tasks to Claude Code CLI via HTTP. Agents POST prompts, the server queues them, spawns `claude -p` processes with concurrency control, and returns results.

## Quick Reference

```bash
npm install          # Install dependencies
npm start            # Start server on port 3210
npm run dev          # Start with --watch (live reload)
curl localhost:3210/health  # Verify running
```

## Architecture

```
HTTP Request → Express Route → Job Queue (FIFO) → claude -p (spawned process) → Result File
```

- **Entry point:** `server.mjs` — Express app, route mounting, graceful shutdown
- **Config:** `src/config.mjs` — all via env vars (BRIDGE_PORT, BIND_HOST, API_KEY, MAX_PARALLEL, TIMEOUT_MS, WORKSPACE, CLAUDE_PATH, LOG_LEVEL, DEFAULT_ALLOWED_TOOLS, DEFAULT_MAX_TURNS, MAX_QUEUE_SIZE, JOB_TTL_MS)
- **Queue:** `src/queue.mjs` — in-memory Map, FIFO scheduling, respects MAX_PARALLEL concurrency limit
- **Runner:** `src/claude-runner.mjs` — spawns `claude -p <prompt> --no-session-persistence`, handles timeout (SIGTERM→SIGKILL after 5s), 10MB buffer limit
- **Routes:** `src/routes/*.mjs` — one file per endpoint
- **Utils:** `src/utils/logger.mjs` (structured logging), `src/utils/file-manager.mjs` (workspace filesystem ops)

## API Endpoints

### Core

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/ask` | Submit task (async), returns taskId immediately |
| POST | `/ask/sync` | Submit task (sync), waits for result |
| GET | `/status/:taskId` | Get task status and result |
| GET | `/progress` | Real-time progress for all running tasks |
| GET | `/jobs` | List jobs (filter by ?status, ?agentId, ?limit) |
| POST | `/cancel/:taskId` | Cancel queued or running task |
| GET | `/health` | Server health + queue stats |
| POST | `/chain` | Submit multi-step sequential pipeline |
| GET | `/chain/:chainId` | Check chain progress |

### Dashboard API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dashboard/agents` | Agent status derived from queue jobs |
| GET | `/api/dashboard/chains` | Active/recent chain status |
| GET | `/api/dashboard/timeline` | Recent events (ring buffer, 100 entries) |
| GET | `/api/dashboard/worklog` | Completed job history |
| GET | `/api/dashboard/leaderboard` | Per-agent performance rankings |
| GET | `/api/dashboard/stream` | SSE endpoint for real-time dashboard updates |

### Chat Commander API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat/send` | Send message, auto-detect intent, spawn agents |
| POST | `/api/chat/upload` | Upload files (images, docs, code — 50MB max) |
| GET | `/api/chat/conversations` | List all conversations |
| GET | `/api/chat/conversations/:id` | Get single conversation with messages |
| DELETE | `/api/chat/conversations/:id` | Delete a conversation |
| GET | `/api/chat/files` | List uploaded files |
| GET | `/api/chat/stream/:conversationId` | SSE for real-time agent updates |
| GET | `/api/chat/uploads/:filename` | Serve uploaded files |

## Job Lifecycle

```
queued → running → done | error | timeout | cancelled
```

## Key Design Decisions

1. **ES Modules** — `"type": "module"` in package.json, all files use `.mjs` extension
2. **No database** — all state is in-memory Maps. Jobs lost on restart.
3. **CLAUDECODE env var** — must be deleted from spawned process env to avoid "nested session" error from Claude CLI
4. **Context passing** — 3 methods: inline `context` field (saved to temp file), `contextFile` path, or chain `usesPreviousResult` (auto-passes previous step's result file)
5. **Result files** — saved to `workspace/results/result-{taskId}.md` with metadata header
6. **Chain execution** — sequential only, each step waits for previous. If a step fails, remaining steps are cancelled.

## Working with the Code

### Adding a new endpoint

1. Create `src/routes/your-route.mjs` — export a Router
2. Import and `app.use()` it in `server.mjs`

### Modifying queue behavior

All queue logic is in `src/queue.mjs`. The `executeJob()` function handles the full lifecycle: save task → save context → run claude → save result → update job state.

### Modifying how Claude is invoked

Edit `src/claude-runner.mjs`. The `runClaude()` function builds the args array and spawns the process. Context is injected by prepending to the prompt: `"Read the file at ${contextFile} for context. Then: ${prompt}"`.

## Testing

Server must be running first (`npm start` in one terminal).

```bash
./tests/test-basic.sh              # Core: health, validation, async/sync, context
./tests/test-chain.sh              # Multi-step chains, file handoff
./tests/test-multi-agent.sh        # Full team workflow (parallel phases)
./tests/test-quick-tasks.sh        # Simple tasks: explain, decode, SQL, regex
./tests/test-bug-investigation.sh  # 4-step bug pipeline
./tests/test-refactoring.sh        # 3-step refactoring pipeline
./tests/test-security-review.sh    # 3-step security pipeline
./tests/test-parallel-bulk.sh      # Bulk submit, concurrency, cancel
```

All tests are bash scripts using curl + python3 for JSON parsing. Total: 119 assertions across 8 suites.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_PORT` | `3210` | HTTP server port |
| `BIND_HOST` | `127.0.0.1` | Network interface to bind to |
| `API_KEY` | _(none)_ | API key for auth (disabled if unset) |
| `MAX_PARALLEL` | `4` | Max concurrent claude processes |
| `TIMEOUT_MS` | `600000` | Per-task timeout (10 min) |
| `WORKSPACE` | `./workspace` | Root directory for all files |
| `CLAUDE_PATH` | `claude` | Path to claude CLI binary |
| `LOG_LEVEL` | `info` | debug, info, warn, error |
| `DEFAULT_ALLOWED_TOOLS` | _(none)_ | Default tools for all tasks (comma-separated or `all`) |
| `DEFAULT_MAX_TURNS` | `0` | Default max agentic turns (0 = unlimited) |
| `MAX_QUEUE_SIZE` | `1000` | Max jobs in queue |
| `JOB_TTL_MS` | `3600000` | Job time-to-live (1 hour) |

## Workspace Layout

```
workspace/
├── tasks/           # Saved prompts (task-{id}.md)
├── results/         # Claude output (result-{id}.md)
├── contexts/        # Temp context files (context-{id}.md)
├── shared/          # Shared documents between agents
├── uploads/         # Files uploaded via Chat Commander
└── conversations/   # Chat conversation JSON files
```

## Chat Commander

Accessible at `/chat`. A conversational interface that auto-routes requests to specialized agent teams.

- **Intent detection** — analyzes message keywords and attached files to select an agent pattern (bug-report, implementation, review, bugfix, design, documentation, research, general)
- **Agent routing** — spawns single agents, sequential chains, or parallel teams based on intent
- **File upload** — supports images, docs, code files (50MB max, filtered extensions)
- **Conversation history** — persisted as JSON in `workspace/conversations/`
- **Real-time updates** — SSE stream per conversation for live agent status and messages
- **Image analysis** — if images are attached with a bug report, an image-analyzer agent runs first

## Workflow Rules — ALWAYS FOLLOW

When the user asks to implement, fix, review, or improve anything in this project:

1. **ALWAYS use the bridge** — Submit tasks to `http://localhost:3210` via the API. NEVER implement directly yourself.
2. **Check bridge is running first** — `curl -s http://localhost:3210/health`. If down, start it: `MAX_PARALLEL=8 WORKSPACE=/Users/khainguyen/ws_me/claude-bridge-server TIMEOUT_MS=900000 node server.mjs > /tmp/bridge-server.log 2>&1 &`
3. **Choose the right pattern:**
   - **Single task** → `POST /ask` (async) or `POST /ask/sync` (wait for result)
   - **Independent tasks** → Submit multiple `POST /ask` in parallel (up to 8 workers)
   - **Sequential pipeline** → `POST /chain` with steps that `usesPreviousResult`
4. **Assign agent roles** — Use descriptive `agentId` values matching the task (e.g., `security-auditor`, `frontend-engineer`, `animation-fixer`, `qa-reviewer`)
5. **Give agents full tools** — Always include `"allowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash"]` so agents can directly modify files
6. **Set workingDir** — Always set `"workingDir": "/Users/khainguyen/ws_me/claude-bridge-server"`
7. **Monitor progress** — Use `GET /progress` to check real-time status, `GET /jobs` for completion
8. **Report results** — After agents complete, verify files changed and summarize what was done
9. **Dashboard** — Available at `http://localhost:3210/dashboard/` (Real Mode = visual office, Simple Mode = terminal)

### Common Agent Team Patterns

**Security Review:**
```
Chain: security-auditor → tech-lead → senior-engineer → qa-reviewer
```

**Feature Implementation:**
```
Parallel: architect + designer (plan) → Parallel: backend-engineer + frontend-engineer (build) → integration-engineer (test)
```

**Bug Fix:**
```
Chain: investigator → senior-engineer → qa-reviewer
```

**Visual/Animation Work:**
```
Parallel: character-animator + desk-artist + environment-engineer + interaction-designer
```

## Common Issues

- **Port already in use**: `lsof -ti:3210 | xargs kill -9`
- **Claude CLI not found**: ensure `claude` is in PATH or set `CLAUDE_PATH`
- **Nested session error**: the runner deletes `CLAUDECODE` env var to prevent this — don't revert that
- **`--no-input` flag**: doesn't exist in Claude CLI, use `--no-session-persistence` instead
