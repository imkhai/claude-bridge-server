// Agent character class — procedural face drawing, personality system,
// behavior state machine, coffee breaks, sleeping Zs, and rich animations.
// PixiJS 8 API. Inspired by Hive OfficeSimulation visual quality.
import { getAgentColor, abbreviateId } from '../state.mjs';

const PIXI = window.PIXI;

// ── Constants ────────────────────────────────────────────────────────────────
const SKIN_TONES = [0xd4a574, 0xc68c5b, 0xe0b893, 0xb87a4b, 0xf0c8a0, 0xa0694e, 0xdeb896, 0xc49a6c];
const HEAD_RADIUS = 13;
const BEHAVIOR_TRANSITION_MS = 300;
const BEHAVIOR_GAP = [500, 1500];
const BEHAVIOR_DURATIONS = {
  monitor:    [3000, 6000],
  look_away:  [1000, 1500],
  think_pause:[1200, 1800],
  lean_forward:[4000, 6000],
  look_around:[4000, 5000],
};
const COFFEE_DRINK_MS = 4000;
const COFFEE_CHANCE_PER_TICK = 0.00015; // ~once per 30-60s at 60fps
const SLEEP_Z_INTERVAL = 800;
const SLEEP_Z_LIFETIME = 2400;
const TRANSITION_OK_MS = 500;
const TRANSITION_SETTLE_MS = 200;

// ── Personality System ───────────────────────────────────────────────────────
// Deterministic personality based on agent ID hash
function personalityForAgent(agentId) {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = (hash * 37 + agentId.charCodeAt(i)) | 0;
  const types = ['nice', 'neutral', 'grumpy'];
  return types[Math.abs(hash) % types.length];
}

function skinForAgent(agentId) {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  return SKIN_TONES[Math.abs(hash) % SKIN_TONES.length];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function rr(min, max) { return min + Math.random() * (max - min); }
function easeIO(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function darken(hex, a) {
  return (Math.floor(((hex >> 16) & 0xff) * (1 - a)) << 16) |
         (Math.floor(((hex >> 8) & 0xff) * (1 - a)) << 8) |
         Math.floor((hex & 0xff) * (1 - a));
}

// ── Behavior System ──────────────────────────────────────────────────────────
function pickBehavior() {
  const r = Math.random();
  if (r < 0.60) return 'monitor';
  if (r < 0.75) return 'look_away';
  if (r < 0.85) return 'think_pause';
  if (r < 0.95) return 'lean_forward';
  return 'look_around';
}

function initBehavior(ms) {
  const d = rr(3000, 6000);
  return {
    current: 'monitor', startedAt: ms, duration: d,
    nextAt: ms + d + rr(...BEHAVIOR_GAP),
    transitioning: false, transitionElapsed: 0,
    prevHeadX: 0, prevHeadRot: 0, prevBodyY: 0, prevFaceX: 0,
  };
}

function getBPose(type, elapsed) {
  switch (type) {
    case 'monitor':      return { headX: 3, headRot: -0.08, bodyY: 0, faceX: 1, typing: 1 };
    case 'look_away':    return { headX: -4, headRot: 0.2, bodyY: 0, faceX: -2, typing: 0.3 };
    case 'think_pause':  return { headX: 0, headRot: 0.05, bodyY: -3, faceX: 0, typing: 0.1 };
    case 'lean_forward': return { headX: 6, headRot: -0.12, bodyY: -4, faceX: 2, typing: 1.3 };
    case 'look_around': {
      const cy = (elapsed % 2000) / 2000;
      let sr, sx;
      if (cy < 0.25)      { const t = cy / 0.25; sr = -0.25 * t; sx = -5 * t; }
      else if (cy < 0.5)  { const t = (cy - 0.25) / 0.25; sr = -0.25 * (1 - t); sx = -5 * (1 - t); }
      else if (cy < 0.75) { const t = (cy - 0.5) / 0.25; sr = 0.25 * t; sx = 5 * t; }
      else                 { const t = (cy - 0.75) / 0.25; sr = 0.25 * (1 - t); sx = 5 * (1 - t); }
      return { headX: sx, headRot: sr, bodyY: 0, faceX: sx * 0.3, typing: 0 };
    }
    default: return { headX: 0, headRot: 0, bodyY: 0, faceX: 0, typing: 1 };
  }
}

// ── Face Drawing Functions ───────────────────────────────────────────────────
// Each draws into a PIXI.Graphics, positioned relative to head center.

function drawFaceActiveNice(g) {
  // Wide focused eyes with white sclera + dark pupil
  g.roundRect(-7, -12, 5, 4, 1).fill(0xffffff);
  g.roundRect(-6, -11.5, 3, 3, 0.5).fill(0x1a1e2e);
  g.roundRect(2, -12, 5, 4, 1).fill(0xffffff);
  g.roundRect(3, -11.5, 3, 3, 0.5).fill(0x1a1e2e);
  // Focused brows
  g.moveTo(-8, -15).lineTo(-2, -15).stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.6 });
  g.moveTo(2, -15).lineTo(8, -15).stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.6 });
  // Concentration line mouth
  g.moveTo(-3, -4).lineTo(3, -4).stroke({ color: 0x1a1e2e, width: 1.2 });
}

function drawFaceActiveNeutral(g) {
  // Narrowed eyes
  g.roundRect(-7, -11, 5, 2.5, 1).fill(0xffffff);
  g.roundRect(-6, -10.5, 3, 2, 0.5).fill(0x1a1e2e);
  g.roundRect(2, -11, 5, 2.5, 1).fill(0xffffff);
  g.roundRect(3, -10.5, 3, 2, 0.5).fill(0x1a1e2e);
  // Flat brows
  g.moveTo(-8, -14).lineTo(-2, -14).stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.6 });
  g.moveTo(2, -14).lineTo(8, -14).stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.6 });
  // Flat mouth
  g.moveTo(-3, -4).lineTo(3, -4).stroke({ color: 0x1a1e2e, width: 1.2 });
}

function drawFaceActiveGrumpy(g) {
  // Narrowed, angry eyes
  g.roundRect(-7, -11, 5, 3, 1).fill(0xffffff);
  g.roundRect(-6, -10.5, 3, 2, 0.5).fill(0x1a1e2e);
  g.roundRect(2, -11, 5, 3, 1).fill(0xffffff);
  g.roundRect(3, -10.5, 3, 2, 0.5).fill(0x1a1e2e);
  // Furrowed brows — angled inward
  g.moveTo(-8, -13).lineTo(-2, -14.5).stroke({ color: 0x1a1e2e, width: 2, alpha: 0.7 });
  g.moveTo(2, -14.5).lineTo(8, -13).stroke({ color: 0x1a1e2e, width: 2, alpha: 0.7 });
  // Thin pressed frown
  g.moveTo(-4, -3.5).lineTo(4, -3.5).stroke({ color: 0x1a1e2e, width: 2 });
}

function drawFaceIdleNice(g, animTime) {
  // Sleepy droopy eyes
  const blink = Math.sin(animTime * 0.08);
  const eyeH = blink > 0.95 ? 0.5 : 2.5; // occasional blink
  g.moveTo(-7, -10).quadraticCurveTo(-5, -10 - eyeH, -2, -10)
    .stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.7 });
  g.moveTo(2, -10).quadraticCurveTo(5, -10 - eyeH, 8, -10)
    .stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.7 });
  // Yawning mouth when idle for a while
  const yawnCycle = Math.sin(animTime * 0.03);
  if (yawnCycle > 0.9) {
    // Yawn — open O mouth
    g.circle(0, -3, 3).stroke({ color: 0x1a1e2e, width: 1.2 });
  } else {
    // Gentle smile
    g.moveTo(-3, -5).quadraticCurveTo(0, -2, 3, -5)
      .stroke({ color: 0x1a1e2e, width: 1 });
  }
}

function drawFaceIdleNeutral(g) {
  // Half-height eyes
  g.roundRect(-7, -11, 5, 2.5, 1).fill(0xffffff);
  g.roundRect(-6, -10.5, 3, 1.5, 0.5).fill(0x1a1e2e);
  g.roundRect(2, -11, 5, 2.5, 1).fill(0xffffff);
  g.roundRect(3, -10.5, 3, 1.5, 0.5).fill(0x1a1e2e);
  // Flat mouth
  g.moveTo(-3, -4).lineTo(3, -4).stroke({ color: 0x1a1e2e, width: 1.2, alpha: 0.7 });
}

function drawFaceIdleGrumpy(g) {
  // Narrowed, slightly closed eyes
  g.moveTo(-7, -10).quadraticCurveTo(-5, -12, -2, -10)
    .stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.7 });
  g.moveTo(2, -10).quadraticCurveTo(5, -12, 8, -10)
    .stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.7 });
  // Asymmetric brows — left lower
  g.moveTo(-8, -12).lineTo(-2, -13).stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.5 });
  g.moveTo(2, -14).lineTo(8, -14).stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.5 });
  // Frown
  g.moveTo(-3, -3).quadraticCurveTo(0, -5.5, 3, -3)
    .stroke({ color: 0x1a1e2e, width: 1.2 });
}

function drawFaceThinking(g) {
  // Round wide eyes with pupils
  g.circle(-5, -10, 2.5).fill(0xffffff);
  g.circle(-5, -10, 1.5).fill(0x1a1e2e);
  g.circle(5, -10, 2.5).fill(0xffffff);
  g.circle(5, -10, 1.5).fill(0x1a1e2e);
  // Raised brow on one side
  g.moveTo(-8, -14).lineTo(-2, -14).stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.6 });
  g.moveTo(2, -16).lineTo(8, -14).stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.6 });
  // Wavy mouth
  g.moveTo(-3, -4).quadraticCurveTo(0, -6, 3, -4)
    .stroke({ color: 0x1a1e2e, width: 1.2 });
}

function drawFaceError(g) {
  // X eyes
  g.moveTo(-7, -12).lineTo(-3, -8).stroke({ color: 0xf85149, width: 2 });
  g.moveTo(-3, -12).lineTo(-7, -8).stroke({ color: 0xf85149, width: 2 });
  g.moveTo(3, -12).lineTo(7, -8).stroke({ color: 0xf85149, width: 2 });
  g.moveTo(7, -12).lineTo(3, -8).stroke({ color: 0xf85149, width: 2 });
  // Zigzag mouth
  g.moveTo(-6, -3).lineTo(-3, -1).lineTo(0, -4).lineTo(3, -1).lineTo(6, -3)
    .stroke({ color: 0x1a1e2e, width: 1.2 });
}

function drawFaceWaiting(g) {
  // Side-looking eyes — pupils shifted right
  g.circle(-5, -10, 2.5).fill(0xffffff);
  g.circle(-3.5, -10, 1.5).fill(0x1a1e2e);
  g.circle(5, -10, 2.5).fill(0xffffff);
  g.circle(6.5, -10, 1.5).fill(0x1a1e2e);
  // Neutral brows
  g.moveTo(-8, -14).lineTo(-2, -15).stroke({ color: 0x1a1e2e, width: 1.2, alpha: 0.5 });
  g.moveTo(2, -14).lineTo(8, -14).stroke({ color: 0x1a1e2e, width: 1.2, alpha: 0.5 });
  // Flat mouth
  g.moveTo(-3, -4).lineTo(3, -4).stroke({ color: 0x1a1e2e, width: 1.2, alpha: 0.7 });
}

function drawFaceDone(g) {
  // Sparkle/star eyes
  g.circle(-5, -10, 3).fill(0x1a1e2e);
  g.circle(-5, -10, 1.5).fill(0xffffff); // sparkle center
  g.circle(-4, -11, 0.8).fill(0xffffff); // highlight
  g.circle(5, -10, 3).fill(0x1a1e2e);
  g.circle(5, -10, 1.5).fill(0xffffff);
  g.circle(6, -11, 0.8).fill(0xffffff);
  // Wide smile
  g.arc(0, -5, 6, 0.3, Math.PI - 0.3).stroke({ color: 0x1a1e2e, width: 1.5 });
}

function drawFaceOkReaction(g) {
  // Wide surprised eyes — big circle eyes with O mouth
  g.circle(-5, -10, 3.5).fill(0xffffff);
  g.circle(-5, -10, 2).fill(0x1a1e2e);
  g.circle(-6, -11.5, 0.8).fill({ color: 0xffffff, alpha: 0.9 });
  g.circle(5, -10, 3.5).fill(0xffffff);
  g.circle(5, -10, 2).fill(0x1a1e2e);
  g.circle(4, -11.5, 0.8).fill({ color: 0xffffff, alpha: 0.9 });
  // Raised brows
  g.moveTo(-8, -16).quadraticCurveTo(-5, -19, -2, -16)
    .stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.8 });
  g.moveTo(2, -16).quadraticCurveTo(5, -19, 8, -16)
    .stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.8 });
  // O mouth
  g.circle(0, -3.5, 3).stroke({ color: 0x1a1e2e, width: 1.5 });
  g.circle(0, -3.5, 2).fill({ color: 0x1a1e2e, alpha: 0.4 });
}

function drawFaceQueued(g) {
  // Looking sideways (waiting)
  g.circle(-5 + 2, -10, 2).fill(0x1a1e2e);
  g.circle(5 + 2, -10, 2).fill(0x1a1e2e);
  // Flat mouth
  g.moveTo(-4, -4).lineTo(4, -4).stroke({ color: 0x1a1e2e, width: 1 });
}

function drawFaceSleeping(g) {
  // Closed eyes (horizontal lines)
  g.moveTo(-7, -10).lineTo(-3, -10).stroke({ color: 0x1a1e2e, width: 1.2, alpha: 0.6 });
  g.moveTo(3, -10).lineTo(7, -10).stroke({ color: 0x1a1e2e, width: 1.2, alpha: 0.6 });
  // Relaxed mouth
  g.circle(0, -4, 1).fill({ color: 0x1a1e2e, alpha: 0.4 });
}

// Composite face drawer based on status + personality
function drawFace(g, status, personality, animTime) {
  switch (status) {
    case 'active':
      if (personality === 'grumpy') drawFaceActiveGrumpy(g);
      else if (personality === 'neutral') drawFaceActiveNeutral(g);
      else drawFaceActiveNice(g);
      break;
    case 'idle':
      if (personality === 'grumpy') drawFaceIdleGrumpy(g);
      else if (personality === 'neutral') drawFaceIdleNeutral(g);
      else drawFaceIdleNice(g, animTime);
      break;
    case 'thinking':  drawFaceThinking(g); break;
    case 'error':     drawFaceError(g); break;
    case 'waiting':   drawFaceWaiting(g); break;
    case 'done':      drawFaceDone(g); break;
    case 'queued':    drawFaceQueued(g); break;
    case 'sleeping':  drawFaceSleeping(g); break;
    default:          drawFaceIdleNeutral(g); break;
  }
}

// ── Sweat Drop particles (for error state) ───────────────────────────────────
function createSweatDrop(container, x, y, delay) {
  return { x, y, baseX: x, baseY: y, alpha: 0, life: -delay, container };
}

function updateSweatDrops(drops, dtMs, animTime, effectsContainer) {
  for (const drop of drops) {
    drop.life += dtMs;
    if (drop.life < 0) continue;
    const t = (drop.life % 1500) / 1500;
    drop.x = drop.baseX + Math.sin(animTime * 3 + drop.baseX) * 1.5;
    drop.y = drop.baseY - t * 12;
    drop.alpha = t < 0.2 ? t / 0.2 : t > 0.7 ? (1 - t) / 0.3 : 1;
  }
}

function drawSweatDrops(drops, gfx) {
  for (const drop of drops) {
    if (drop.alpha <= 0) continue;
    // Teardrop shape
    gfx.ellipse(drop.x, drop.y + 1, 2, 3).fill({ color: 0x60a5fa, alpha: drop.alpha * 0.7 });
    gfx.moveTo(drop.x, drop.y - 3).lineTo(drop.x - 1.5, drop.y).lineTo(drop.x + 1.5, drop.y)
      .closePath().fill({ color: 0x60a5fa, alpha: drop.alpha * 0.7 });
    // Highlight
    gfx.ellipse(drop.x - 0.5, drop.y, 0.8, 1.2).fill({ color: 0xbfdbfe, alpha: drop.alpha * 0.4 });
  }
}

// ── Sleeping Z Particles ─────────────────────────────────────────────────────
function createZParticle(x, y) {
  return { x, y, baseX: x, alpha: 0, size: 6 + Math.random() * 4, life: 0 };
}

function updateZParticles(particles, dtMs) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const z = particles[i];
    z.life += dtMs;
    const t = z.life / SLEEP_Z_LIFETIME;
    z.y -= dtMs * 0.012; // float upward
    z.x = z.baseX + Math.sin(z.life * 0.003) * 4; // horizontal drift
    z.alpha = t < 0.15 ? t / 0.15 : t > 0.7 ? (1 - t) / 0.3 : 0.8;
    if (t >= 1) particles.splice(i, 1);
  }
}

function drawZParticles(particles, gfx) {
  for (const z of particles) {
    if (z.alpha <= 0) continue;
    const txt = new PIXI.Text({
      text: 'Z',
      style: {
        fontFamily: 'monospace', fontSize: z.size, fill: 0x8b9cc7,
        fontWeight: 'bold',
      },
    });
    txt.anchor.set(0.5, 0.5);
    txt.position.set(z.x, z.y);
    txt.alpha = z.alpha;
    txt.rotation = Math.sin(z.life * 0.002) * 0.3;
    gfx.addChild(txt);
  }
}

// ── Finger/Hand Detail ───────────────────────────────────────────────────────
function drawFingerDots(gfx, animTime, typingIntensity) {
  if (typingIntensity <= 0.1) return;
  const speed = animTime * 0.5 * typingIntensity;
  // Left hand fingers — 3 dots
  const ly = 30 + Math.sin(speed + 1) * 2;
  const lx = -18;
  gfx.circle(lx - 2, ly, 1.3).fill({ color: 0xddccbb, alpha: 0.85 });
  gfx.circle(lx, ly + 1.5, 1.3).fill({ color: 0xddccbb, alpha: 0.85 });
  gfx.circle(lx + 2, ly - 0.5, 1.3).fill({ color: 0xddccbb, alpha: 0.85 });

  // Right hand fingers — 3 dots (offset phase)
  const ry = 30 + Math.sin(speed + 3) * 2;
  const rx = 18;
  gfx.circle(rx - 2, ry - 0.5, 1.3).fill({ color: 0xddccbb, alpha: 0.85 });
  gfx.circle(rx, ry + 1, 1.3).fill({ color: 0xddccbb, alpha: 0.85 });
  gfx.circle(rx + 2, ry, 1.3).fill({ color: 0xddccbb, alpha: 0.85 });
}

// ── Coffee Break System ──────────────────────────────────────────────────────
// Simplified: walk to a corridor position, drink, walk back.
// Phases: to_corridor → drinking → back_desk
const COFFEE_CORRIDOR_OFFSET_Y = 55;

function startCoffeeBreak(char) {
  if (char.coffeeBreak) return;
  char.coffeeBreak = {
    active: true,
    phase: 'to_corridor',
    timer: 0,
    origX: char.container.position.x,
    origY: char.container.position.y,
    targetX: char.container.position.x + 35,
    targetY: char.container.position.y + COFFEE_CORRIDOR_OFFSET_Y,
  };
  char._coffeeBubbleShown = false;
}

function updateCoffeeBreak(char, dtMs) {
  if (!char.coffeeBreak || !char.coffeeBreak.active) return false;
  const cb = char.coffeeBreak;
  const speed = 1.2;

  if (cb.phase === 'drinking') {
    cb.timer += dtMs;
    // Bob while drinking
    char.container.position.y = cb.targetY + Math.sin(Date.now() / 300) * 2;
    if (!char._coffeeBubbleShown) {
      char._coffeeBubbleShown = true;
      char._showBubble('☕');
    }
    if (cb.timer >= COFFEE_DRINK_MS) {
      cb.phase = 'back_desk';
      cb.targetX = cb.origX;
      cb.targetY = cb.origY;
    }
    return true;
  }

  // Walk toward target
  const dx = cb.targetX - char.container.position.x;
  const dy = cb.targetY - char.container.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < speed + 1) {
    char.container.position.x = cb.targetX;
    char.container.position.y = cb.targetY;

    if (cb.phase === 'to_corridor') {
      cb.phase = 'drinking';
      cb.timer = 0;
    } else if (cb.phase === 'back_desk') {
      char.coffeeBreak = null;
      char._coffeeBubbleShown = false;
      return false;
    }
  } else {
    char.container.position.x += (dx / dist) * speed;
    char.container.position.y += (dy / dist) * speed;
    // Walking arm swing
    const wt = Date.now() / 200;
    char._walkArmPhase = wt;
  }
  return true;
}

// ── Main Character Class ─────────────────────────────────────────────────────
export class AgentCharacter {
  constructor(agentData, slotIndex) {
    this.agentId = agentData.agentId;
    this.status = agentData.status || 'idle';
    this.prompt = agentData.currentPrompt || '';
    this.duration = agentData.duration || 0;
    this.completedTasks = agentData.completedTasks || 0;
    this.startedAt = agentData.startedAt || null;
    this.lastActiveAt = agentData.lastActiveAt || null;
    this.currentTaskId = agentData.currentTaskId || null;
    this.slotIndex = slotIndex;
    this.color = parseInt(getAgentColor(this.agentId).replace('#', ''), 16);
    this.colorHex = getAgentColor(this.agentId);
    this.skinTone = skinForAgent(this.agentId);
    this.personality = personalityForAgent(this.agentId);

    // Animation state
    this.animTime = 0;
    this.animTimeMs = 0;
    this.prevStatus = null;
    this.phase = Math.random() * Math.PI * 2;

    // Behavior state machine
    this.behavior = null;
    this._typingIntensity = 0;

    // Transition system
    this.transitionState = null; // 'ok_reaction' | 'settling' | null
    this.transitionElapsed = 0;

    // Celebration
    this.celebrationTimer = 0;

    // Error shake & sweat
    this.shakeOffset = 0;
    this.sweatDrops = [
      createSweatDrop(null, 14, -14, 0),
      createSweatDrop(null, 18, -8, 200),
      createSweatDrop(null, 12, -4, 400),
    ];

    // Sleeping Z particles
    this.zParticles = [];
    this.zSpawnTimer = 0;

    // Coffee break
    this.coffeeBreak = null;
    this._coffeeBubbleShown = false;
    this._coffeeTimer = rr(30000, 60000); // initial delay before first possible coffee
    this._walkArmPhase = 0;

    // Speech bubble
    this.bubbleText = '';
    this.bubbleTarget = '';
    this.bubbleCharIndex = 0;
    this.bubbleTimer = 0;
    this.bubbleVisible = false;
    this.bubbleDuration = 0;

    // Status change spring scale
    this._springScale = 1;
    this._springVel = 0;

    // Body bob
    this._bodyBobPhase = Math.random() * Math.PI * 2;

    // Container hierarchy
    this.container = new PIXI.Container();
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';

    this.bodyContainer = new PIXI.Container();
    this.headContainer = new PIXI.Container();
    this.armsContainer = new PIXI.Container();
    this.faceContainer = new PIXI.Container();
    this.fingerContainer = new PIXI.Container();
    this.bubbleContainer = new PIXI.Container();
    this.labelContainer = new PIXI.Container();
    this.effectsContainer = new PIXI.Container();
    this.zContainer = new PIXI.Container();

    this.container.addChild(this.bodyContainer);
    this.container.addChild(this.armsContainer);
    this.container.addChild(this.fingerContainer);
    this.container.addChild(this.headContainer);
    this.container.addChild(this.faceContainer);
    this.container.addChild(this.effectsContainer);
    this.container.addChild(this.zContainer);
    this.container.addChild(this.bubbleContainer);
    this.container.addChild(this.labelContainer);

    // ── Persistent Graphics objects — cleared each tick, never destroyed/recreated ──
    this._bodyGfx = new PIXI.Graphics();
    this._armsGfx = new PIXI.Graphics();
    this._headGfx = new PIXI.Graphics();
    this._faceGfx = new PIXI.Graphics();
    this._fingerGfx = new PIXI.Graphics();
    this._sweatGfx = new PIXI.Graphics();
    this._effectsGfx = new PIXI.Graphics();
    this._statusDotGfx = new PIXI.Graphics();
    this._bubbleBg = new PIXI.Graphics();
    this._bubbleTextObj = new PIXI.Text({
      text: '',
      style: { fontFamily: 'monospace', fontSize: 8, fill: 0xe6edf3, wordWrap: true, wordWrapWidth: 80 },
    });

    this.bodyContainer.addChild(this._bodyGfx);
    this.armsContainer.addChild(this._armsGfx);
    this.headContainer.addChild(this._headGfx);
    this.faceContainer.addChild(this._faceGfx);
    this.fingerContainer.addChild(this._fingerGfx);
    this.effectsContainer.addChild(this._sweatGfx);
    this.effectsContainer.addChild(this._effectsGfx);
    this.bubbleContainer.addChild(this._bubbleBg);
    this.bubbleContainer.addChild(this._bubbleTextObj);

    // Z particle text pool (max 4 visible at once)
    this._zTextPool = [];
    for (let i = 0; i < 4; i++) {
      const zt = new PIXI.Text({
        text: 'Z',
        style: { fontFamily: 'monospace', fontSize: 8, fill: 0x8b9cc7, fontWeight: 'bold' },
      });
      zt.anchor.set(0.5, 0.5);
      zt.visible = false;
      this.zContainer.addChild(zt);
      this._zTextPool.push(zt);
    }

    // Thought bubble dots text (persistent)
    this._thoughtDotsText = new PIXI.Text({
      text: '',
      style: { fontFamily: 'monospace', fontSize: 10, fill: 0xcccccc },
    });
    this._thoughtDotsText.visible = false;
    this.effectsContainer.addChild(this._thoughtDotsText);

    this._drawLabel();
    this.labelContainer.addChild(this._statusDotGfx);
    this.redraw();
  }

  // ── Label ────────────────────────────────────────────────────────────────
  _drawLabel() {
    this.labelContainer.removeChildren();
    const name = new PIXI.Text({
      text: abbreviateId(this.agentId),
      style: { fontFamily: 'monospace', fontSize: 10, fill: this.color },
    });
    name.anchor.set(0.5, 0);
    name.position.set(0, 42);
    this.labelContainer.addChild(name);
  }

  // ── Show speech bubble ───────────────────────────────────────────────────
  _showBubble(text) {
    this.bubbleTarget = text.length > 40 ? text.slice(0, 37) + '...' : text;
    this.bubbleCharIndex = 0;
    this.bubbleText = '';
    this.bubbleTimer = 0;
    this.bubbleVisible = true;
    this.bubbleDuration = 0;
  }

  // ── Update from external data ────────────────────────────────────────────
  update(agentData) {
    this.prevStatus = this.status;
    this.status = agentData.status || 'idle';
    this.prompt = agentData.currentPrompt || '';
    this.duration = agentData.duration || 0;
    this.completedTasks = agentData.completedTasks || 0;
    this.startedAt = agentData.startedAt || null;
    this.lastActiveAt = agentData.lastActiveAt || null;
    this.currentTaskId = agentData.currentTaskId || null;

    // Status change reactions
    if (this.prevStatus !== this.status) {
      this._onStatusChange();
    }

    // Speech bubble for active agents
    if (this.status === 'active' && this.prompt && !this.bubbleVisible) {
      this._showBubble(this.prompt);
    } else if (this.status !== 'active' && this.status !== 'done') {
      this.bubbleVisible = false;
    }

    this.redraw();
  }

  _onStatusChange() {
    // Spring scale bounce on status change
    this._springScale = 1.12;
    this._springVel = 0;

    // Trigger celebration on done
    if (this.prevStatus === 'active' && this.status === 'done') {
      this.celebrationTimer = 1500;
    }

    // Ok reaction transition: idle/queued → active
    if (this.status === 'active' && (this.prevStatus === 'idle' || this.prevStatus === 'queued')) {
      this.transitionState = 'ok_reaction';
      this.transitionElapsed = 0;
    }

    // Reset behavior on status change
    this.behavior = null;
  }

  // ── Tick — called every frame ────────────────────────────────────────────
  tick(dt) {
    const dtMs = dt * 16.67;
    this.animTime += dt;
    this.animTimeMs += dtMs;

    const isActive = this.status === 'active';
    const isIdle = this.status === 'idle';
    const isError = this.status === 'error';

    // ── Spring scale animation ───────────────────────────────────────────
    if (Math.abs(this._springScale - 1) > 0.001) {
      const k = 0.15, d = 0.7;
      this._springVel += (1 - this._springScale) * k;
      this._springVel *= d;
      this._springScale += this._springVel;
    } else {
      this._springScale = 1;
    }

    // ── Transition animations ────────────────────────────────────────────
    if (this.transitionState) {
      this.transitionElapsed += dtMs;
      if (this.transitionState === 'ok_reaction') {
        if (this.transitionElapsed >= TRANSITION_OK_MS) {
          this.transitionState = 'settling';
          this.transitionElapsed = 0;
        }
      } else if (this.transitionState === 'settling') {
        if (this.transitionElapsed >= TRANSITION_SETTLE_MS) {
          this.transitionState = null;
          this.transitionElapsed = 0;
        }
      }
    }

    // ── Behavior state machine for active agents ─────────────────────────
    if (isActive && !this.transitionState) {
      if (!this.behavior) this.behavior = initBehavior(this.animTimeMs);
      const s = this.behavior;
      if (this.animTimeMs >= s.nextAt) {
        // Schedule next behavior with transition
        const next = pickBehavior();
        const [mn, mx] = BEHAVIOR_DURATIONS[next];
        const d = rr(mn, mx);
        s.prevHeadX = this.headContainer.position.x;
        s.prevHeadRot = this.headContainer.rotation;
        s.prevBodyY = this._currentBodyOffset || 0;
        s.prevFaceX = this.faceContainer.position.x;
        s.current = next;
        s.startedAt = this.animTimeMs;
        s.duration = d;
        s.nextAt = this.animTimeMs + d + rr(...BEHAVIOR_GAP);
        s.transitioning = true;
        s.transitionElapsed = 0;
      }
      if (s.transitioning) {
        s.transitionElapsed += dtMs;
        if (s.transitionElapsed >= BEHAVIOR_TRANSITION_MS) s.transitioning = false;
      }
    } else if (!isActive) {
      this.behavior = null;
    }

    // ── Celebration countdown ────────────────────────────────────────────
    if (this.celebrationTimer > 0) {
      this.celebrationTimer = Math.max(0, this.celebrationTimer - dtMs);
    }

    // ── Error shake ──────────────────────────────────────────────────────
    if (isError) {
      this.shakeOffset = Math.sin(this.animTime * 0.8) * 2.5;
    } else {
      this.shakeOffset *= 0.9;
      if (Math.abs(this.shakeOffset) < 0.01) this.shakeOffset = 0;
    }

    // ── Sleeping Z particles ─────────────────────────────────────────────
    if (isIdle) {
      this.zSpawnTimer += dtMs;
      if (this.zSpawnTimer >= SLEEP_Z_INTERVAL && this.zParticles.length < 4) {
        this.zSpawnTimer = 0;
        this.zParticles.push(createZParticle(12, -22));
      }
      updateZParticles(this.zParticles, dtMs);
    } else {
      this.zParticles = [];
      this.zSpawnTimer = 0;
    }

    // ── Coffee break for idle agents ─────────────────────────────────────
    if (isIdle && !this.coffeeBreak) {
      this._coffeeTimer -= dtMs;
      if (this._coffeeTimer <= 0) {
        this._coffeeTimer = rr(30000, 60000);
        if (Math.random() < 0.3) { // 30% chance when timer hits
          startCoffeeBreak(this);
        }
      }
    }
    if (this.coffeeBreak) {
      const still = updateCoffeeBreak(this, dtMs);
      if (!still) this.coffeeBreak = null;
    }

    // ── Speech bubble typewriter ─────────────────────────────────────────
    if (this.bubbleVisible && this.bubbleCharIndex < this.bubbleTarget.length) {
      this.bubbleTimer += dtMs;
      if (this.bubbleTimer > 40) {
        this.bubbleTimer = 0;
        this.bubbleCharIndex = Math.min(this.bubbleCharIndex + 1, this.bubbleTarget.length);
        this.bubbleText = this.bubbleTarget.slice(0, this.bubbleCharIndex);
      }
    }
    if (this.bubbleVisible && this.bubbleCharIndex >= this.bubbleTarget.length) {
      this.bubbleDuration += dtMs;
      if (this.bubbleDuration > 8000) {
        this.bubbleVisible = false;
      }
    }

    // ── Body bob (sin wave) ──────────────────────────────────────────────
    this._bodyBobPhase += dt * 0.08;

    this.redraw();
  }

  // ── Redraw everything ────────────────────────────────────────────────────
  redraw() {
    // Clear persistent Graphics — never removeChildren/recreate (prevents flashing)
    this._bodyGfx.clear();
    this._armsGfx.clear();
    this._headGfx.clear();
    this._faceGfx.clear();
    this._fingerGfx.clear();
    this._sweatGfx.clear();
    this._effectsGfx.clear();
    this._statusDotGfx.clear();
    this._bubbleBg.clear();
    this._thoughtDotsText.visible = false;
    // Hide all Z pool texts (re-shown by _drawZParticles if needed)
    for (const zt of this._zTextPool) zt.visible = false;

    const isActive = this.status === 'active';
    const isError = this.status === 'error';
    const isTimeout = this.status === 'timeout';
    const isQueued = this.status === 'queued';
    const isDone = this.status === 'done' || this.celebrationTimer > 0;
    const isIdle = !isActive && !isError && !isTimeout && !isQueued && !isDone;
    const isThinking = this.status === 'thinking' || (isActive && this.behavior?.current === 'think_pause');
    const isWaiting = this.status === 'waiting' || this.status === 'queued';

    // ── Apply spring scale ───────────────────────────────────────────────
    this.bodyContainer.scale.set(this._springScale);
    this.headContainer.scale.set(this._springScale);

    // ── Apply shake ──────────────────────────────────────────────────────
    this.headContainer.position.x = this.shakeOffset;
    this.bodyContainer.position.x = this.shakeOffset;

    // ── Body Y bobbing (sin wave) ────────────────────────────────────────
    let bodyYOffset = 0;
    if (isActive) {
      bodyYOffset = Math.sin(this._bodyBobPhase * 8) * 1.5;
    } else if (isIdle) {
      bodyYOffset = Math.sin(this._bodyBobPhase * 1.5) * 2;
    } else if (isWaiting) {
      bodyYOffset = Math.abs(Math.sin(this._bodyBobPhase * 3)) * 2;
    }
    this._currentBodyOffset = bodyYOffset;

    // ── Behavior-driven head/body transforms ─────────────────────────────
    let headX = 0, headRot = 0, faceX = 0;
    let typingIntensity = isActive ? 1 : 0;

    if (isActive && this.behavior && !this.transitionState) {
      const s = this.behavior;
      const be = this.animTimeMs - s.startedAt;
      const tgt = getBPose(s.current, be);

      if (s.transitioning) {
        const rt = Math.min(s.transitionElapsed / BEHAVIOR_TRANSITION_MS, 1);
        const t = easeIO(rt);
        headX = s.prevHeadX + (tgt.headX - s.prevHeadX) * t;
        headRot = s.prevHeadRot + (tgt.headRot - s.prevHeadRot) * t;
        bodyYOffset = s.prevBodyY + (tgt.bodyY - s.prevBodyY) * t;
        faceX = s.prevFaceX + (tgt.faceX - s.prevFaceX) * t;
        typingIntensity = t * tgt.typing + (1 - t) * 1;
      } else {
        headX = tgt.headX;
        headRot = tgt.headRot;
        bodyYOffset = tgt.bodyY;
        faceX = tgt.faceX;
        typingIntensity = tgt.typing;
      }
    }

    // ── Transition overrides ─────────────────────────────────────────────
    if (this.transitionState === 'ok_reaction') {
      const t = this.transitionElapsed / TRANSITION_OK_MS;
      const sc = t < 0.4 ? 1 + 0.08 * (t / 0.4) : 1.08 - 0.08 * ((t - 0.4) / 0.6);
      this.bodyContainer.scale.set(sc);
      this.headContainer.scale.set(sc);
      bodyYOffset = -(1 - Math.abs(2 * t - 1)) * 6;
    } else if (this.transitionState === 'settling') {
      const t = this.transitionElapsed / TRANSITION_SETTLE_MS;
      headX = 8 * (1 - t);
      headRot = 0;
      faceX = 2 * (1 - t);
    }

    // Apply computed transforms
    this.headContainer.position.x += headX;
    this.headContainer.rotation = headRot;
    this.faceContainer.position.x = faceX;
    this.bodyContainer.position.y = bodyYOffset;
    this.headContainer.position.y = bodyYOffset;
    this.armsContainer.position.y = bodyYOffset;
    this.faceContainer.position.y = bodyYOffset;

    // ── Look away horizontal offset ──────────────────────────────────────
    if (isActive && this.behavior?.current === 'look_away') {
      this.headContainer.position.x += -3;
    }

    // ── Draw body ────────────────────────────────────────────────────────
    this._drawBody(isActive, isIdle, isQueued, isWaiting);
    this._drawArms(isActive, typingIntensity, isIdle);
    this._drawHead(isThinking, isError, isWaiting, isDone);
    this._drawFace(isActive, isError, isTimeout, isQueued, isDone, isIdle, isThinking, isWaiting);
    this._drawFingers(isActive, typingIntensity);
    this._drawEffects(isActive, isError, isDone);
    this._drawZParticles(isIdle);
    this._drawBubble();
    this._drawStatusIndicator();
  }

  // ── Body (torso) ─────────────────────────────────────────────────────────
  _drawBody(isActive, isIdle, isQueued, isWaiting) {
    const body = this._bodyGfx;
    let bodyY = 5;
    if (isIdle || (isActive && this.behavior?.current === 'think_pause')) bodyY = 3;

    if (isActive && this.behavior?.current === 'lean_forward') {
      body.roundRect(-15, bodyY - 2, 30, 28, 6);
    } else {
      body.roundRect(-15, bodyY, 30, 28, 6);
    }
    body.fill(0x2d333b);
    body.stroke({ color: this.color, width: 1, alpha: 0.3 });

    body.moveTo(-6, bodyY + 1).lineTo(0, bodyY + 5).lineTo(6, bodyY + 1)
      .stroke({ color: this.color, width: 0.8, alpha: 0.4 });
  }

  // ── Arms ─────────────────────────────────────────────────────────────────
  _drawArms(isActive, typingIntensity, isIdle) {
    const arms = this._armsGfx;

    if (isActive && typingIntensity > 0.3) {
      // Typing motion — arms move with alternating phase
      const speed = this.animTime * 0.5 * typingIntensity;
      const armBob1 = Math.sin(speed) * 3;
      const armBob2 = Math.sin(speed + 2) * 3;

      // Left arm
      arms.moveTo(-15, 14);
      arms.lineTo(-22, 28 + armBob1);
      arms.stroke({ color: this.skinTone, width: 4 });
      // Hand circle
      arms.circle(-22, 28 + armBob1, 2.5).fill(this.skinTone);

      // Right arm
      arms.moveTo(15, 14);
      arms.lineTo(22, 28 + armBob2);
      arms.stroke({ color: this.skinTone, width: 4 });
      arms.circle(22, 28 + armBob2, 2.5).fill(this.skinTone);
    } else if (isActive && this.behavior?.current === 'think_pause') {
      // One arm on chin
      arms.moveTo(-15, 14);
      arms.lineTo(-20, 28);
      arms.stroke({ color: this.skinTone, width: 4 });
      arms.circle(-20, 28, 2.5).fill(this.skinTone);

      arms.moveTo(15, 14);
      arms.lineTo(8, -2);
      arms.stroke({ color: this.skinTone, width: 4 });
      arms.circle(8, -2, 2.5).fill(this.skinTone);
    } else if (this.coffeeBreak && this.coffeeBreak.active) {
      // Walking arms
      const wt = this._walkArmPhase || 0;
      arms.moveTo(-15, 14);
      arms.lineTo(-20, 28 + Math.sin(wt) * 4);
      arms.stroke({ color: this.skinTone, width: 4 });

      arms.moveTo(15, 14);
      arms.lineTo(20, 28 - Math.sin(wt) * 4);
      arms.stroke({ color: this.skinTone, width: 4 });
    } else {
      // Relaxed arms with gentle sway
      const sway = isIdle ? Math.sin(this.animTime * 0.05) * 1.5 : 0;
      arms.moveTo(-15, 14);
      arms.lineTo(-20 + sway, 30);
      arms.stroke({ color: this.skinTone, width: 4 });
      arms.circle(-20 + sway, 30, 2.5).fill(this.skinTone);

      arms.moveTo(15, 14);
      arms.lineTo(20 - sway, 30);
      arms.stroke({ color: this.skinTone, width: 4 });
      arms.circle(20 - sway, 30, 2.5).fill(this.skinTone);
    }

  }

  // ── Head ─────────────────────────────────────────────────────────────────
  _drawHead(isThinking, isError, isWaiting, isDone) {
    const head = this._headGfx;

    // Head tint based on status
    let headColor = this.skinTone;
    if (isThinking) {
      // Blue tint for thinking
      headColor = 0xdbeafe;
    } else if (isError) {
      // Smooth red tint pulse (not binary flicker)
      const t = (Math.sin(this.animTime * 0.3) + 1) / 2; // 0..1
      const sr = ((this.skinTone >> 16) & 0xff), sg = ((this.skinTone >> 8) & 0xff), sb = (this.skinTone & 0xff);
      const r = Math.round(sr + (0xff - sr) * t * 0.5);
      const g = Math.round(sg + (0xcc - sg) * t * 0.3);
      const b = Math.round(sb + (0xcc - sb) * t * 0.3);
      headColor = (r << 16) | (g << 8) | b;
    } else if (isWaiting) {
      // Warm tint
      headColor = 0xfef3c7;
    }

    head.circle(0, -8, HEAD_RADIUS);
    head.fill(headColor);

    // Cheek highlight
    head.circle(-4, -4, 4).fill({ color: 0xffffff, alpha: 0.15 });

    // Hair (simple arc based on personality)
    const hairColor = darken(this.skinTone, 0.4);
    if (this.personality === 'grumpy') {
      // Short spiky hair
      head.arc(0, -8, HEAD_RADIUS + 1, Math.PI * 1.15, Math.PI * 1.85, false).fill(hairColor);
    } else if (this.personality === 'neutral') {
      // Neat side-parted hair
      head.arc(0, -8, HEAD_RADIUS + 0.5, Math.PI * 1.1, Math.PI * 1.9, false).fill(hairColor);
    } else {
      // Nice — fluffy hair
      head.arc(0, -8, HEAD_RADIUS + 1.5, Math.PI * 1.05, Math.PI * 1.95, false).fill(hairColor);
      head.circle(0, -8 - HEAD_RADIUS - 2, 4).fill(hairColor);
    }

  }

  // ── Face ─────────────────────────────────────────────────────────────────
  _drawFace(isActive, isError, isTimeout, isQueued, isDone, isIdle, isThinking, isWaiting) {
    const face = this._faceGfx;

    if (this.transitionState === 'ok_reaction') {
      drawFaceOkReaction(face);
    } else if (isDone && this.celebrationTimer > 0) {
      drawFaceDone(face);
    } else if (isError) {
      drawFaceError(face);
    } else if (isTimeout) {
      // Spiral/dizzy eyes
      face.circle(-5, -10, 3).stroke({ color: 0x1a1e2e, width: 1.5 });
      face.circle(-5, -10, 1.5).stroke({ color: 0x1a1e2e, width: 1 });
      face.circle(5, -10, 3).stroke({ color: 0x1a1e2e, width: 1.5 });
      face.circle(5, -10, 1.5).stroke({ color: 0x1a1e2e, width: 1 });
      face.circle(0, -3, 3).stroke({ color: 0x1a1e2e, width: 1.2 });
    } else if (isThinking && !isActive) {
      drawFaceThinking(face);
    } else if (isWaiting && !isActive) {
      drawFaceWaiting(face);
    } else if (isActive) {
      // Behavior-specific face for active
      if (this.behavior?.current === 'think_pause') {
        drawFaceThinking(face);
      } else if (this.behavior?.current === 'look_away') {
        drawFaceWaiting(face); // side-looking
      } else if (this.behavior?.current === 'look_around') {
        // Scanning eyes
        const shift = Math.sin(this.animTime * 0.15) * 2;
        face.ellipse(-5 + shift, -10, 2.5, 2).fill(0x1a1e2e);
        face.ellipse(5 + shift, -10, 2.5, 2).fill(0x1a1e2e);
        face.moveTo(-4, -4).lineTo(4, -4).stroke({ color: 0x1a1e2e, width: 1 });
      } else {
        drawFace(face, 'active', this.personality, this.animTime);
      }
    } else if (isQueued) {
      drawFaceQueued(face);
    } else if (isIdle) {
      if (this.coffeeBreak?.phase === 'drinking') {
        // Satisfied sipping face
        face.moveTo(-7, -10).quadraticCurveTo(-5, -12, -2, -10)
          .stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.7 });
        face.moveTo(2, -10).quadraticCurveTo(5, -12, 8, -10)
          .stroke({ color: 0x1a1e2e, width: 1.5, alpha: 0.7 });
        face.moveTo(-3, -4).quadraticCurveTo(0, -1, 3, -4)
          .stroke({ color: 0x1a1e2e, width: 1.2 });
      } else {
        drawFace(face, 'idle', this.personality, this.animTime);
      }
    } else {
      drawFace(face, this.status, this.personality, this.animTime);
    }

  }

  // ── Finger dots when typing ──────────────────────────────────────────────
  _drawFingers(isActive, typingIntensity) {
    if (!isActive || typingIntensity < 0.3) return;
    drawFingerDots(this._fingerGfx, this.animTime, typingIntensity);
  }

  // ── Effects (sweat, celebration, thought bubble) ─────────────────────────
  _drawEffects(isActive, isError, isDone) {
    const gfx = this._effectsGfx; // single persistent Graphics for all effects

    // ── Sweat drops for error ────────────────────────────────────────────
    if (isError) {
      updateSweatDrops(this.sweatDrops, 16.67, this.animTime, this.effectsContainer);
      drawSweatDrops(this.sweatDrops, this._sweatGfx);

      // Red flash overlay
      const flashAlpha = 0.1 + Math.sin(this.animTime * 0.4) * 0.08;
      gfx.circle(0, -8, HEAD_RADIUS + 2).fill({ color: 0xff0000, alpha: flashAlpha });
    }

    // ── Celebration particles for done (drawn into single Graphics) ─────
    if (isDone && this.celebrationTimer > 0) {
      const progress = 1 - this.celebrationTimer / 1500;
      const colors = [0x22c55e, 0xf59e0b, 0x0ea5e9, 0xec4899, 0x8b5cf6, 0xef4444, 0xfbbf24, 0x14b8a6];
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + this.animTime * 0.1;
        const radius = 15 + progress * 25;
        const px = Math.cos(angle) * radius;
        const py = -10 + Math.sin(angle) * radius - progress * 15;
        const size = 2.5 - progress * 2;
        if (size > 0.3) {
          gfx.circle(px, py, size).fill({ color: colors[i], alpha: 1 - progress });
        }
      }
      for (let i = 0; i < 4; i++) {
        const sa = (i / 4) * Math.PI * 2 + this.animTime * 0.15 + 0.5;
        const sr = 10 + progress * 18;
        const sx = Math.cos(sa) * sr;
        const sy = -8 + Math.sin(sa) * sr - progress * 8;
        const ss = 1.5 - progress;
        if (ss > 0.2) {
          gfx.moveTo(sx, sy - ss * 2).lineTo(sx + ss * 0.5, sy - ss * 0.5)
            .lineTo(sx + ss * 2, sy).lineTo(sx + ss * 0.5, sy + ss * 0.5)
            .lineTo(sx, sy + ss * 2).lineTo(sx - ss * 0.5, sy + ss * 0.5)
            .lineTo(sx - ss * 2, sy).lineTo(sx - ss * 0.5, sy - ss * 0.5)
            .closePath().fill({ color: 0xfbbf24, alpha: (1 - progress) * 0.8 });
        }
      }
    }

    // ── Thought bubble for thinking behavior ─────────────────────────────
    if (isActive && this.behavior?.current === 'think_pause') {
      gfx.circle(12, -26, 2).fill({ color: 0xffffff, alpha: 0.4 });
      gfx.circle(16, -32, 3).fill({ color: 0xffffff, alpha: 0.35 });
      gfx.roundRect(14, -46, 24, 14, 5).fill({ color: 0xffffff, alpha: 0.15 });
      gfx.roundRect(14, -46, 24, 14, 5).stroke({ color: 0xffffff, width: 0.5, alpha: 0.2 });

      const dotPhase = (this.animTime * 0.15) % 3;
      const dotCount = Math.floor(dotPhase) + 1;
      this._thoughtDotsText.text = '.'.repeat(dotCount);
      this._thoughtDotsText.position.set(20, -45);
      this._thoughtDotsText.visible = true;
    }

    // ── Eye scanning during reading ──────────────────────────────────────
    if (isActive && this.behavior?.current === 'lean_forward') {
      const fa = 0.2 + Math.sin(this.animTime * 0.3) * 0.1;
      gfx.moveTo(15, -12).lineTo(20, -14).stroke({ color: 0x58a6ff, width: 1, alpha: fa });
      gfx.moveTo(15, -8).lineTo(20, -8).stroke({ color: 0x58a6ff, width: 1, alpha: fa * 0.7 });
    }
  }

  // ── Sleeping Z particles ─────────────────────────────────────────────────
  _drawZParticles(isIdle) {
    if (!isIdle || this.zParticles.length === 0) return;
    // Use pooled Text objects instead of creating new ones each frame
    for (let i = 0; i < this.zParticles.length && i < this._zTextPool.length; i++) {
      const z = this.zParticles[i];
      if (z.alpha <= 0) continue;
      const zt = this._zTextPool[i];
      zt.visible = true;
      zt.style.fontSize = z.size;
      zt.position.set(z.x, z.y);
      zt.alpha = z.alpha;
      zt.rotation = Math.sin(z.life * 0.002) * 0.3;
    }
  }

  // ── Speech bubble ────────────────────────────────────────────────────────
  _drawBubble() {
    if (!this.bubbleVisible || !this.bubbleText) {
      this.bubbleContainer.alpha = 0;
      return;
    }

    const maxWidth = 90;
    const padding = 5;

    // Update persistent text object
    this._bubbleTextObj.text = this.bubbleText;

    const bw = Math.min(this._bubbleTextObj.width + padding * 2, maxWidth);
    const bh = this._bubbleTextObj.height + padding * 2;

    // Draw into persistent bg Graphics (already cleared in redraw)
    const bg = this._bubbleBg;
    bg.roundRect(-bw / 2, -55 - bh, bw, bh, 4);
    bg.fill({ color: 0x21262d, alpha: 0.92 });
    bg.stroke({ color: this.color, width: 1, alpha: 0.5 });

    bg.moveTo(-3, -55);
    bg.lineTo(0, -50);
    bg.lineTo(3, -55);
    bg.fill({ color: 0x21262d, alpha: 0.92 });

    this._bubbleTextObj.position.set(-bw / 2 + padding, -55 - bh + padding);

    // Smooth fade in/out
    const fadeIn = Math.min(this.bubbleDuration / 300, 1);
    const fadeOut = this.bubbleDuration > 7000 ? Math.max(0, 1 - (this.bubbleDuration - 7000) / 1000) : 1;
    this.bubbleContainer.alpha = fadeIn * fadeOut;
  }

  // ── Status indicator dot ─────────────────────────────────────────────────
  _drawStatusIndicator() {
    const statusColors = {
      active: 0x3fb950,
      queued: 0xd29922,
      error: 0xf85149,
      timeout: 0xf85149,
      done: 0x22c55e,
      thinking: 0x93c5fd,
      waiting: 0xfbbf24,
    };
    const dotColor = statusColors[this.status] || 0x484f58;

    const dot = this._statusDotGfx;
    if (this.status === 'active') {
      const glowAlpha = 0.15 + Math.sin(this.animTime * 0.2) * 0.1;
      dot.circle(18, -18, 6).fill({ color: dotColor, alpha: glowAlpha });
    }
    const pulse = this.status === 'active' ? 0.6 + Math.sin(this.animTime * 0.2) * 0.4 : 1;
    dot.circle(18, -18, 3).fill({ color: dotColor, alpha: pulse });
  }

  // ── Hit area for click detection ─────────────────────────────────────────
  getHitArea() {
    return new PIXI.Rectangle(-25, -25, 50, 75);
  }

  // ── Destroy ──────────────────────────────────────────────────────────────
  destroy() {
    this.container.destroy({ children: true });
  }
}
