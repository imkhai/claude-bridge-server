# SRD: Agent Team Dashboard Portal

## 1. Overview

A real-time visual dashboard that shows the status of all agents working through the Claude Bridge Server. The dashboard connects to the bridge's existing API endpoints and provides two viewing modes:

1. **Real Mode** — A PixiJS-rendered visual office where each agent is an animated character sitting at a desk, with real-time status updates, workflow visualization, and environmental details (inspired by the Hive project)
2. **Simple Mode** — A terminal-style dashboard (inspired by glances/htop) showing agent status, queue stats, and workflow progress in a compact text-based layout

The dashboard is a standalone web application that ships as part of the claude-bridge-server project and can be accessed at `http://localhost:3210/dashboard`.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Claude Bridge Server (Express)                                 │
│                                                                 │
│  Existing:                    New:                              │
│  ├─ POST /ask                 ├─ GET /api/dashboard/agents      │
│  ├─ POST /ask/sync            ├─ GET /api/dashboard/stream (SSE)│
│  ├─ GET /status/:id           ├─ GET /api/dashboard/chains      │
│  ├─ GET /jobs                 ├─ GET /api/dashboard/timeline     │
│  ├─ GET /health               └─ Static file serving (dashboard)│
│  ├─ POST /chain                                                 │
│  └─ GET /chain/:chainId                                         │
└─────────────────────────────────────────────────────────────────┘
         │
         │ SSE (Server-Sent Events, 2s interval)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Dashboard Frontend (Vanilla JS + PixiJS)                       │
│                                                                 │
│  ├─ Real Mode (PixiJS Canvas)                                   │
│  │   ├─ Office floor with agent desks                           │
│  │   ├─ Animated characters with status expressions             │
│  │   ├─ Workflow pipeline visualization                         │
│  │   └─ Environmental details (monitors, lamps, cables)         │
│  │                                                              │
│  └─ Simple Mode (DOM/CSS Terminal)                              │
│      ├─ Agent status table                                      │
│      ├─ Queue stats bars                                        │
│      ├─ Active chain/workflow progress                          │
│      └─ Live event log                                          │
└─────────────────────────────────────────────────────────────────┘
```

### Tech Stack

- **No build step required** — Vanilla JS (ES modules), served as static files from Express
- **PixiJS 8** via CDN (for Real Mode canvas rendering)
- **CSS** for Simple Mode (terminal aesthetic using monospace fonts, green-on-black)
- **SSE** for real-time updates (no WebSocket dependency)

### Why No React/Build Step

The dashboard is embedded within the bridge server. Using vanilla JS + CDN imports keeps it zero-dependency, no build pipeline, and trivially deployable. The bridge is a utility server — the dashboard should be equally lightweight.

## 3. Data Sources

The dashboard consumes data from these bridge endpoints:

### 3.1 New API Endpoints

#### `GET /api/dashboard/agents`
Returns current agent status derived from active/recent jobs.

```json
{
  "agents": [
    {
      "agentId": "security-auditor",
      "status": "active",         // active | idle | error | timeout
      "currentTaskId": "abc-123",
      "currentPrompt": "Review the codebase for...",
      "startedAt": "2026-04-07T12:40:30Z",
      "duration": 45000,
      "completedTasks": 3,
      "lastActiveAt": "2026-04-07T12:41:15Z"
    }
  ],
  "stats": {
    "active": 2,
    "idle": 1,
    "queued": 3,
    "maxParallel": 4,
    "totalProcessed": 15,
    "uptime": 3600
  }
}
```

#### `GET /api/dashboard/stream`
SSE endpoint pushing updates every 2 seconds:

```
event: agents
data: { "agents": [...], "stats": {...} }

event: timeline
data: { "event": "task_started", "taskId": "abc", "agentId": "researcher", "prompt": "...", "timestamp": "..." }

event: chain
data: { "chainId": "chain-xyz", "status": "running", "currentStep": 2, "steps": [...] }
```

#### `GET /api/dashboard/chains`
Returns all active/recent chains with step details.

#### `GET /api/dashboard/timeline`
Returns recent events (task started, completed, failed, chain progress) — last 100 entries.

### 3.2 Existing Endpoints Used
- `GET /health` — uptime, queue stats
- `GET /jobs` — job list with status
- `GET /chain/:chainId` — chain progress

## 4. Real Mode — Visual Office

### 4.1 Layout

```
┌──────────────────────────────────────────────────────────┐
│  Header: "Claude Bridge — Agent Office"    [Simple] [⛶]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│   │ Agent 1  │  │ Agent 2  │  │ Agent 3  │  │ Agent 4  │ │
│   │  (desk)  │  │  (desk)  │  │  (desk)  │  │  (desk)  │ │
│   └─────────┘  └─────────┘  └─────────┘  └─────────┘   │
│                    corridor                              │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │
│   │ Agent 5  │  │ Agent 6  │  │ Agent 7  │  │ Agent 8  │ │
│   │  (desk)  │  │  (desk)  │  │  (desk)  │  │  (desk)  │ │
│   └─────────┘  └─────────┘  └─────────┘  └─────────┘   │
│                                                          │
│   ═══════ Pipeline Progress: [■■■■□□□] 4/7 ═══════      │
│                                                          │
│   ┌─── Queue: 3 waiting ─── Active: 2/4 ───────────┐   │
│   │  Server rack / Data center visualization         │   │
│   └──────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────┤
│  Timeline: security-auditor DONE (146s) | tech-lead...   │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Agent Desk Rendering

Each agent desk includes:
- **Character** — Procedurally drawn face/body on PixiJS canvas
  - Head with eyes, mouth (expressions change with status)
  - Body seated at desk
  - Arms on keyboard when active
- **Monitor** — Glowing screen with scrolling code lines when active, off when idle
- **Desk lamp** — Colored glow matching agent's assigned color
- **Name label** — Agent ID abbreviated (e.g., "sec-aud", "tech-lead")
- **Status indicator** — Colored dot (green=active, gray=idle, red=error, yellow=waiting)

### 4.3 Agent Colors (auto-assigned by role keywords)

| Pattern Match | Color | Hex |
|---------------|-------|-----|
| security, audit | Red | #ef4444 |
| lead, architect, plan | Violet | #8b5cf6 |
| senior, engineer, impl | Green | #22c55e |
| review, qa, test | Amber | #f59e0b |
| research, analyze | Cyan | #0ea5e9 |
| frontend, ui, design | Pink | #ec4899 |
| backend, api, data | Teal | #14b8a6 |
| default | Indigo | #6366f1 |

### 4.4 Character Expressions (Status-Based)

| Status | Eyes | Mouth | Body | Monitor |
|--------|------|-------|------|---------|
| active | Focused (narrowed) | Straight line | Typing at desk | ON, code scrolling |
| idle | Relaxed (half-open) | Slight smile | Leaning back | OFF |
| error | X eyes | Zigzag line | Sweat drops | Red flash |
| timeout | Spiral eyes | Open circle | Slumped | OFF |
| queued | Looking sideways | Flat line | Waiting posture | OFF |
| done | Happy (wide open) | Smile | Relaxed | Checkmark |

### 4.5 Animation Behaviors (Active Agents)

When active, agents cycle through behaviors:
- **Typing** (60%) — Hands on keyboard, focused face, 2-5s
- **Thinking** (15%) — Lean back, thought bubble, 1-3s
- **Reading monitor** (15%) — Eyes scanning, head slight tilt, 2-4s
- **Look around** (10%) — Eyes wander, brief head turn, 1-2s

### 4.6 Environmental Elements

- **Ceiling lights** — 3-4 pendant lights with warm glow
- **Wall clock** — Real-time with animated seconds hand
- **Network cables** — Lines from each desk to data center, animated blue pulses when that agent is active
- **Data center rack** — Bottom of canvas, LED indicators matching server load
- **Pipeline progress bar** — Visual bar showing chain progress between desk rows

### 4.7 Workflow Visualization

When a chain is running:
- **Pipeline bar** between desk rows shows step progress: `[■■■■□□□]`
- **Active step** pulses/glows
- **Completed steps** show green checkmarks
- **Arrow lines** connect agents in chain sequence
- **Speech bubbles** appear above active agent showing truncated prompt

### 4.8 Click Interactions

- **Click agent** — Show detail panel (slide from right):
  - Agent ID, status, color badge
  - Current task prompt (full text, scrollable)
  - Duration running
  - History: last 5 completed tasks with results summary
- **Click pipeline step** — Highlight the agent responsible
- **Hover desk** — Show agent tooltip with status summary

## 5. Simple Mode — Terminal Dashboard

### 5.1 Layout

```
╔══════════════════════════════════════════════════════════════════╗
║  CLAUDE BRIDGE SERVER — Dashboard            uptime: 1h 23m 45s║
║  Port: 3210 | Workers: 2/4 active | Queue: 3 waiting           ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  AGENTS                                                          ║
║  ┌──────────────────┬────────┬──────────┬───────────────────┐   ║
║  │ Agent ID         │ Status │ Duration │ Task              │   ║
║  ├──────────────────┼────────┼──────────┼───────────────────┤   ║
║  │ security-auditor │ ■ DONE │   2m 26s │ Review codebase.. │   ║
║  │ tech-lead        │ ■ RUN  │   1m 45s │ Create improvem.. │   ║
║  │ senior-engineer  │ ● WAIT │        - │ Implement fixes.. │   ║
║  │ qa-reviewer      │ ○ IDLE │        - │ -                 │   ║
║  └──────────────────┴────────┴──────────┴───────────────────┘   ║
║                                                                  ║
║  CHAIN: chain-5fc397                                             ║
║  [■■■□] Step 2/4: tech-lead (running, 1m 45s)                  ║
║  1. security-auditor  ✓ done    2m 26s                          ║
║  2. tech-lead         ▸ running 1m 45s                          ║
║  3. senior-engineer   ○ pending                                 ║
║  4. qa-reviewer       ○ pending                                 ║
║                                                                  ║
║  QUEUE                                                           ║
║  Active: ██████████░░░░░░░░░░ 2/4                               ║
║  Queue:  ███░░░░░░░░░░░░░░░░░ 3                                ║
║  Total:  15 processed                                            ║
║                                                                  ║
║  TIMELINE (recent)                                               ║
║  12:42:56 ✓ security-auditor DONE (146s, 1492 chars)            ║
║  12:42:56 ▸ tech-lead STARTED                                   ║
║  12:40:30 ▸ security-auditor STARTED                            ║
║  12:40:30 + chain-5fc397 CREATED (4 steps)                      ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

### 5.2 Design Aesthetic

- **Colors**: Dark background (#0d1117), green text (#3fb950) for active, gray (#8b949e) for idle, red (#f85149) for errors, yellow (#d29922) for warnings
- **Font**: Monospace (JetBrains Mono or system monospace)
- **Borders**: Box-drawing characters (─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼)
- **Status indicators**: ■ (done/active), ● (waiting), ○ (idle), ✗ (error)
- **Progress bars**: Block characters (█ ░)
- **Auto-refresh**: Data updates every 2s via SSE (no page reload)
- **Blinking cursor**: Active agents have blinking indicator

### 5.3 Sections

1. **Header** — Server info, uptime, worker count, queue depth
2. **Agents Table** — All known agents with status, duration, truncated prompt
3. **Chain Progress** — Active chain with step-by-step view and progress bar
4. **Queue Stats** — Visual bars for active workers and queue depth
5. **Timeline** — Scrolling log of recent events (last 20)

### 5.4 Keyboard Shortcuts (Simple Mode)

- `r` — Force refresh
- `1` / `2` — Switch to Real / Simple mode
- `j` / `k` — Scroll timeline up/down
- `q` — Close detail view
- `f` — Toggle fullscreen

## 6. Shared Features (Both Modes)

### 6.1 Mode Toggle
- Button in header: `[Real]` / `[Simple]`
- Keyboard shortcut: `1` (Real), `2` (Simple)
- Preference saved in localStorage

### 6.2 Real-Time Updates via SSE
- Connect to `/api/dashboard/stream`
- Events: `agents`, `timeline`, `chain`
- Reconnect on disconnect with exponential backoff (1s, 2s, 4s, max 30s)
- Connection status indicator in header (green dot = connected, red = disconnected)

### 6.3 Agent Discovery
- Agents are discovered automatically from job history
- No pre-configuration needed
- First seen → added to dashboard
- Agents not seen for > 10 minutes → shown as "idle"
- Agents fade after 1 hour of inactivity

### 6.4 Auto-Layout (Real Mode)
- Desk positions assigned in order of first appearance
- Grid: 2 rows × 4 columns = 8 slots
- If > 8 agents, overflow shown as mini-icons below desk area

### 6.5 Notifications
- Browser notification on chain completion (if permitted)
- Visual flash on error/timeout events
- Sound option (muted by default) — soft chime on task done

## 7. Server-Side Implementation

### 7.1 New Files

```
src/routes/dashboard-api.mjs   — Dashboard API routes + SSE endpoint
dashboard/                      — Static files directory
  ├─ index.html                — Main HTML page
  ├─ css/
  │   ├─ main.css              — Shared styles
  │   ├─ real-mode.css         — Real mode specific
  │   └─ simple-mode.css       — Terminal aesthetic
  ├─ js/
  │   ├─ app.mjs              — Entry point, mode switching, SSE
  │   ├─ api.mjs              — API client
  │   ├─ state.mjs            — Agent state management
  │   ├─ real/
  │   │   ├─ office.mjs       — PixiJS office rendering
  │   │   ├─ character.mjs    — Agent character drawing
  │   │   ├─ desk.mjs         — Desk/furniture rendering
  │   │   ├─ environment.mjs  — Lights, cables, data center
  │   │   ├─ pipeline.mjs     — Chain workflow visualization
  │   │   └─ interactions.mjs — Click handlers, detail panel
  │   └─ simple/
  │       ├─ terminal.mjs     — Terminal layout rendering
  │       ├─ table.mjs        — Agent status table
  │       ├─ progress.mjs     — Progress bars
  │       └─ timeline.mjs     — Event log
  └─ assets/
      └─ (optional sprites/icons)
```

### 7.2 Dashboard API Route (`src/routes/dashboard-api.mjs`)

```javascript
// Derives agent status from queue's job map
// Maintains timeline of events (ring buffer, 100 entries)
// SSE endpoint pushes state every 2 seconds

export const dashboardRouter = Router();

// GET /api/dashboard/agents
// GET /api/dashboard/chains
// GET /api/dashboard/timeline
// GET /api/dashboard/stream (SSE)
```

### 7.3 Static File Serving

Add to `server.mjs`:
```javascript
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';

const __dirname = dirname(fileURLToPath(import.meta.url));
app.use('/dashboard', express.static(join(__dirname, 'dashboard')));
```

### 7.4 Timeline Event Tracking

The dashboard API maintains an in-memory ring buffer of events:

```javascript
const timeline = [];
const MAX_TIMELINE = 100;

function addEvent(type, data) {
  timeline.push({ type, ...data, timestamp: new Date().toISOString() });
  if (timeline.length > MAX_TIMELINE) timeline.shift();
}
```

Events are generated by hooking into the queue's `executeJob` and chain execution.

## 8. Non-Functional Requirements

- **Performance**: Dashboard should render at 60fps in Real Mode with up to 8 agents
- **Bundle size**: < 500KB total (PixiJS loaded from CDN)
- **Browser support**: Chrome, Firefox, Safari, Edge (latest versions)
- **Mobile**: Simple Mode should be responsive; Real Mode can require minimum 800px width
- **Memory**: < 50MB browser memory usage
- **No build step**: All JS served as-is, no bundler/transpiler needed
- **No new npm dependencies**: PixiJS loaded via CDN, everything else is vanilla JS

## 9. Implementation Priority

### Phase 1: Foundation
1. Dashboard API endpoints (agents, timeline, chains, SSE stream)
2. Static file serving setup
3. `index.html` with mode toggle
4. SSE client with reconnection logic
5. State management module

### Phase 2: Simple Mode
6. Terminal layout CSS
7. Agent status table
8. Chain progress display
9. Queue stats bars
10. Timeline event log
11. Keyboard shortcuts

### Phase 3: Real Mode
12. PixiJS canvas setup and scaling
13. Desk grid layout
14. Character rendering (procedural faces)
15. Status-based expressions and animations
16. Monitor, lamp, furniture rendering
17. Network cables and data center
18. Behavior state machine (typing, thinking, etc.)

### Phase 4: Interactions & Polish
19. Click-to-detail panel
20. Chain workflow pipeline visualization
21. Speech bubbles
22. Environmental effects (lights, clock)
23. Browser notifications
24. Demo mode (for showcasing)

## 10. Success Criteria

- [ ] Dashboard accessible at `/dashboard` when bridge server is running
- [ ] Real Mode shows animated agents with correct status from bridge API
- [ ] Simple Mode shows all agent data in terminal-style layout
- [ ] Mode toggle persists preference
- [ ] SSE updates reflect within 2 seconds of job state changes
- [ ] Chain progress visible in both modes
- [ ] Click on agent shows detail panel (Real Mode)
- [ ] Works with 0 agents (empty state) through 8+ agents
- [ ] No new npm dependencies added
- [ ] No build step required
