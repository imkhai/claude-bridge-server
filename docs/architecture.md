# Claude Bridge Server — Architecture & Flow

## 1. System Overview

Claude Bridge is a Node.js HTTP server that acts as a bridge between AI agents (OpenClaw or any HTTP client) and the Claude Code CLI. It provides job queuing, concurrency control, file-based context passing, and multi-step chain execution.

```
┌─────────────────────────────────────────────────────────┐
│                  Agent Orchestrator                      │
│                                                         │
│  UI/UX Designer   Architect   Engineer   Code Reviewer  │
│       │              │           │            │         │
└───────┼──────────────┼───────────┼────────────┼─────────┘
        │              │           │            │
        ▼              ▼           ▼            ▼
┌─────────────────────────────────────────────────────────┐
│            Claude Bridge (localhost:3210)                │
│                                                         │
│  ┌───────────────────────────────────────────────┐      │
│  │              HTTP Layer (Express)              │      │
│  │  POST /ask      POST /ask/sync                │      │
│  │  POST /chain    GET  /chain/:id               │      │
│  │  GET  /status   GET  /jobs                    │      │
│  │  POST /cancel   GET  /health                  │      │
│  └───────────────────┬───────────────────────────┘      │
│                      │                                  │
│  ┌───────────────────▼───────────────────────────┐      │
│  │           Job Queue (FIFO, in-memory)          │      │
│  │                                                │      │
│  │  waitingQueue: [job3, job4, job5]              │      │
│  │  activeCount:  2 / MAX_PARALLEL(4)            │      │
│  │                                                │      │
│  │  processQueue() ─── picks next when slot free │      │
│  └───────────────────┬───────────────────────────┘      │
│                      │                                  │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐               │
│  │claude│  │claude│  │claude│  │claude│                │
│  │ -p   │  │ -p   │  │ -p   │  │ -p   │                │
│  │slot 1│  │slot 2│  │slot 3│  │slot 4│                │
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘               │
│     │         │         │         │                     │
│  ┌──▼─────────▼─────────▼─────────▼──┐                 │
│  │         workspace/ (filesystem)    │                 │
│  │  tasks/      ← input prompts      │                 │
│  │  contexts/   ← temp context files  │                 │
│  │  results/    ← output from claude  │                 │
│  │  shared/     ← shared docs         │                 │
│  └────────────────────────────────────┘                 │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Request Flows

### 2.1 Async Task (`POST /ask`)

Best for: fire-and-forget tasks, background processing, polling UIs.

```
Client                    Bridge                     Claude CLI
  │                         │                           │
  │  POST /ask              │                           │
  │  {prompt, agentId}      │                           │
  │────────────────────────>│                           │
  │                         │  createJob()              │
  │                         │  waitingQueue.push(job)   │
  │                         │  processQueue()           │
  │  {taskId, status,       │                           │
  │   position}             │                           │
  │<────────────────────────│                           │
  │                         │                           │
  │                         │  [when slot available]    │
  │                         │  executeJob()             │
  │                         │  spawn(claude -p ...)     │
  │                         │─────────────────────────>│
  │                         │                           │
  │  GET /status/:taskId    │       [processing...]     │
  │────────────────────────>│                           │
  │  {status: "running"}    │                           │
  │<────────────────────────│                           │
  │                         │                           │
  │                         │         stdout            │
  │                         │<─────────────────────────│
  │                         │  saveResult()             │
  │                         │  job.status = "done"      │
  │                         │  processQueue() [next]    │
  │                         │                           │
  │  GET /status/:taskId    │                           │
  │────────────────────────>│                           │
  │  {status: "done",       │                           │
  │   result: "...",        │                           │
  │   resultFile: "..."}    │                           │
  │<────────────────────────│                           │
```

### 2.2 Sync Task (`POST /ask/sync`)

Best for: simple request-response, when the caller needs the result immediately.

```
Client                    Bridge                     Claude CLI
  │                         │                           │
  │  POST /ask/sync         │                           │
  │  {prompt, agentId}      │                           │
  │────────────────────────>│                           │
  │                         │  createJob()              │
  │                         │  job._resolve = resolve   │
  │                         │  waitingQueue.push(job)   │
  │                         │  processQueue()           │
  │                         │                           │
  │    [HTTP connection     │  [when slot available]    │
  │     held open...]       │  spawn(claude -p ...)     │
  │                         │─────────────────────────>│
  │                         │                           │
  │                         │         stdout            │
  │                         │<─────────────────────────│
  │                         │  saveResult()             │
  │                         │  job._resolve(job) ──┐   │
  │                         │                      │   │
  │  {taskId, status,       │  <── Promise resolves┘   │
  │   result, resultFile,   │                           │
  │   duration}             │                           │
  │<────────────────────────│                           │
```

### 2.3 Chain (`POST /chain`)

Best for: sequential multi-agent pipelines where each step builds on the previous.

```
Client                    Bridge                     Claude CLI
  │                         │                           │
  │  POST /chain            │                           │
  │  {steps: [              │                           │
  │    {prompt, agent:"A"}, │                           │
  │    {prompt, agent:"B",  │                           │
  │     usesPrevious:true}, │                           │
  │    {prompt, agent:"C",  │                           │
  │     usesPrevious:true}  │                           │
  │  ]}                     │                           │
  │────────────────────────>│                           │
  │                         │  create chainState        │
  │  {chainId, steps:[      │                           │
  │    {step:1, pending},   │                           │
  │    {step:2, pending},   │                           │
  │    {step:3, pending}    │                           │
  │  ]}                     │                           │
  │<────────────────────────│                           │
  │                         │                           │
  │                         │  ── executeChain() ──     │
  │                         │                           │
  │                         │  Step 1: submitAndWait()  │
  │                         │  spawn(claude -p ...)     │
  │                         │─────────────────────────>│
  │                         │         stdout            │
  │                         │<─────────────────────────│
  │                         │  save result-aaa.md       │
  │                         │                           │
  │  GET /chain/:chainId    │                           │
  │────────────────────────>│                           │
  │  {currentStep: 2,       │                           │
  │   steps: [done,running, │                           │
  │           pending]}     │                           │
  │<────────────────────────│                           │
  │                         │                           │
  │                         │  Step 2: submitAndWait()  │
  │                         │  contextFile=result-aaa   │
  │                         │  prompt = "Read file at   │
  │                         │   result-aaa for context. │
  │                         │   Then: <original prompt>"│
  │                         │─────────────────────────>│
  │                         │         stdout            │
  │                         │<─────────────────────────│
  │                         │  save result-bbb.md       │
  │                         │                           │
  │                         │  Step 3: submitAndWait()  │
  │                         │  contextFile=result-bbb   │
  │                         │─────────────────────────>│
  │                         │         stdout            │
  │                         │<─────────────────────────│
  │                         │  save result-ccc.md       │
  │                         │  chain.status = "done"    │
  │                         │                           │
  │  GET /chain/:chainId    │                           │
  │────────────────────────>│                           │
  │  {status: "done",       │                           │
  │   steps: [done,done,    │                           │
  │           done]}        │                           │
  │<────────────────────────│                           │
```

### 2.4 Context Passing (How Data Flows Between Tasks)

There are three ways to pass context to a task:

```
Method 1: Inline Context
────────────────────────
POST /ask/sync {
  "prompt": "Review this code",
  "context": "function hello() { ... }"    ← text sent in body
}
  │
  ▼
Bridge saves to: workspace/contexts/context-{taskId}.md
Claude receives: "Read the file at .../context-{id}.md for context. Then: Review this code"


Method 2: Context File (explicit path)
──────────────────────────────────────
POST /ask/sync {
  "prompt": "Improve this design",
  "contextFile": "workspace/results/result-abc123.md"    ← path to existing file
}
  │
  ▼
Claude receives: "Read the file at .../result-abc123.md for context. Then: Improve this design"


Method 3: Chain Auto-Pass (usesPreviousResult)
──────────────────────────────────────────────
POST /chain {
  "steps": [
    { "prompt": "Write code",    "agentId": "engineer" },
    { "prompt": "Review code",   "agentId": "reviewer", "usesPreviousResult": true }
  ]                                                          │
}                                                            │
  │                                                          ▼
  ▼                                                   Bridge automatically sets
Step 1 completes → resultFile = result-xxx.md         contextFile = result-xxx.md
                                                      for the next step
```

### 2.5 Concurrency Control

```
MAX_PARALLEL = 4 (default)

Timeline example with 6 tasks arriving at once:
─────────────────────────────────────────────────────

Time ──────────────────────────────────────────────>

Slot 1: [████ Task-1 ████]          [████ Task-5 ████]
Slot 2: [██████ Task-2 ██████]        [██ Task-6 ██]
Slot 3: [███ Task-3 ███]
Slot 4: [█████████ Task-4 █████████]

Queue:  [T5, T6] → [T6] → [] → [] → []

When Task-1 finishes → processQueue() → starts Task-5
When Task-3 finishes → processQueue() → starts Task-6
```

---

## 3. Job Lifecycle

```
                    ┌─────────┐
     POST /ask ────>│ queued  │
                    └────┬────┘
                         │  processQueue() picks it up
                         ▼
                    ┌─────────┐
                    │ running │──────── spawn(claude -p ...)
                    └────┬────┘
                         │
              ┌──────────┼──────────┬──────────┐
              ▼          ▼          ▼          ▼
         ┌────────┐ ┌─────────┐ ┌────────┐ ┌───────────┐
         │  done  │ │  error  │ │timeout │ │ cancelled │
         └────────┘ └─────────┘ └────────┘ └───────────┘
              │          │          │          │
              ▼          ▼          ▼          ▼
         result      stderr     SIGTERM    POST /cancel
         saved       captured   → SIGKILL  or shutdown
         to .md      in job     after 5s
```

---

## 4. File System Layout

```
workspace/
├── tasks/
│   ├── task-a1b2c3d4.md          ← original prompt text saved
│   └── task-e5f6g7h8.md
├── contexts/
│   ├── context-a1b2c3d4.md       ← inline context saved as file
│   └── context-e5f6g7h8.md
├── results/
│   ├── result-a1b2c3d4.md        ← claude output + metadata
│   └── result-e5f6g7h8.md
└── shared/
    └── (user-managed shared documents)
```

**Result file format:**
```markdown
# Result: a1b2c3d4

**Agent:** researcher
**Prompt:** Research the top 5 React libraries...
**Completed:** 2026-04-07T10:00:14Z
**Duration:** 12340ms

---

<full claude output here>
```

---

## 5. Error Handling Flow

```
                    Claude Process
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Exit code 0      Exit code ≠ 0    No response
        │                │            in TIMEOUT_MS
        ▼                ▼                │
   status: "done"   status: "error"      ▼
   result: stdout   error: stderr    SIGTERM sent
                    exitCode: N           │
                                     5 seconds
                                          │
                                     SIGKILL sent
                                          │
                                          ▼
                                    status: "timeout"
                                    error: "Process
                                     timed out..."

Buffer overflow (>10MB stdout):
        │
        ▼
   SIGKILL immediately
   status: "error"
   error: "Buffer limit exceeded"
```
