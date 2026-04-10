# SRD: Conversation Memory

**Feature:** Persistent conversation memory for stateless Claude agents
**Status:** Draft
**Date:** 2026-04-10

---

## 1. Feature Overview

### Problem

Every agent in Claude Bridge Server is spawned with `claude -p --no-session-persistence`. Agents have zero memory of prior conversation turns. When a user sends a follow-up message in an existing conversation, each agent starts from scratch with no knowledge of what was previously discussed, decided, or implemented.

### Solution

After all agents in a conversation turn complete, spawn a lightweight **summarizer agent** (`claude -p`) that reads all agent outputs from that turn and generates a compact, structured summary. This summary is persisted both as a Markdown file and in SQLite. When a new message arrives in an existing conversation, the summary is loaded and injected as context into every agent's prompt, giving them awareness of prior work.

### Design Principles

- **Incremental**: Each turn appends to and re-summarizes (not replaces) the conversation history
- **Compact**: Summaries are token-budgeted to stay under ~2000 tokens so they don't eat into agent context
- **Structured**: Fixed Markdown schema so agents can reliably parse the context
- **Evolvable**: Data model supports future migration to vector-indexed memory, per-agent memory, and cross-conversation knowledge

---

## 2. Data Model

### 2.1 SQLite Table: `conversation_summaries`

Add to `src/db.mjs` inside `createTables()`:

```sql
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id TEXT PRIMARY KEY,                    -- summary-{uuid}
  conversation_id TEXT NOT NULL UNIQUE,   -- one active summary per conversation
  turn_number INTEGER NOT NULL DEFAULT 1, -- which conversation turn this covers through
  summary_text TEXT NOT NULL,             -- the markdown summary content
  metadata TEXT,                          -- JSON: { agentIds, filesChanged, tokensUsed, generationDurationMs }
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_summaries_conversation ON conversation_summaries(conversation_id);
```

**Column details:**

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | `summary-{uuid12}` |
| `conversation_id` | TEXT UNIQUE | FK to `conversations.id`. One active summary per conversation. |
| `turn_number` | INTEGER | How many user→agent rounds this summary covers. Increments each turn. |
| `summary_text` | TEXT | The Markdown summary (see format below). Max ~4000 chars. |
| `metadata` | TEXT (JSON) | `{ agentIds: string[], filesChanged: string[], decisionsMade: string[], tokensEstimate: number, generationDurationMs: number }` |
| `created_at` | TEXT | ISO timestamp of first creation |
| `updated_at` | TEXT | ISO timestamp of last update |

### 2.2 File Storage

Path: `~/prod-data/bridge-data/summaries/summary-{conversationId}.md`

Add `'summaries'` to the `DIRS` array in `src/utils/file-manager.mjs`.

File contents mirror `summary_text` from the database. The file serves as:
- Human-readable audit trail
- Direct input to the summarizer agent (it reads its own prior summary to produce the next one)
- Backup if DB is unavailable

### 2.3 Summary Markdown Format

```markdown
# Conversation Summary
**Conversation:** {conversationId}
**Turn:** {turnNumber}
**Updated:** {isoTimestamp}

## What Was Asked
- Turn 1: {user's original request, 1-2 sentences}
- Turn 2: {user's follow-up, 1-2 sentences}

## What Was Done
- {agent} analyzed {what} and found {key finding}
- {agent} implemented {what} in {files}
- {agent} reviewed and approved / requested changes to {what}

## Key Decisions
- Chose {approach A} over {approach B} because {reason}
- {architectural/design decision}

## Files Changed
- `src/foo/bar.mjs` — {what changed}
- `src/baz/qux.mjs` — {what changed}

## Current State
{1-3 sentences: what's done, what's pending, any blockers}

## Open Items
- {anything unresolved or flagged for follow-up}
```

---

## 3. Summary Generation Strategy

### 3.1 When to Generate

Trigger summary generation **after all agents in a conversation turn complete** — specifically, at the end of `spawnAgents()` in `src/routes/chat-api.mjs`, right before the `pushSSE(conv.id, 'complete', ...)` call.

### 3.2 Summarizer Agent

Spawn a dedicated summarizer via the existing queue infrastructure:

```javascript
// In src/summarizer.mjs (new file)

import { queue } from './queue.mjs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.mjs';
import * as db from './db.mjs';
import { logger } from './utils/logger.mjs';

const SUMMARIES_DIR = join(config.WORKSPACE, 'summaries');

export async function generateSummary(conversationId, turnMessages, turnNumber) {
  const summaryPath = join(SUMMARIES_DIR, `summary-${conversationId}.md`);

  // Load existing summary if this is a follow-up turn
  let existingSummary = '';
  try {
    existingSummary = await readFile(summaryPath, 'utf-8');
  } catch {
    // No prior summary — first turn
  }

  // Build the input for the summarizer
  const turnContent = turnMessages.map(msg => {
    if (msg.role === 'user') return `**User:** ${msg.content}`;
    if (msg.role === 'agent') return `**Agent (${msg.agentId}):** ${msg.content.slice(0, 3000)}`;
    if (msg.role === 'system') return `**System:** ${msg.content}`;
    return '';
  }).join('\n\n---\n\n');

  const prompt = buildSummarizerPrompt(conversationId, turnNumber, existingSummary, turnContent);

  const startMs = Date.now();

  try {
    const job = await queue.submitAndWait({
      prompt,
      agentId: 'summarizer',
      workingDir: config.WORKSPACE,
      allowedTools: [],   // summarizer needs NO tools — pure text generation
      maxTurns: 1,        // single-turn, no tool use
    });

    const duration = Date.now() - startMs;

    if (job.status === 'done' && job.result) {
      const summaryText = job.result.trim();

      // Write to file
      await writeFile(summaryPath, summaryText, 'utf-8');

      // Upsert to SQLite
      db.upsertSummary({
        conversationId,
        turnNumber,
        summaryText,
        metadata: {
          agentIds: turnMessages.filter(m => m.role === 'agent').map(m => m.agentId),
          generationDurationMs: duration,
          tokensEstimate: Math.ceil(summaryText.length / 4),
        },
      });

      logger.info(`Summary generated for ${conversationId} (turn ${turnNumber}, ${summaryText.length} chars, ${duration}ms)`);
      return summaryText;
    } else {
      logger.error(`Summarizer failed for ${conversationId}: ${job.error}`);
      return null;
    }
  } catch (err) {
    logger.error(`Summary generation error for ${conversationId}: ${err.message}`);
    return null;
  }
}

function buildSummarizerPrompt(conversationId, turnNumber, existingSummary, turnContent) {
  let prompt = `You are a conversation summarizer for a multi-agent coding system. Your job is to produce a concise, structured summary that will be injected as context for future agents working on this conversation.

## Rules
- Output ONLY the summary in the exact Markdown format below — no preamble, no explanation
- Keep the entire summary under 2000 tokens (~1500 words / ~6000 characters)
- Be specific: include file paths, function names, error messages, PR numbers
- Compress older turns more aggressively than recent ones
- Preserve all key decisions and their rationale
- Track what's done vs. what's still pending

## Output Format

# Conversation Summary
**Conversation:** ${conversationId}
**Turn:** ${turnNumber}
**Updated:** {current ISO timestamp}

## What Was Asked
{bullet per turn, 1-2 sentences each}

## What Was Done
{bullet per significant action, be specific}

## Key Decisions
{bullet per decision with rationale}

## Files Changed
{bullet per file with what changed}

## Current State
{1-3 sentences}

## Open Items
{bullets for anything unresolved}
`;

  if (existingSummary) {
    prompt += `\n\n## Previous Summary (turns 1-${turnNumber - 1})\n\n${existingSummary}`;
  }

  prompt += `\n\n## New Turn ${turnNumber} Content\n\n${turnContent}`;

  return prompt;
}

export async function loadSummary(conversationId) {
  // Try SQLite first (faster)
  const row = db.getSummary(conversationId);
  if (row) return row.summaryText;

  // Fall back to file
  try {
    const summaryPath = join(SUMMARIES_DIR, `summary-${conversationId}.md`);
    return await readFile(summaryPath, 'utf-8');
  } catch {
    return null;
  }
}
```

### 3.3 Summarizer Prompt Engineering

The summarizer prompt (shown above) enforces:

1. **Fixed output schema** — agents can reliably find sections by heading
2. **Token budget** — hard cap at ~2000 tokens to leave room for agent prompts
3. **Specificity** — file paths, function names, PR numbers (not vague descriptions)
4. **Compression** — older turns get compressed; recent turn gets full detail
5. **State tracking** — explicit "Current State" and "Open Items" sections

### 3.4 Turn Number Tracking

The `turn_number` is determined by counting user messages in the conversation:

```javascript
const turnNumber = conv.messages.filter(m => m.role === 'user').length;
```

This is computed at summary generation time and stored in both the DB and the summary file header.

### 3.5 Cost Control

The summarizer agent:
- Uses `maxTurns: 1` (no tool loops)
- Uses `allowedTools: []` (no tool access — pure text in, text out)
- Receives truncated agent outputs (`msg.content.slice(0, 3000)` per agent)
- Total input to summarizer is bounded: prior summary (~6KB) + turn content (~15KB max) = ~21KB

Estimated cost per summary: ~$0.01-0.03 depending on turn complexity.

---

## 4. Context Injection Flow

### 4.1 Where to Inject

In `src/routes/chat-api.mjs`, inside the `POST /api/chat/send` handler, after loading the conversation and before spawning agents:

```javascript
// After: const routing = detectIntent(trimmedMessage, files);
// Before: spawnAgents(conv, routing, trimmedMessage, files);

// Load conversation memory for existing conversations
let conversationContext = null;
if (conversationId && conv.messages.length > 0) {
  conversationContext = await loadSummary(conv.id);
}

// Pass to spawnAgents
spawnAgents(conv, routing, trimmedMessage, files, conversationContext).catch(err => {
  // ...existing error handling
});
```

### 4.2 How Agents Receive Context

Modify `buildAgentPrompt()` to accept and inject the summary:

```javascript
function buildAgentPrompt(agentId, userMessage, previousContext, conversationSummary) {
  const role = rolePrompts[agentId] || rolePrompts['general-agent'];
  let prompt = `${role}\n\n`;

  // Inject conversation memory BEFORE the user request
  if (conversationSummary) {
    prompt += `## Conversation History\nThis is a follow-up message in an ongoing conversation. Here is what happened previously:\n\n${conversationSummary}\n\n---\n\n`;
  }

  prompt += `## User Request\n${userMessage}`;

  if (previousContext) {
    prompt += `\n\n## Previous Agent Context\n${previousContext}`;
  }

  return prompt;
}
```

### 4.3 Context Injection Order in Agent Prompt

```
1. Role prompt (who the agent is)
2. Conversation summary (what happened before — if follow-up)
3. User's current message
4. Previous agent's output (if chain method)
```

This ordering ensures agents understand their role first, then the history, then the current task.

### 4.4 Propagation Through Agent Methods

Update all three agent execution paths to pass `conversationContext`:

| Function | Change |
|---|---|
| `spawnAgents()` | Accept `conversationContext` as 5th parameter, pass to `runChainAgents`, `runParallelAgents`, `runSingleAgentFlow` |
| `runChainAgents()` | Accept `conversationContext`, pass to `buildAgentPrompt` |
| `runParallelAgents()` | Accept `conversationContext`, pass to `buildAgentPrompt` |
| `runSingleAgentFlow()` | Accept `conversationContext`, pass to `buildAgentPrompt` |
| `buildAgentPrompt()` | Accept `conversationSummary` as 4th parameter |

---

## 5. API Changes

### 5.1 Modified Endpoints

#### `POST /api/chat/send`

No request/response schema changes. Behavior change:
- On existing conversations (`conversationId` provided), loads summary before spawning agents
- After agents complete, triggers summary generation in background

#### `GET /api/chat/conversations/:id`

Add `summary` field to response:

```json
{
  "id": "conv-abc123",
  "title": "...",
  "messages": [...],
  "summary": {
    "turnNumber": 3,
    "text": "# Conversation Summary\n...",
    "updatedAt": "2026-04-10T12:00:00Z"
  }
}
```

### 5.2 New Endpoints

#### `GET /api/chat/conversations/:id/summary`

Returns the current summary for a conversation.

**Response:**
```json
{
  "conversationId": "conv-abc123",
  "turnNumber": 3,
  "summary": "# Conversation Summary\n...",
  "metadata": {
    "agentIds": ["architect", "frontend-engineer", "code-reviewer"],
    "generationDurationMs": 4200,
    "tokensEstimate": 850
  },
  "updatedAt": "2026-04-10T12:00:00Z"
}
```

**404** if no summary exists yet (conversation has only 1 turn, or summary generation hasn't completed).

#### `POST /api/chat/conversations/:id/summary/regenerate`

Force-regenerates the summary from the full conversation history. Useful if a summary is corrupted or the summarizer prompt is improved.

**Response:**
```json
{
  "conversationId": "conv-abc123",
  "status": "queued",
  "message": "Summary regeneration queued"
}
```

### 5.3 New SSE Events

| Event | Payload | When |
|---|---|---|
| `summary-generating` | `{ conversationId }` | Summarizer agent starts |
| `summary-ready` | `{ conversationId, turnNumber, tokensEstimate }` | Summary saved successfully |
| `summary-error` | `{ conversationId, error }` | Summarizer failed |

---

## 6. Implementation Plan

### Phase 1: Data Layer (src/db.mjs, src/utils/file-manager.mjs)

**File: `src/db.mjs`**

1. Add `CREATE TABLE conversation_summaries` to `createTables()` (after line 88)
2. Add prepared statements and functions:
   - `upsertSummary({ conversationId, turnNumber, summaryText, metadata })` — INSERT ON CONFLICT UPDATE
   - `getSummary(conversationId)` — returns `{ summaryText, turnNumber, metadata, updatedAt }` or null
   - `deleteSummary(conversationId)` — for cleanup when conversation is deleted
3. Update `deleteConversation()` (line 175) to also delete from `conversation_summaries`

**File: `src/utils/file-manager.mjs`**

4. Add `'summaries'` to the `DIRS` array on line 5

### Phase 2: Summarizer Module (new file)

**File: `src/summarizer.mjs`** (new)

Create the module as specified in Section 3.2 above. Functions to export:
- `generateSummary(conversationId, turnMessages, turnNumber)` — generates and persists
- `loadSummary(conversationId)` — loads from DB with file fallback

### Phase 3: Integration into Chat Flow (src/routes/chat-api.mjs)

**File: `src/routes/chat-api.mjs`**

5. Add import at top (after line 10):
   ```javascript
   import { generateSummary, loadSummary } from '../summarizer.mjs';
   ```

6. Modify `spawnAgents()` signature (line 221):
   ```javascript
   async function spawnAgents(conv, routing, userMessage, files, conversationContext = null)
   ```

7. Pass `conversationContext` through to all three agent flow functions:
   - `runChainAgents` (line 273) — add parameter, pass to `buildAgentPrompt`
   - `runParallelAgents` (line 381) — add parameter, pass to `buildAgentPrompt`
   - `runSingleAgentFlow` (line 414) — add parameter, pass to `buildAgentPrompt`

8. Modify `buildAgentPrompt()` (line 435):
   - Add 4th parameter `conversationSummary`
   - Inject between role prompt and user message (see Section 4.2)

9. Add summary generation trigger at end of `spawnAgents()` (before line 282):
   ```javascript
   // Generate summary after all agents complete (fire-and-forget)
   const turnNumber = conv.messages.filter(m => m.role === 'user').length;
   const turnMessages = getTurnMessages(conv, turnNumber);
   generateSummary(conv.id, turnMessages, turnNumber).then(summary => {
     if (summary) {
       pushSSE(conv.id, 'summary-ready', { conversationId: conv.id, turnNumber });
     }
   }).catch(err => {
     logger.error(`Summary generation failed: ${err.message}`, { conversationId: conv.id });
     pushSSE(conv.id, 'summary-error', { conversationId: conv.id, error: err.message });
   });
   ```

10. Add helper to extract messages for the current turn:
    ```javascript
    function getTurnMessages(conv, turnNumber) {
      // Find the Nth user message, return it and all messages after it
      let userMsgCount = 0;
      let startIdx = 0;
      for (let i = 0; i < conv.messages.length; i++) {
        if (conv.messages[i].role === 'user') {
          userMsgCount++;
          if (userMsgCount === turnNumber) {
            startIdx = i;
            break;
          }
        }
      }
      return conv.messages.slice(startIdx);
    }
    ```

11. Modify `POST /api/chat/send` handler (around line 530):
    ```javascript
    // Before spawning agents, load existing summary
    let conversationContext = null;
    if (conversationId) {
      conversationContext = await loadSummary(conv.id);
    }

    spawnAgents(conv, routing, trimmedMessage, files, conversationContext).catch(err => {
      // ...existing error handling
    });
    ```

12. Add new routes (after line 604):
    - `GET /api/chat/conversations/:id/summary`
    - `POST /api/chat/conversations/:id/summary/regenerate`

13. Modify `GET /api/chat/conversations/:id` (line 579) to include summary in response.

### Phase 4: Configuration (src/config.mjs)

**File: `src/config.mjs`**

14. Add configuration options:
    ```javascript
    // Conversation memory
    SUMMARY_ENABLED: process.env.SUMMARY_ENABLED !== 'false',            // default: enabled
    SUMMARY_MAX_CHARS: parseInt(process.env.SUMMARY_MAX_CHARS, 10) || 6000,  // max summary size
    SUMMARY_MAX_TURN_CHARS: parseInt(process.env.SUMMARY_MAX_TURN_CHARS, 10) || 3000, // max per-agent output fed to summarizer
    ```

### Phase 5: Conversation Deletion Cleanup

**File: `src/db.mjs`**

15. Update `deleteConversation()` to delete summary row:
    ```javascript
    stmt('delSummary', `DELETE FROM conversation_summaries WHERE conversation_id = ?`).run(id);
    ```

**File: `src/routes/chat-api.mjs`** (or add to a cleanup utility)

16. On conversation delete, also remove the summary file:
    ```javascript
    import { unlink } from 'fs/promises';
    // In DELETE handler:
    try {
      await unlink(join(config.WORKSPACE, 'summaries', `summary-${id}.md`));
    } catch { /* file may not exist */ }
    ```

---

## 7. Future Vision: Full Agent Memory

### 7.1 Short-term (This SRD)

- Per-conversation summary injected as flat text
- Single summarizer agent, fixed Markdown schema
- File + SQLite dual storage

### 7.2 Medium-term: Structured Memory Store

- **Per-agent memory**: Each agent type accumulates knowledge about the project (e.g., the architect remembers past architectural decisions)
- **Entity extraction**: Summarizer extracts structured entities (files, functions, decisions, bugs) into a `memory_entities` table
- **Cross-conversation memory**: A `project_memory` table that persists knowledge across conversations about the same project/repo
- **Memory search**: SQLite FTS5 full-text search over summaries and entities so agents can query for relevant past context

```sql
-- Future tables
CREATE TABLE memory_entities (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  entity_type TEXT,    -- 'file', 'decision', 'bug', 'pattern', 'person'
  entity_key TEXT,     -- e.g., 'src/auth/login.mjs'
  entity_value TEXT,   -- e.g., 'Refactored to use JWT instead of sessions'
  confidence REAL,
  created_at TEXT
);

CREATE TABLE project_memory (
  id TEXT PRIMARY KEY,
  project_path TEXT,       -- e.g., '/Users/khai/work/my-app'
  memory_type TEXT,        -- 'architecture', 'convention', 'known-issue', 'preference'
  content TEXT,
  source_conversation TEXT,
  created_at TEXT,
  expires_at TEXT           -- memories can decay
);
```

### 7.3 Long-term: Autonomous Agent Memory (OpenClaw/Devin-style)

- **Vector embeddings**: Embed summaries and code context for semantic retrieval (using a local embedding model or API)
- **Memory consolidation**: Periodic background job that merges and compresses old summaries into higher-level project knowledge
- **Agent learning**: Agents reference past failures/successes to improve decision-making (e.g., "last time we used approach X it failed because Y")
- **Working memory vs. long-term memory**: Distinguish between ephemeral turn context and durable project knowledge
- **Memory pruning**: Automatic expiration and relevance scoring to prevent context bloat
- **Multi-project awareness**: Agents understand relationships between projects in the workspace

### 7.4 Migration Path

Each phase builds on the previous:

```
Phase 1 (this SRD)    → Flat summary per conversation, injected as text
Phase 2               → Structured entities + FTS5 search
Phase 3               → Cross-conversation project memory
Phase 4               → Vector embeddings + semantic retrieval
Phase 5               → Autonomous memory management + learning
```

The `conversation_summaries` table and Markdown file format from this SRD become the foundation. Future phases add tables and retrieval layers on top without breaking the existing flow.

---

## Appendix A: Sequence Diagram

```
User sends follow-up message (conversationId = conv-abc)
  │
  ├─► POST /api/chat/send
  │     │
  │     ├─► loadConversation(conv-abc)
  │     ├─► loadSummary(conv-abc)           ◄── NEW: loads prior summary
  │     │     └─► DB lookup → summaries/summary-conv-abc.md
  │     │
  │     ├─► detectIntent(message)
  │     ├─► Respond 200 { conversationId, routing }
  │     │
  │     └─► spawnAgents(conv, routing, msg, files, summary)   ◄── NEW: summary param
  │           │
  │           ├─► buildAgentPrompt(agent1, msg, null, summary)
  │           │     └─► "[role]\n## Conversation History\n{summary}\n## User Request\n{msg}"
  │           ├─► runSingleAgent(agent1, prompt, ...)
  │           │
  │           ├─► buildAgentPrompt(agent2, msg, agent1Result, summary)
  │           ├─► runSingleAgent(agent2, prompt, ...)
  │           │     ... (chain continues)
  │           │
  │           ├─► pushSSE('summary-generating')               ◄── NEW
  │           ├─► generateSummary(conv-abc, turnMessages, 2)  ◄── NEW
  │           │     ├─► Read existing summary file
  │           │     ├─► Build summarizer prompt
  │           │     ├─► queue.submitAndWait({ agentId: 'summarizer', ... })
  │           │     ├─► Write summary file
  │           │     ├─► db.upsertSummary(...)
  │           │     └─► pushSSE('summary-ready')
  │           │
  │           └─► pushSSE('complete')
```

## Appendix B: Token Budget Analysis

Typical agent prompt composition with conversation memory:

| Component | Estimated Tokens |
|---|---|
| Role prompt | 50-150 |
| Conversation summary | 800-2000 |
| User message | 50-500 |
| Previous agent context (chain) | 500-3000 |
| **Total prompt overhead** | **1400-5650** |

Claude's context window is 200K tokens. Even at maximum summary size, memory injection uses ~3% of available context. This leaves ample room for the agent's tool use, code reading, and output generation.

## Appendix C: Error Handling

| Failure Mode | Behavior |
|---|---|
| Summarizer agent times out | Log error, skip summary. Agents work without memory on next turn. Summary retried on subsequent turn. |
| Summarizer output is malformed | Save raw output anyway. Agents still get useful context even without perfect formatting. |
| Summary file missing but DB has it | `loadSummary()` falls back to DB. |
| DB row missing but file exists | `loadSummary()` falls back to file. |
| Both missing | Agents work without memory (same as today). No user-visible error. |
| Conversation deleted | Both DB row and file are cleaned up. |
| Queue full when summarizer submits | Log warning, skip this turn's summary. Not critical — next turn will capture cumulative history. |
