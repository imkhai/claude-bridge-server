# Claude Bridge Server — Project Guide

## What This Is

HTTP bridge server that lets AI agents submit tasks to Claude Code CLI via HTTP. Agents POST prompts, the server queues them, spawns `claude -p` processes with concurrency control, and returns results. Data is persisted to SQLite.

## Quick Reference

```bash
npm install          # Install dependencies (express, better-sqlite3, multer)
./start.sh           # Start server (foreground)
./start.sh --background  # Start server (background, logs to /tmp/bridge-server.log)
./stop.sh            # Stop server
curl localhost:3210/health  # Verify running
```

## Architecture

```
HTTP Request → Express Route → Job Queue (FIFO, in-memory) → claude -p (spawned process) → Result File + SQLite
```

- **Entry point:** `server.mjs` — Express app, route mounting, SQLite init, JSON conversation migration, graceful shutdown
- **Config:** `src/config.mjs` — all via env vars (see Environment Variables below)
- **Database:** `src/db.mjs` — SQLite via better-sqlite3 at `bridge-data/bridge.db`. Tables: `conversations`, `messages`, `jobs`, `uploaded_files`, `agent_stats`, `conversation_summaries`. WAL mode, prepared statement cache, auto-migration from legacy JSON conversations on startup
- **Summarizer:** `src/summarizer.mjs` — generates compact conversation summaries after agents complete. Spawns a `summarizer` agent (pure text, no tools) to compress conversation history into structured Markdown. Summaries are stored in both SQLite and files (`bridge-data/summaries/`). Loaded and injected as context when users send follow-up messages in existing conversations
- **Queue:** `src/queue.mjs` — in-memory Map for active jobs, FIFO scheduling, respects MAX_PARALLEL concurrency limit. Completed jobs are persisted to SQLite. Timeline events stored in a 100-entry ring buffer with SSE push to listeners
- **Runner:** `src/claude-runner.mjs` — spawns `claude -p <prompt> --no-session-persistence`, handles timeout (SIGTERM→SIGKILL after 5s), 10MB buffer limit, real-time progress tracking (output bytes, stderr lines, last activity)
- **Routes:** `src/routes/*.mjs` — one file per endpoint group
- **Middleware:** `src/middleware/auth.mjs` (API key with timing-safe comparison, skips health/dashboard), `src/middleware/request-logger.mjs` (request duration logging)
- **Utils:** `src/utils/logger.mjs` (structured console logging with levels), `src/utils/file-manager.mjs` (workspace directory creation, task/context/result file ops), `src/utils/validators.mjs` (input validation, path traversal prevention, tool whitelist enforcement)

## API Endpoints

### Core

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/ask` | Submit task (async), returns taskId immediately |
| POST | `/ask/sync` | Submit task (sync), waits for result |
| GET | `/status/:taskId` | Get task status, result, and real-time progress |
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
| GET | `/api/dashboard/worklog` | Completed job history (from SQLite) |
| GET | `/api/dashboard/leaderboard` | Per-agent performance rankings (from SQLite agent_stats) |
| GET | `/api/dashboard/stream` | SSE endpoint for real-time dashboard updates |

### Chat Commander API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat/send` | Send message, auto-detect intent, spawn agents |
| POST | `/api/chat/upload` | Upload files (max 10 files, 50MB each) |
| GET | `/api/chat/conversations` | List all conversations |
| GET | `/api/chat/conversations/:id` | Get single conversation with messages |
| DELETE | `/api/chat/conversations/:id` | Delete a conversation |
| GET | `/api/chat/files` | List uploaded files |
| GET | `/api/chat/stream/:conversationId` | SSE for real-time agent updates |
| GET | `/api/chat/uploads/:filename` | Serve uploaded files |
| GET | `/api/chat/conversations/:id/summary` | Get conversation summary |
| POST | `/api/chat/conversations/:id/summary/regenerate` | Force-regenerate summary |

## Job Lifecycle

```
queued → running → done | error | timeout | cancelled
```

Completed jobs are persisted to the `jobs` table in SQLite. Agent performance stats are updated in `agent_stats` on completion.

## Key Design Decisions

1. **ES Modules** — `"type": "module"` in package.json, all files use `.mjs` extension
2. **SQLite persistence** — `better-sqlite3` with WAL mode. Stores conversations, messages, completed jobs, uploaded file metadata, and agent stats. Active jobs remain in-memory Maps for speed; completed jobs persist to DB
3. **Auto-migration** — On startup, existing JSON conversation files in `bridge-data/conversations/` are migrated to SQLite (one-time, skipped if DB already has data)
4. **CLAUDECODE env var** — must be deleted from spawned process env to avoid "nested session" error from Claude CLI
5. **Context passing** — 3 methods: inline `context` field (saved to temp file), `contextFile` path, or chain `usesPreviousResult` (auto-passes previous step's result file)
6. **Result files** — saved to `bridge-data/results/result-{taskId}.md` with metadata header
7. **Chain execution** — sequential only, each step waits for previous. If a step fails, remaining steps are cancelled
8. **Progress tracking** — `claude-runner.mjs` tracks output bytes, stderr lines, and last activity per process. Available via `/status/:taskId` and `/progress` endpoints
9. **Chat intent detection** — keyword + file type analysis routes messages to agent patterns: bug-report, implementation, implementation-with-spec, review, bugfix, design, documentation, research, general
10. **CHAT_WORKING_DIR** — Chat agents use `CHAT_WORKING_DIR` env var (falls back to `WORKSPACE`) so they can operate on project source outside the bridge-data directory

## Working with the Code

### Adding a new endpoint

1. Create `src/routes/your-route.mjs` — export a Router
2. Import and `app.use()` it in `server.mjs`

### Modifying queue behavior

All queue logic is in `src/queue.mjs`. The `executeJob()` function handles the full lifecycle: save task → save context → run claude → save result → update job state → persist to SQLite.

### Modifying how Claude is invoked

Edit `src/claude-runner.mjs`. The `runClaude()` function builds the args array and spawns the process. Context is injected via XML-delimited path in the prompt: `<context-file>path</context-file>`.

### Modifying the database schema

Edit `createTables()` in `src/db.mjs`. Tables use `CREATE TABLE IF NOT EXISTS` so new columns require migration logic or a fresh DB.

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
| `WORKSPACE` | `./bridge-data` | Root directory for all files and SQLite DB |
| `CLAUDE_PATH` | `claude` | Path to claude CLI binary |
| `LOG_LEVEL` | `info` | debug, info, warn, error |
| `DEFAULT_ALLOWED_TOOLS` | _(none)_ | Default tools for all tasks (comma-separated or `all`) |
| `DEFAULT_MAX_TURNS` | `0` | Default max agentic turns (0 = unlimited) |
| `MAX_QUEUE_SIZE` | `1000` | Max jobs in queue |
| `JOB_TTL_MS` | `3600000` | Job time-to-live in memory (1 hour) |
| `CHAT_WORKING_DIR` | _(WORKSPACE)_ | Working directory for Chat Commander agents (allows operating outside workspace) |
| `SUMMARY_ENABLED` | `true` | Enable/disable conversation memory summarization |
| `SUMMARY_MAX_CHARS` | `6000` | Max summary size in characters |
| `SUMMARY_MAX_TURN_CHARS` | `3000` | Max per-agent output fed to summarizer |

## Data Directory Layout

```
bridge-data/
├── bridge.db        # SQLite database (conversations, messages, jobs, agent_stats, uploaded_files)
├── tasks/           # Saved prompts (task-{id}.md)
├── results/         # Claude output (result-{id}.md)
├── contexts/        # Temp context files (context-{id}.md)
├── summaries/       # Conversation summaries (summary-{convId}.md)
├── shared/          # Shared documents between agents
├── uploads/         # Files uploaded via Chat Commander
└── conversations/   # Legacy JSON conversation files (migrated to SQLite on startup)
```

## Chat Commander

Accessible at `/chat`. A conversational interface that auto-routes requests to specialized agent teams.

- **Intent detection** — analyzes message keywords and attached files to select an agent pattern (bug-report, implementation-with-spec, implementation, review, bugfix, design, documentation, research, general)
- **Agent routing** — spawns single agents, sequential chains, or parallel teams based on intent
- **File upload** — supports images, docs, code files (50MB max per file, 10 files max, filtered by extension whitelist)
- **Conversation history** — persisted in SQLite (conversations + messages tables)
- **Real-time updates** — SSE stream per conversation for live agent status and messages
- **Image analysis** — if images are attached with a bug report, an image-analyzer agent runs first
- **Agent roles** — built-in role prompts for: architect, frontend-engineer, backend-engineer, integration-engineer, senior-engineer, investigator, qa-reviewer, security-auditor, tech-lead, ui-architect, researcher, documentation-agent, general-agent, image-analyzer, summarizer
- **Conversation memory** — after all agents complete a turn, a `summarizer` agent generates a compact summary of the conversation (what was asked, what was done, files changed, decisions, current state). When a follow-up message is sent in an existing conversation, the summary is loaded and injected into every agent's prompt so they understand the prior context. Summaries stored in SQLite + Markdown files

## Workflow Rules — ALWAYS FOLLOW

When the user asks to implement, fix, review, or improve anything in this project:

1. **ALWAYS use the bridge** — Submit tasks to `http://localhost:3210` via the API. NEVER implement directly yourself.
2. **Check bridge is running first** — `curl -s http://localhost:3210/health`. If down, start it: `./start.sh --background`
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
Chain: architect → frontend-engineer → integration-engineer → code-reviewer
```

**Implementation with Spec:**
```
Chain: architect → backend-engineer → frontend-engineer → qa-reviewer → code-reviewer
```

**Bug Fix:**
```
Chain: investigator → senior-engineer → qa-reviewer → code-reviewer
```

**Bug Report (with screenshot):**
```
Chain: image-analyzer → investigator → senior-engineer → qa-reviewer → code-reviewer
```

### PR-Based Code Review Workflow

Engineers automatically create feature branches, commit changes, push, and create PRs via `gh pr create`. The `code-reviewer` agent reviews the PR diff and either approves+merges or requests changes. **NEVER** add `Co-Authored-By` or any AI signature to commit messages.

**Visual/Animation Work:**
```
Parallel: character-animator + desk-artist + environment-engineer + interaction-designer
```

## Common Issues

- **Port already in use**: `lsof -ti:3210 | xargs kill -9`
- **Claude CLI not found**: ensure `claude` is in PATH or set `CLAUDE_PATH`
- **Nested session error**: the runner deletes `CLAUDECODE` env var to prevent this — don't revert that
- **`--no-input` flag**: doesn't exist in Claude CLI, use `--no-session-persistence` instead
- **SQLite locked**: ensure only one server instance is running per workspace
