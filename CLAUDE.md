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
- **Config:** `src/config.mjs` — all via env vars (BRIDGE_PORT, MAX_PARALLEL, TIMEOUT_MS, WORKSPACE, CLAUDE_PATH, LOG_LEVEL)
- **Queue:** `src/queue.mjs` — in-memory Map, FIFO scheduling, respects MAX_PARALLEL concurrency limit
- **Runner:** `src/claude-runner.mjs` — spawns `claude -p <prompt> --no-session-persistence`, handles timeout (SIGTERM→SIGKILL after 5s), 10MB buffer limit
- **Routes:** `src/routes/*.mjs` — one file per endpoint
- **Utils:** `src/utils/logger.mjs` (structured logging), `src/utils/file-manager.mjs` (workspace filesystem ops)

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/ask` | Submit task (async), returns taskId immediately |
| POST | `/ask/sync` | Submit task (sync), waits for result |
| GET | `/status/:taskId` | Get task status and result |
| GET | `/jobs` | List jobs (filter by ?status, ?agentId, ?limit) |
| POST | `/cancel/:taskId` | Cancel queued or running task |
| GET | `/health` | Server health + queue stats |
| POST | `/chain` | Submit multi-step sequential pipeline |
| GET | `/chain/:chainId` | Check chain progress |

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
| `MAX_PARALLEL` | `4` | Max concurrent claude processes |
| `TIMEOUT_MS` | `600000` | Per-task timeout (10 min) |
| `WORKSPACE` | `./workspace` | Root directory for all files |
| `CLAUDE_PATH` | `claude` | Path to claude CLI binary |
| `LOG_LEVEL` | `info` | debug, info, warn, error |

## Workspace Layout

```
workspace/
├── tasks/      # Saved prompts (task-{id}.md)
├── results/    # Claude output (result-{id}.md)
├── contexts/   # Temp context files (context-{id}.md)
└── shared/     # Shared documents between agents
```

## Common Issues

- **Port already in use**: `lsof -ti:3210 | xargs kill -9`
- **Claude CLI not found**: ensure `claude` is in PATH or set `CLAUDE_PATH`
- **Nested session error**: the runner deletes `CLAUDECODE` env var to prevent this — don't revert that
- **`--no-input` flag**: doesn't exist in Claude CLI, use `--no-session-persistence` instead
