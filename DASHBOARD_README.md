# Agent Dashboard

Real-time monitoring dashboard for Claude Bridge Server.

## Access

Start the server and open in a browser:

```bash
npm start
# Open http://localhost:3210/dashboard
```

The root URL (`/`) redirects to the dashboard for browser requests.

## Modes

### Simple Mode (default)

Terminal-style UI with box-drawing characters. Shows:
- Agent status table (ID, status, duration, current task)
- Chain progress with step-by-step view
- Queue utilization bars
- Scrolling event timeline

### Real Mode

PixiJS-rendered office scene. Each agent gets a desk with:
- Animated character with status-based expressions
- Monitor showing scrolling code (active), checkmark (done), or red X (error)
- Desk lamp with colored glow
- Network cables with animated pulses to a data center rack
- Pipeline visualization for active chains
- Click an agent to see a detail panel; hover for tooltip

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` | Switch to Real mode |
| `2` | Switch to Simple mode |
| `r` | Refresh data |
| `f` | Toggle fullscreen |
| `Esc` / `q` | Close detail panel (Real mode) |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/dashboard/agents` | Agent summaries + queue stats |
| `GET /api/dashboard/chains` | Active/recent chain progress |
| `GET /api/dashboard/timeline` | Recent events (ring buffer, 100 max) |
| `GET /api/dashboard/stream` | SSE stream (agents every 2s, timeline in real-time) |

## Connection Status

The header shows a colored dot and label:
- **Yellow (pulsing)** — Connecting to SSE stream
- **Green** — Connected, receiving live updates
- **Red** — Disconnected, auto-reconnecting with backoff

## Notes

- Dashboard endpoints bypass API key authentication
- Mode preference is saved in localStorage
- Real mode requires internet access (PixiJS loaded from CDN)
- All state is derived from the server's in-memory job queue
