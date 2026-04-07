// Main PixiJS office renderer — initializes canvas, manages desk grid, orchestrates sub-modules
import { getAgentColor } from '../state.mjs';
import { AgentCharacter } from './character.mjs';
import { Desk } from './desk.mjs';
import { Environment } from './environment.mjs';
import { Pipeline } from './pipeline.mjs';
import { Interactions } from './interactions.mjs';
import { LeaderboardOverlay } from './leaderboard.mjs';

const PIXI = window.PIXI;

// Layout constants
const CANVAS_W = 880;
const CANVAS_H = 760;
const DESK_COLS = 4;
const DESK_ROWS = 2;
const MAX_AGENTS = DESK_COLS * DESK_ROWS;

// Desk grid positions
const GRID_MARGIN_X = 55;
const GRID_MARGIN_Y = 80;
const CELL_W = 195;
const CELL_H = 160;
const CORRIDOR_GAP = 100; // gap between row 0 and row 1 for pipeline

let app = null;
let environment = null;
let pipeline = null;
let interactions = null;
let leaderboardOverlay = null;

// Maps agentId → {character, desk, slotIndex}
let agentSlots = new Map();
// Ordered list of agent IDs by first appearance
let agentOrder = [];

let stateRef = null;
let tickerCallback = null;

/**
 * Compute the center position of a desk slot.
 */
function slotPosition(slotIndex) {
  const col = slotIndex % DESK_COLS;
  const row = Math.floor(slotIndex / DESK_COLS);
  const x = GRID_MARGIN_X + col * CELL_W + CELL_W / 2;
  const y = GRID_MARGIN_Y + row * (CELL_H + CORRIDOR_GAP) + CELL_H / 2;
  return { x, y };
}

/**
 * Initialize the PixiJS office.
 * @param {HTMLCanvasElement} canvas
 * @param {DashboardState} state
 * @returns {Promise<void>}
 */
export async function init(canvas, state) {
  if (app) return; // Already initialized
  stateRef = state;

  app = new PIXI.Application();
  await app.init({
    canvas,
    width: CANVAS_W,
    height: CANVAS_H,
    background: 0x0a0a0f,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  // Environment layer (behind everything)
  environment = new Environment(CANVAS_W, CANVAS_H);
  app.stage.addChild(environment.container);

  // Pipeline layer (between desk rows)
  pipeline = new Pipeline();
  app.stage.addChild(pipeline.container);

  // Leaderboard overlay (top-right corner, above desks)
  leaderboardOverlay = new LeaderboardOverlay(CANVAS_W);
  app.stage.addChild(leaderboardOverlay.container);

  // Interactions (DOM overlays + speech bubbles)
  interactions = new Interactions(state);
  interactions.setTicker(app.ticker);

  // Canvas interaction events
  app.stage.eventMode = 'static';
  app.stage.hitArea = new PIXI.Rectangle(0, 0, CANVAS_W, CANVAS_H);

  app.stage.on('pointermove', (e) => {
    const pos = e.global;
    // Check if hovering over any agent desk
    let hoveredAgent = null;
    for (const [agentId, slot] of agentSlots) {
      const sp = slotPosition(slot.slotIndex);
      const dx = pos.x - sp.x;
      const dy = pos.y - sp.y;
      if (Math.abs(dx) < CELL_W / 2 - 10 && Math.abs(dy) < CELL_H / 2 + 10) {
        hoveredAgent = agentId;
        break;
      }
    }

    if (hoveredAgent) {
      // Convert to DOM coordinates
      const canvasRect = canvas.getBoundingClientRect();
      const scaleX = canvasRect.width / CANVAS_W;
      const scaleY = canvasRect.height / CANVAS_H;
      const domX = pos.x * scaleX;
      const domY = pos.y * scaleY;
      interactions.onDeskHover(hoveredAgent, domX, domY);
    } else {
      interactions.onDeskHoverEnd();
    }
  });

  app.stage.on('pointerdown', (e) => {
    const pos = e.global;

    // Check pipeline step click
    const stepIdx = pipeline.hitTestStep(pos.x, pos.y);
    if (stepIdx >= 0) {
      const agentId = pipeline.getAgentAtStep(stepIdx);
      if (agentId) {
        interactions.onPipelineStepClick(agentId);
      }
      return;
    }

    // Check agent desk click
    for (const [agentId, slot] of agentSlots) {
      const sp = slotPosition(slot.slotIndex);
      const dx = pos.x - sp.x;
      const dy = pos.y - sp.y;
      if (Math.abs(dx) < CELL_W / 2 - 10 && Math.abs(dy) < CELL_H / 2 + 10) {
        interactions.onAgentClick(agentId);
        return;
      }
    }
  });

  // 60fps animation ticker
  tickerCallback = (ticker) => {
    const dt = ticker.deltaTime;
    const dtMs = dt * 16.67;

    environment.tick(dt);
    pipeline.tick(dt);
    interactions.tick(dtMs);

    for (const [agentId, slot] of agentSlots) {
      slot.character.tick(dt);
      slot.desk.tick(dt);

      // Smooth flash effect from pipeline step click (sine wave, not binary switch)
      if (interactions.isFlashing(agentId)) {
        slot.character.container.alpha = 0.95 + Math.sin(Date.now() * 0.01) * 0.05;
      } else {
        // Lerp alpha back to 1 smoothly instead of instant snap
        slot.character.container.alpha += (1 - slot.character.container.alpha) * 0.15;
      }
    }
  };

  app.ticker.add(tickerCallback);

  // Handle canvas resize
  _handleResize(canvas);

  // Initial draw with current state
  update(state);
}

/**
 * Update the office with new agent/chain data.
 * Called on every state change.
 */
export function update(state) {
  if (!app) return;
  stateRef = state;

  const agents = state.agents || [];

  // Assign new agents to slots
  for (const agent of agents) {
    if (!agentSlots.has(agent.agentId) && agentOrder.length < MAX_AGENTS) {
      _addAgent(agent);
    }
  }

  // Update existing agents
  for (const agent of agents) {
    const slot = agentSlots.get(agent.agentId);
    if (slot) {
      slot.character.update(agent);
      slot.desk.setStatus(agent.status || 'idle');
    }
  }

  // Update environment
  const agentsForEnv = [];
  for (let i = 0; i < MAX_AGENTS; i++) {
    const agentId = agentOrder[i];
    if (agentId) {
      const agent = agents.find((a) => a.agentId === agentId);
      agentsForEnv.push(agent || { agentId, status: 'idle' });
    } else {
      agentsForEnv.push(null);
    }
  }
  environment.updateAgentStates(agentsForEnv.filter(Boolean));

  // Cable endpoints
  const deskPositions = [];
  for (let i = 0; i < agentOrder.length; i++) {
    const pos = slotPosition(i);
    deskPositions.push({
      x: pos.x,
      y: pos.y + CELL_H / 2 - 20,
      agentId: agentOrder[i],
    });
  }
  environment.setCableEndpoints(deskPositions);

  // Pipeline
  pipeline.setDeskPositions(deskPositions);
  pipeline.update(state.chains);

  // Leaderboard overlay
  if (leaderboardOverlay) {
    leaderboardOverlay.update(state.leaderboard);
  }

  // Update interactions — agent discussions + detail panel
  interactions.updateAgents(agents);
  interactions.refreshPanel();
}

function _addAgent(agentData) {
  const slotIndex = agentOrder.length;
  agentOrder.push(agentData.agentId);

  const color = parseInt(getAgentColor(agentData.agentId).replace('#', ''), 16);
  const pos = slotPosition(slotIndex);

  // Create desk
  const desk = new Desk(color, slotIndex);
  desk.layout(pos.x, pos.y + 25); // desk surface lower in cell
  desk.setStatus(agentData.status || 'idle');
  app.stage.addChild(desk.container);

  // Create character (positioned above desk)
  const character = new AgentCharacter(agentData, slotIndex);
  character.container.position.set(pos.x, pos.y - 5);
  app.stage.addChild(character.container);

  agentSlots.set(agentData.agentId, { character, desk, slotIndex });

  // Register container with interactions for speech bubbles
  if (interactions) {
    interactions.setAgentContainer(agentData.agentId, character.container);
  }
}

function _handleResize(canvas) {
  const resizeObserver = new ResizeObserver(() => {
    const parent = canvas.parentElement;
    if (!parent) return;

    const pw = parent.clientWidth;
    const ph = parent.clientHeight - 80; // account for timeline overlay

    // Scale canvas to fit while maintaining aspect ratio
    const scale = Math.min(pw / CANVAS_W, ph / CANVAS_H, 1);
    canvas.style.width = `${CANVAS_W * scale}px`;
    canvas.style.height = `${CANVAS_H * scale}px`;
  });

  resizeObserver.observe(canvas.parentElement);
}

/**
 * Clean up and destroy the office.
 */
export function destroy() {
  if (tickerCallback && app) {
    app.ticker.remove(tickerCallback);
    tickerCallback = null;
  }

  for (const [, slot] of agentSlots) {
    slot.character.destroy();
    slot.desk.destroy();
  }
  agentSlots.clear();
  agentOrder = [];

  if (environment) {
    environment.destroy();
    environment = null;
  }
  if (pipeline) {
    pipeline.destroy();
    pipeline = null;
  }
  if (leaderboardOverlay) {
    leaderboardOverlay.destroy();
    leaderboardOverlay = null;
  }
  if (interactions) {
    interactions.destroy();
    interactions = null;
  }
  if (app) {
    app.destroy(true);
    app = null;
  }
}
