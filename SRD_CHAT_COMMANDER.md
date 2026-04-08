# SRD: Chat Commander — Bridge Team Control Interface

## 1. Overview

A beautiful chat interface embedded in the Claude Bridge Server that allows users to communicate with their agent team through natural language. Instead of crafting curl commands or API calls, users type messages in a chat UI, and the system automatically spawns the right agents to handle the request.

The chat is accessible at `http://localhost:3210/chat` and serves as the primary way to interact with the bridge.

## 2. Core Features

### 2.1 Chat Interface
- Modern, beautiful chat UI (dark theme, smooth animations)
- Message input with send button and keyboard shortcut (Enter to send, Shift+Enter for newline)
- Chat bubbles: user messages on right (orange #f36f20), system/agent responses on left
- Auto-scroll to latest message
- Typing indicator when agents are working
- Timestamp on each message
- Markdown rendering in responses (code blocks, headers, lists)

### 2.2 File Upload
- Drag-and-drop zone in chat area
- Click-to-upload button (paperclip icon)
- Supported file types:
  - **Images** (PNG, JPG, GIF, WebP) — screenshots, bug reports, designs
  - **Documents** (MD, TXT, PDF) — SRDs, specs, requirements
  - **Code files** (JS, MJS, PY, etc.) — for review/analysis
- Files saved to `bridge-data/uploads/{timestamp}-{filename}`
- Image preview thumbnail in chat
- File icon + name for non-image files
- Multiple file upload support

### 2.3 Smart Agent Routing
When user sends a message, the system analyzes intent and spawns appropriate agents:

| User Intent | Agent Pattern |
|-------------|---------------|
| "implement X" / "build X" | architect → parallel engineers → integration |
| "fix bug" + screenshot | image-analyzer → investigator → senior-engineer → qa |
| "review code" / "security audit" | security-auditor → tech-lead → engineer → qa |
| "design X" / "create UI" | ui-architect → frontend-engineer |
| "explain X" / "what is X" | single researcher agent |
| "update docs" | documentation-agent |
| General question | single general-agent |

The routing is configurable — users can also explicitly specify: "use 3 parallel agents to..."

### 2.4 Conversation History
- All conversations persisted to `bridge-data/conversations/`
- Each conversation is a JSON file with messages, agent responses, file references
- Sidebar showing past conversations (title auto-generated from first message)
- Click to reload any past conversation
- Search across conversations
- Delete conversations

### 2.5 File History
- Sidebar tab showing all uploaded files
- Grouped by date
- Click to view/preview
- Shows which conversation each file was used in
- File type icons

### 2.6 Agent Activity Panel
- Collapsible right panel showing live agent activity
- Which agents are working on current request
- Real-time progress (from /progress endpoint)
- Duration timers
- Status indicators (spinning for active, check for done, X for error)
- Expandable to see full agent output when done

### 2.7 Image/Screenshot Handling
When user uploads an image:
1. Save to `bridge-data/uploads/`
2. Spawn an `image-analyzer` agent with prompt: "Analyze this image: {path}. Describe what you see in detail."
3. The analysis result becomes context for subsequent agents
4. Image thumbnail shown in chat with analysis summary below

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Chat UI (dashboard/chat/)                              │
│  ├─ index.html — Chat page                              │
│  ├─ css/chat.css — Styles                               │
│  └─ js/                                                 │
│      ├─ chat-app.mjs — Main app, message handling       │
│      ├─ chat-api.mjs — API client (send, upload, SSE)   │
│      ├─ chat-router.mjs — Intent detection & routing    │
│      ├─ chat-history.mjs — Conversation persistence     │
│      ├─ chat-renderer.mjs — Message rendering, markdown │
│      ├─ chat-upload.mjs — File upload handling           │
│      └─ chat-agents.mjs — Agent activity panel          │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Server API (src/routes/chat-api.mjs)                   │
│  ├─ POST /api/chat/send — Send message, spawn agents    │
│  ├─ POST /api/chat/upload — Upload file                 │
│  ├─ GET /api/chat/conversations — List conversations    │
│  ├─ GET /api/chat/conversations/:id — Get conversation  │
│  ├─ DELETE /api/chat/conversations/:id — Delete         │
│  ├─ GET /api/chat/files — List uploaded files            │
│  └─ GET /api/chat/stream/:conversationId — SSE updates  │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  Existing Bridge API                                    │
│  POST /ask, /ask/sync, /chain, GET /progress, /jobs     │
└─────────────────────────────────────────────────────────┘
```

## 4. UI Design

### 4.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│  ● Chat Commander          [Dashboard] [🔍] [⚙]             │
├────────┬─────────────────────────────────────┬───────────────┤
│        │                                     │               │
│ Convos │   Welcome to Chat Commander! 🤖     │  Agent Panel  │
│        │   Send a message to get started.    │               │
│ Today  │                                     │  ┌─────────┐  │
│ ▸ Fix  │   ┌──────────────────────────┐     │  │ idle    │  │
│   bugs │   │ You: Can you implement   │     │  │ no tasks│  │
│ ▸ Add  │   │ a login page?            │     │  │         │  │
│   feat │   └──────────────────────────┘     │  └─────────┘  │
│        │                                     │               │
│ Yester │      ┌─────────────────────────┐   │               │
│ ▸ Rev  │      │ 🤖 Spawning team:       │   │               │
│   code │      │ ▸ architect (planning)  │   │               │
│        │      │ ○ frontend-eng (waiting)│   │               │
│ Files  │      └─────────────────────────┘   │               │
│ 📎 srd │                                     │               │
│ 📎 bug │                                     │               │
│        │                                     │               │
├────────┴─────────────────────────────────────┴───────────────┤
│  [📎] Type your message...                        [Send ▶]   │
│  ┌──────────────────────────────────────────────┐            │
│  │  Drop files here or click 📎 to upload       │            │
│  └──────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Color Scheme
- Background: #0a0a0f (near black)
- Chat area: #111827 (dark gray)
- User bubbles: #f36f20 (primary orange) with white text
- Agent bubbles: #1e293b (slate) with #e2e8f0 text
- System messages: #374151 with #9ca3af text
- Accent: #f36f20 (orange)
- Success: #22c55e (green)
- Error: #ef4444 (red)
- Code blocks: #1a1a2e with syntax highlighting
- Sidebar: #0f172a
- Borders: #1e293b

### 4.3 Typography
- Font: Inter (Google Fonts) or system sans-serif
- Chat messages: 14px
- Code: JetBrains Mono or system monospace, 13px
- Timestamps: 11px, muted color
- Headers: 16-20px, semibold

### 4.4 Animations
- Message slide-in from bottom (user) or left (agent)
- Typing indicator: 3 bouncing dots
- File upload: progress bar animation
- Agent status: pulse animation for active, fade for idle
- Sidebar: smooth slide transitions
- Send button: subtle scale on hover

## 5. Server Implementation

### 5.1 POST /api/chat/send

Request:
```json
{
  "conversationId": "conv-123" | null,
  "message": "Please implement a login page",
  "files": ["bridge-data/uploads/1234-screenshot.png"]
}
```

Response (immediate):
```json
{
  "conversationId": "conv-456",
  "messageId": "msg-789",
  "routing": {
    "pattern": "implementation",
    "agents": ["architect", "frontend-engineer", "integration-engineer"],
    "method": "chain"
  }
}
```

Then SSE pushes updates as agents work.

### 5.2 POST /api/chat/upload

Multipart form data with file(s). Returns:
```json
{
  "files": [
    {
      "filename": "screenshot.png",
      "path": "bridge-data/uploads/1712520000-screenshot.png",
      "type": "image/png",
      "size": 245000
    }
  ]
}
```

### 5.3 Intent Detection (chat-router on server)

Simple keyword/pattern matching:
```javascript
function detectIntent(message, files) {
  const lower = message.toLowerCase();
  const hasImages = files.some(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f));
  const hasDocs = files.some(f => /\.(md|txt|pdf)$/i.test(f));

  if (hasImages && /bug|issue|fix|broken|error/i.test(lower))
    return { pattern: 'bug-report', agents: ['image-analyzer', 'investigator', 'senior-engineer'] };
  if (hasDocs && /implement|build|create/i.test(lower))
    return { pattern: 'implementation-with-spec', agents: ['architect', 'engineers', 'qa'] };
  if (/implement|build|create|add/i.test(lower))
    return { pattern: 'implementation', agents: ['architect', 'engineers', 'integration'] };
  if (/review|audit|security/i.test(lower))
    return { pattern: 'review', agents: ['auditor', 'lead', 'engineer', 'qa'] };
  if (/fix|bug|broken|error/i.test(lower))
    return { pattern: 'bugfix', agents: ['investigator', 'engineer', 'qa'] };
  if (/design|ui|ux/i.test(lower))
    return { pattern: 'design', agents: ['ui-architect', 'frontend-engineer'] };
  if (/explain|what|how|why/i.test(lower))
    return { pattern: 'research', agents: ['researcher'] };
  if (/doc|readme|update doc/i.test(lower))
    return { pattern: 'documentation', agents: ['doc-writer'] };

  return { pattern: 'general', agents: ['general-agent'] };
}
```

### 5.4 Conversation Storage

```
bridge-data/conversations/
├── conv-abc123.json
├── conv-def456.json
└── ...
```

Each file:
```json
{
  "id": "conv-abc123",
  "title": "Implement login page",
  "createdAt": "2026-04-07T...",
  "updatedAt": "2026-04-07T...",
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "content": "Please implement a login page",
      "files": [],
      "timestamp": "..."
    },
    {
      "id": "msg-2",
      "role": "system",
      "content": "Spawning team: architect → frontend-engineer → integration",
      "routing": { "pattern": "implementation", ... },
      "taskIds": ["task-123", "task-456"],
      "timestamp": "..."
    },
    {
      "id": "msg-3",
      "role": "agent",
      "agentId": "architect",
      "content": "Architecture plan created...",
      "taskId": "task-123",
      "duration": 145,
      "timestamp": "..."
    }
  ]
}
```

## 6. File Structure

```
dashboard/chat/
├── index.html
├── css/
│   └── chat.css
└── js/
    ├── chat-app.mjs        — Main app, initialization, event wiring
    ├── chat-api.mjs         — API calls (send, upload, history, SSE)
    ├── chat-router.mjs      — Client-side intent display
    ├── chat-history.mjs     — Sidebar conversation list
    ├── chat-renderer.mjs    — Message rendering, markdown, code highlight
    ├── chat-upload.mjs      — Drag-drop, file preview, upload progress
    └── chat-agents.mjs      — Agent activity panel

src/routes/chat-api.mjs      — Server routes + intent detection + conversation storage
```

## 7. Implementation Priority

### Phase 1: Core Chat
1. Server: chat-api.mjs with send, SSE, conversation CRUD
2. HTML + CSS: chat layout, dark theme, responsive
3. Message rendering with markdown
4. Send message → spawn agents → stream results back
5. Basic intent detection

### Phase 2: File Upload
6. Upload endpoint with multer
7. Drag-drop UI
8. Image preview in chat
9. Image analysis agent spawning
10. File reference passing to agents

### Phase 3: History & Polish
11. Conversation persistence
12. Sidebar with conversation list
13. File history sidebar tab
14. Search
15. Agent activity panel

## 8. Dependencies
- `multer` — for multipart file upload (npm install multer)
- No other new dependencies
- Markdown rendering: simple regex-based (no library needed) or use marked.js via CDN

## 9. Success Criteria
- [ ] Chat accessible at /chat
- [ ] User can type message and get agent team response
- [ ] File upload works (drag-drop + click)
- [ ] Images analyzed by AI agent automatically
- [ ] Conversation history persisted and loadable
- [ ] Agent activity visible in real-time
- [ ] Beautiful dark theme matching brand (#f36f20)
- [ ] Works on desktop browsers (Chrome, Firefox, Safari)
