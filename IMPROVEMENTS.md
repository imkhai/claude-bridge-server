# Claude Bridge Server — Improvement Plan

**Date:** 2026-04-07
**Author:** Senior Staff Engineer Review
**Based on:** SECURITY_AUDIT.md findings + code quality review of all source files

---

## Overview

This plan addresses 14 security findings (3 critical, 4 high, 4 medium, 3 low), plus additional code quality and reliability improvements discovered during review. Fixes are grouped into three phases by priority and dependency.

**Estimated total effort:** ~3-4 days for a single engineer

---

## Phase 1 — Critical & Quick Wins (Day 1-2)

These fixes neutralize the most dangerous attack vectors and are low-effort.

---

### 1.1 Add Authentication Middleware (C1)

**Severity:** CRITICAL | **Effort:** Easy | **Impact:** Blocks all unauthenticated access

**File:** `src/config.mjs`

```js
// BEFORE
export const config = {
  BRIDGE_PORT: parseInt(process.env.BRIDGE_PORT, 10) || 3210,
  // ...
};

// AFTER — add API_KEY and BIND_HOST
export const config = {
  BRIDGE_PORT: parseInt(process.env.BRIDGE_PORT, 10) || 3210,
  BIND_HOST: process.env.BIND_HOST || '127.0.0.1',
  API_KEY: process.env.API_KEY || '',
  // ... rest unchanged
};
```

**File:** Create `src/middleware/auth.mjs`

```js
import { config } from '../config.mjs';
import { logger } from '../utils/logger.mjs';

export function authMiddleware(req, res, next) {
  // Skip auth for health checks
  if (req.path === '/health') return next();

  // If no API_KEY configured, allow all (local dev mode)
  if (!config.API_KEY) return next();

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== config.API_KEY) {
    logger.warn(`Unauthorized request to ${req.method} ${req.path} from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
```

**File:** `server.mjs`

```js
// BEFORE
app.use(express.json({ limit: '10mb' }));
app.use(askRouter);

// AFTER — add auth middleware before routes
import { authMiddleware } from './src/middleware/auth.mjs';

app.use(express.json({ limit: '2mb' }));  // M2: also reduce body limit
app.use(authMiddleware);
app.use(askRouter);
```

**File:** `server.mjs` — bind to localhost by default

```js
// BEFORE
app.listen(config.BRIDGE_PORT, () => {

// AFTER
app.listen(config.BRIDGE_PORT, config.BIND_HOST, () => {
  logger.info(`  Bind Host:    ${config.BIND_HOST}`);
```

---

### 1.2 Validate `workingDir` — Prevent Filesystem Escape (C2)

**Severity:** CRITICAL | **Effort:** Easy | **Impact:** Prevents arbitrary filesystem access

**File:** Create `src/utils/validators.mjs`

```js
import { resolve, relative } from 'path';
import { config } from '../config.mjs';

/**
 * Validates that a path is within the configured workspace.
 * Returns the resolved absolute path, or throws if outside workspace.
 */
export function validatePathWithinWorkspace(inputPath, label = 'path') {
  if (!inputPath) return null;

  const resolved = resolve(inputPath);
  const workspaceResolved = resolve(config.WORKSPACE);
  const rel = relative(workspaceResolved, resolved);

  if (rel.startsWith('..') || resolve(workspaceResolved, rel) !== resolved) {
    throw new Error(`${label} must be within workspace directory`);
  }

  return resolved;
}

/**
 * Validates workingDir: must be within workspace, defaults to workspace.
 */
export function validateWorkingDir(workingDir) {
  if (!workingDir) return config.WORKSPACE;
  return validatePathWithinWorkspace(workingDir, 'workingDir');
}

/**
 * Validates contextFile: must be within workspace.
 */
export function validateContextFile(contextFile) {
  if (!contextFile) return null;
  return validatePathWithinWorkspace(contextFile, 'contextFile');
}

/**
 * Validates allowedTools against the server's DEFAULT_ALLOWED_TOOLS whitelist.
 * If DEFAULT_ALLOWED_TOOLS is configured, per-task tools must be a subset.
 */
export function validateAllowedTools(requestedTools) {
  if (!requestedTools) return null;
  if (!Array.isArray(requestedTools)) {
    throw new Error('allowedTools must be an array');
  }

  // Validate each item is a non-empty string
  for (const tool of requestedTools) {
    if (typeof tool !== 'string' || tool.trim().length === 0) {
      throw new Error('Each allowedTools entry must be a non-empty string');
    }
  }

  // If server has a default allowlist, enforce it as a ceiling
  if (config.DEFAULT_ALLOWED_TOOLS) {
    const serverAllowed = new Set(
      config.DEFAULT_ALLOWED_TOOLS.split(',').map(t => t.trim()).filter(Boolean)
    );
    const denied = requestedTools.filter(t => !serverAllowed.has(t));
    if (denied.length > 0) {
      throw new Error(`Tools not permitted by server policy: ${denied.join(', ')}`);
    }
  }

  return requestedTools;
}

/**
 * Validates and sanitizes common input fields.
 */
export function validateInputFields({ agentId, maxTurns, prompt, context }) {
  const errors = [];

  if (agentId !== undefined) {
    if (typeof agentId !== 'string' || agentId.length > 100) {
      errors.push('agentId must be a string of max 100 characters');
    }
    // Strip control characters to prevent log injection
    if (typeof agentId === 'string' && /[\x00-\x1f\x7f]/.test(agentId)) {
      errors.push('agentId must not contain control characters');
    }
  }

  if (maxTurns !== undefined && maxTurns !== null) {
    const n = Number(maxTurns);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      errors.push('maxTurns must be an integer between 1 and 100');
    }
  }

  if (prompt !== undefined) {
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      errors.push('prompt must be a non-empty string');
    }
    if (typeof prompt === 'string' && prompt.length > 100_000) {
      errors.push('prompt must be under 100,000 characters');
    }
  }

  if (context !== undefined && context !== null) {
    if (typeof context !== 'string') {
      errors.push('context must be a string');
    }
    if (typeof context === 'string' && context.length > 500_000) {
      errors.push('context must be under 500,000 characters');
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
}
```

---

### 1.3 Apply Validation in Routes (C2, C3, H1, M1)

**File:** `src/routes/ask.mjs`

```js
// BEFORE
import { Router } from 'express';
import { queue } from '../queue.mjs';

export const askRouter = Router();

askRouter.post('/ask', async (req, res, next) => {
  try {
    const { prompt, agentId, context, contextFile, workingDir, allowedTools, disallowedTools, maxTurns } = req.body;

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required and must be a string' });
    }

    const result = queue.submit({ prompt, agentId, context, contextFile, workingDir, allowedTools, disallowedTools, maxTurns });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// AFTER
import { Router } from 'express';
import { queue } from '../queue.mjs';
import {
  validateWorkingDir,
  validateContextFile,
  validateAllowedTools,
  validateInputFields,
} from '../utils/validators.mjs';

export const askRouter = Router();

function validateAskBody(body) {
  const { prompt, agentId, context, contextFile, workingDir, allowedTools, disallowedTools, maxTurns } = body;

  validateInputFields({ agentId, maxTurns, prompt, context });

  return {
    prompt: prompt.trim(),
    agentId,
    context,
    contextFile: validateContextFile(contextFile),
    workingDir: validateWorkingDir(workingDir),
    allowedTools: validateAllowedTools(allowedTools),
    disallowedTools: Array.isArray(disallowedTools) ? disallowedTools : null,
    maxTurns,
  };
}

askRouter.post('/ask', async (req, res, next) => {
  try {
    const params = validateAskBody(req.body);
    const result = queue.submit(params);
    res.json(result);
  } catch (err) {
    if (err.message.includes('must be') || err.message.includes('not permitted')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

askRouter.post('/ask/sync', async (req, res, next) => {
  try {
    const params = validateAskBody(req.body);
    const job = await queue.submitAndWait(params);

    res.json({
      taskId: job.taskId,
      agentId: job.agentId,
      status: job.status,
      result: job.result,
      error: job.error || null,
      resultFile: job.resultFile,
      duration: job.duration,
    });
  } catch (err) {
    if (err.message.includes('must be') || err.message.includes('not permitted')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});
```

**File:** `src/routes/chain.mjs` — add validation for each step

```js
// BEFORE (line 22-34 — steps mapping)
steps: steps.map((s, i) => ({
  step: i + 1,
  prompt: s.prompt,
  agentId: s.agentId || 'unknown',
  // ...

// AFTER — validate each step before creating chain
// Add at the top of the POST handler, after the array check:
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  if (!s.prompt || typeof s.prompt !== 'string' || s.prompt.trim().length === 0) {
    return res.status(400).json({ error: `Step ${i + 1}: prompt is required` });
  }
  try {
    validateInputFields({ agentId: s.agentId, maxTurns: s.maxTurns, prompt: s.prompt });
    validateWorkingDir(s.workingDir);
    validateAllowedTools(s.allowedTools);
  } catch (err) {
    return res.status(400).json({ error: `Step ${i + 1}: ${err.message}` });
  }
}
```

---

### 1.4 Fix `allowedTools` Override Bypass (H1)

**Severity:** HIGH | **Effort:** Easy | **Impact:** Prevents privilege escalation

Already handled by `validateAllowedTools()` in section 1.3 above. The validation enforces that per-task `allowedTools` must be a subset of `DEFAULT_ALLOWED_TOOLS` when the server has one configured.

**File:** `src/claude-runner.mjs` — no change needed to the runner itself; the validation happens before the job reaches the queue.

---

### 1.5 Sanitize Error Responses (H4)

**Severity:** HIGH | **Effort:** Easy | **Impact:** Prevents information leakage

**File:** `server.mjs`

```js
// BEFORE
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// AFTER — never expose internal error details
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});
```

**File:** `src/routes/health.mjs`

```js
// BEFORE
res.json({
  ok: true,
  uptime: stats.uptime,
  active: stats.active,
  maxParallel: stats.maxParallel,
  queued: stats.queued,
  totalProcessed: stats.totalProcessed,
  workspace: config.WORKSPACE,   // <-- leaks internal path
});

// AFTER — remove workspace path
res.json({
  ok: true,
  uptime: stats.uptime,
  active: stats.active,
  maxParallel: stats.maxParallel,
  queued: stats.queued,
  totalProcessed: stats.totalProcessed,
});
```

**File:** `src/routes/jobs.mjs` — remove full prompt from list view

```js
// BEFORE
const jobs = allJobs.map((j) => ({
  taskId: j.taskId,
  agentId: j.agentId,
  status: j.status,
  prompt: j.prompt,           // <-- leaks full prompt in list
  createdAt: j.createdAt,
  // ...

// AFTER — truncate prompt in list, remove resultFile path
const jobs = allJobs.map((j) => ({
  taskId: j.taskId,
  agentId: j.agentId,
  status: j.status,
  prompt: j.prompt?.slice(0, 100) + (j.prompt?.length > 100 ? '...' : ''),
  createdAt: j.createdAt,
  startedAt: j.startedAt,
  finishedAt: j.finishedAt,
  duration: j.duration,
}));
```

---

### 1.6 Reduce JSON Body Limit (M2)

**Severity:** MEDIUM | **Effort:** Easy | **Impact:** Reduces DoS surface

Already shown in section 1.1 — change `server.mjs` from `10mb` to `2mb`.

---

### 1.7 Docker: Run as Non-Root (Docker finding)

**Severity:** MEDIUM | **Effort:** Easy | **Impact:** Limits container escape damage

**File:** `Dockerfile`

```dockerfile
# BEFORE
COPY src/ ./src/
RUN mkdir -p workspace
EXPOSE 3210
CMD ["node", "server.mjs"]

# AFTER — add non-root user
COPY src/ ./src/
RUN mkdir -p workspace && \
    addgroup --system appgroup && \
    adduser --system --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app
USER appuser
EXPOSE 3210
CMD ["node", "server.mjs"]
```

**File:** `docker-compose.yml` — bind to localhost

```yaml
# BEFORE
ports:
  - "3210:3210"

# AFTER
ports:
  - "127.0.0.1:3210:3210"
```

---

## Phase 2 — Important Hardening (Day 2-3)

These fixes address DoS resilience, prompt injection, race conditions, and observability.

---

### 2.1 Queue Limits + Job Eviction (H2)

**Severity:** HIGH | **Effort:** Medium | **Impact:** Prevents memory exhaustion DoS

**File:** `src/config.mjs` — add new config options

```js
// Add to config object:
MAX_QUEUE_SIZE: parseInt(process.env.MAX_QUEUE_SIZE, 10) || 1000,
JOB_TTL_MS: parseInt(process.env.JOB_TTL_MS, 10) || 3600000, // 1 hour
```

**File:** `src/queue.mjs` — add queue depth check and eviction

```js
// BEFORE — createJob (line 13-38)
function createJob(params) {
  const taskId = crypto.randomUUID().slice(0, 8);
  // ...
  jobs.set(taskId, job);
  return job;
}

// AFTER — add queue limit check in submit methods
// In queue.submit():
submit(params) {
  if (jobs.size >= config.MAX_QUEUE_SIZE) {
    throw new Error('Queue full');
  }
  evictStaleJobs();
  const job = createJob(params);
  // ... rest unchanged
},

// In queue.submitAndWait():
submitAndWait(params) {
  if (jobs.size >= config.MAX_QUEUE_SIZE) {
    throw new Error('Queue full');
  }
  evictStaleJobs();
  const job = createJob(params);
  // ... rest unchanged
},
```

Add eviction function:

```js
function evictStaleJobs() {
  const now = Date.now();
  for (const [taskId, job] of jobs) {
    if (job.status === 'done' || job.status === 'error' || job.status === 'timeout' || job.status === 'cancelled') {
      const finishedMs = job.finishedAt ? new Date(job.finishedAt).getTime() : 0;
      if (now - finishedMs > config.JOB_TTL_MS) {
        jobs.delete(taskId);
      }
    }
  }
}
```

**File:** `src/routes/ask.mjs` — handle queue-full error

```js
// In the catch block, add:
if (err.message === 'Queue full') {
  return res.status(429).json({ error: 'Queue full, try again later' });
}
```

---

### 2.2 Fix Prompt Injection via contextFile (H3)

**Severity:** HIGH | **Effort:** Medium | **Impact:** Prevents prompt manipulation

The contextFile path is already validated to be within workspace (Phase 1). The remaining issue is that the path is interpolated into the prompt string, allowing crafted filenames to inject instructions.

**File:** `src/claude-runner.mjs`

```js
// BEFORE (line 36-39)
let fullPrompt = prompt;
if (contextFile) {
  fullPrompt = `Read the file at ${contextFile} for context. Then: ${prompt}`;
}

// AFTER — use clear delimiters and sanitize the path string
let fullPrompt = prompt;
if (contextFile) {
  // Ensure contextFile contains only valid path characters (already validated to be in workspace)
  const safePath = contextFile.replace(/[^a-zA-Z0-9\-_./]/g, '_');
  fullPrompt = `<context-file>${safePath}</context-file>\nRead the above file for context, then complete this task:\n${prompt}`;
}
```

> **Note:** The path validation in Phase 1 already prevents reading arbitrary files. This additional sanitization prevents the filename itself from containing prompt injection text.

---

### 2.3 Fix Race Condition in Job Cancellation (M4)

**Severity:** MEDIUM | **Effort:** Medium | **Impact:** Prevents activeCount going negative

**File:** `src/queue.mjs`

```js
// BEFORE — executeJob finally block (line 86-89)
} finally {
  activeCount--;
  processQueue();
}

// AFTER — guard against double-decrement for cancelled jobs
} finally {
  if (job.status !== 'cancelled') {
    // Normal completion — decrement here
    activeCount--;
  }
  // For cancelled jobs, activeCount is decremented in cancelJob()
  processQueue();
}
```

```js
// BEFORE — cancelJob running branch (line 163-169)
if (job.status === 'running') {
  cancelProcess(taskId);
  job.status = 'cancelled';
  job.finishedAt = new Date().toISOString();
  if (job._resolve) job._resolve(job);
  logger.info(`CANCELLED (was running)`, { taskId, agentId: job.agentId });
  return job;
}

// AFTER — decrement activeCount when cancelling a running job
if (job.status === 'running') {
  cancelProcess(taskId);
  job.status = 'cancelled';
  job.finishedAt = new Date().toISOString();
  activeCount--;
  if (job._resolve) job._resolve(job);
  logger.info(`CANCELLED (was running)`, { taskId, agentId: job.agentId });
  processQueue();  // Allow next queued job to start
  return job;
}
```

---

### 2.4 Increase Task ID Length (L1)

**Severity:** LOW | **Effort:** Easy | **Impact:** Eliminates collision risk

**File:** `src/queue.mjs`

```js
// BEFORE (line 14)
const taskId = crypto.randomUUID().slice(0, 8);

// AFTER — use full UUID
const taskId = crypto.randomUUID();
```

**File:** `src/routes/chain.mjs`

```js
// BEFORE (line 16)
const chainId = 'chain-' + crypto.randomUUID().slice(0, 6);

// AFTER
const chainId = 'chain-' + crypto.randomUUID();
```

---

### 2.5 Add Request Logging Middleware (L2)

**Severity:** LOW | **Effort:** Easy | **Impact:** Enables audit trail and abuse detection

**File:** Create `src/middleware/request-logger.mjs`

```js
import { logger } from '../utils/logger.mjs';

export function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const line = `${req.method} ${req.path} ${res.statusCode} ${duration}ms`;
    if (res.statusCode >= 400) {
      logger.warn(line, { ip: req.ip });
    } else {
      logger.debug(line, { ip: req.ip });
    }
  });

  next();
}
```

**File:** `server.mjs` — add before auth middleware

```js
import { requestLogger } from './src/middleware/request-logger.mjs';

app.use(requestLogger);
app.use(authMiddleware);
```

---

### 2.6 Validate `CLAUDE_PATH` at Startup (M3)

**Severity:** MEDIUM | **Effort:** Easy | **Impact:** Prevents arbitrary binary execution

**File:** `src/claude-runner.mjs` — enhance `checkClaudeCli()`

```js
// BEFORE — checkClaudeCli just runs --version
export async function checkClaudeCli() {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const proc = spawn(config.CLAUDE_PATH, ['--version'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    // ...

// AFTER — also validate the resolved path
import { accessSync, constants } from 'fs';
import { resolve as resolvePath } from 'path';

export async function checkClaudeCli() {
  // Validate CLAUDE_PATH doesn't contain suspicious characters
  if (/[;&|`$]/.test(config.CLAUDE_PATH)) {
    logger.error(`CLAUDE_PATH contains suspicious characters: ${config.CLAUDE_PATH}`);
    return false;
  }

  return new Promise((resolve) => {
    // ... existing --version check unchanged
  });
}
```

---

## Phase 3 — Hardening & Reliability (Day 3-4)

Lower-priority improvements for production readiness.

---

### 3.1 Graceful Shutdown: Reject New Requests (L3)

**Severity:** LOW | **Effort:** Easy | **Impact:** Clean shutdown behavior

**File:** `server.mjs`

```js
// Add a shutdown flag
let shuttingDown = false;

// Add middleware after auth
app.use((req, res, next) => {
  if (shuttingDown && req.path !== '/health') {
    return res.status(503).json({ error: 'Server is shutting down' });
  }
  next();
});

// Update signal handlers
process.on('SIGINT', async () => {
  logger.info('Received SIGINT — starting graceful shutdown');
  shuttingDown = true;
  await queue.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM — starting graceful shutdown');
  shuttingDown = true;
  await queue.shutdown();
  process.exit(0);
});
```

---

### 3.2 Chain Map Eviction

**Severity:** LOW | **Effort:** Easy | **Impact:** Prevents unbounded memory growth in chains

The `chains` Map in `src/routes/chain.mjs` has the same unbounded growth problem as the jobs Map.

**File:** `src/routes/chain.mjs`

```js
// Add eviction at the start of POST /chain handler, before creating new chain:
const MAX_CHAINS = 500;
if (chains.size >= MAX_CHAINS) {
  // Evict completed chains older than 1 hour
  const now = Date.now();
  for (const [id, chain] of chains) {
    if (chain.status === 'done' || chain.status === 'error') {
      chains.delete(id);
    }
  }
  if (chains.size >= MAX_CHAINS) {
    return res.status(429).json({ error: 'Too many chains, try again later' });
  }
}
```

---

### 3.3 Remove `tokensEstimate: null` Dead Field

**Severity:** N/A (code quality) | **Effort:** Trivial | **Impact:** Cleaner API response

**File:** `src/routes/ask.mjs`

```js
// BEFORE (in /ask/sync response)
res.json({
  taskId: job.taskId,
  agentId: job.agentId,
  status: job.status,
  result: job.result,
  error: job.error || null,
  resultFile: job.resultFile,
  duration: job.duration,
  tokensEstimate: null,   // <-- always null, never populated
});

// AFTER — remove dead field
res.json({
  taskId: job.taskId,
  agentId: job.agentId,
  status: job.status,
  result: job.result,
  error: job.error || null,
  resultFile: job.resultFile,
  duration: job.duration,
});
```

---

### 3.4 Improve Error Object Shape in claude-runner.mjs

**Severity:** N/A (code quality) | **Effort:** Easy | **Impact:** Proper Error objects for better stack traces

**File:** `src/claude-runner.mjs`

```js
// BEFORE — rejects with plain objects (lines 112-116)
reject({ type: 'timeout', message: `Process timed out after ${config.TIMEOUT_MS}ms`, exitCode: code, stderr });

// AFTER — reject with proper Error objects
class ClaudeProcessError extends Error {
  constructor(type, message, exitCode, stderr) {
    super(message);
    this.type = type;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

// Then in the close handler:
reject(new ClaudeProcessError('timeout', `Process timed out after ${config.TIMEOUT_MS}ms`, code, stderr));
reject(new ClaudeProcessError('error', `Process exited with code ${code}`, code, stderr));
```

---

### 3.5 Add `_resolve` Cleanup to Prevent Memory Leaks

**Severity:** N/A (reliability) | **Effort:** Trivial | **Impact:** Prevents function reference retention

**File:** `src/queue.mjs` — in `executeJob`, after resolving:

```js
// BEFORE
if (job._resolve) job._resolve(job);

// AFTER — null out the reference to allow GC
if (job._resolve) {
  job._resolve(job);
  job._resolve = null;
}
```

Apply this in all 4 places where `_resolve` is called (executeJob success, executeJob error, cancelJob queued, cancelJob running).

---

## Summary Table

| # | Finding | Phase | Effort | Files Changed |
|---|---------|-------|--------|---------------|
| 1.1 | C1 — Authentication | 1 | Easy | `config.mjs`, `server.mjs`, new `middleware/auth.mjs` |
| 1.2 | C2 — workingDir validation | 1 | Easy | new `utils/validators.mjs` |
| 1.3 | C3, M1 — contextFile + input validation | 1 | Easy | `routes/ask.mjs`, `routes/chain.mjs` |
| 1.4 | H1 — allowedTools restriction | 1 | Easy | `utils/validators.mjs` (included in 1.2) |
| 1.5 | H4 — Info leak sanitization | 1 | Easy | `server.mjs`, `routes/health.mjs`, `routes/jobs.mjs` |
| 1.6 | M2 — Body limit reduction | 1 | Easy | `server.mjs` |
| 1.7 | Docker hardening | 1 | Easy | `Dockerfile`, `docker-compose.yml` |
| 2.1 | H2 — Queue limits + eviction | 2 | Medium | `config.mjs`, `queue.mjs`, `routes/ask.mjs` |
| 2.2 | H3 — Prompt injection fix | 2 | Medium | `claude-runner.mjs` |
| 2.3 | M4 — Cancellation race condition | 2 | Medium | `queue.mjs` |
| 2.4 | L1 — Task ID length | 2 | Easy | `queue.mjs`, `routes/chain.mjs` |
| 2.5 | L2 — Request logging | 2 | Easy | new `middleware/request-logger.mjs`, `server.mjs` |
| 2.6 | M3 — CLAUDE_PATH validation | 2 | Easy | `claude-runner.mjs` |
| 3.1 | L3 — Graceful shutdown | 3 | Easy | `server.mjs` |
| 3.2 | Chain map eviction | 3 | Easy | `routes/chain.mjs` |
| 3.3 | Dead field cleanup | 3 | Trivial | `routes/ask.mjs` |
| 3.4 | Error object shape | 3 | Easy | `claude-runner.mjs` |
| 3.5 | _resolve cleanup | 3 | Trivial | `queue.mjs` |

---

## New Files to Create

1. `src/middleware/auth.mjs` — API key authentication middleware
2. `src/middleware/request-logger.mjs` — HTTP request audit logging
3. `src/utils/validators.mjs` — Input validation and path sandboxing

## New Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | `''` (disabled) | Bearer token for API authentication |
| `BIND_HOST` | `127.0.0.1` | Interface to bind to (use `0.0.0.0` to expose) |
| `MAX_QUEUE_SIZE` | `1000` | Maximum total jobs in memory |
| `JOB_TTL_MS` | `3600000` | Auto-evict completed jobs after this duration |
