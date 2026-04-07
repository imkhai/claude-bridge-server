// Office environment — ceiling lights, data center, pipes, antenna, cables, particles, printer
// PixiJS 8 API — exports Environment class with same interface
const PIXI = window.PIXI;

// ── Layout Constants ────────────────────────────────────────────────────────────
const CANVAS_W = 880;
const CANVAS_H = 760;

// Ceiling lights
const CONE_COLOR = 0xffd580;
const CORD_COLOR = 0x3a3a4a;
const HOUSING_COLOR = 0x2a2a3a;
const CORD_START_Y = 2;
const CORD_END_Y = 26;
const LAMP_RADIUS = 5;
const CONE_APEX_Y = 31;
const CONE_HEIGHT = 95;
const CONE_HALF_W = 42;

const CEILING_LIGHT_DEFS = [
  { x: 130, coneAlpha: 0.07 },
  { x: 310, coneAlpha: 0.09 },
  { x: 480, coneAlpha: 0.08 },
  { x: 640, coneAlpha: 0.07 },
  { x: 790, coneAlpha: 0.06 },
];

// Data center — bottom of canvas
const DC_Y = CANVAS_H - 90;
const DC_RACK_H = 70;
const DC_RACK_W = 56;
const DC_RACK_GAP = 12;

// DC1: left cluster (5 racks)
const DC1_START_X = 50;
const DC1_RACK_XS = Array.from({ length: 5 }, (_, i) => DC1_START_X + i * (DC_RACK_W + DC_RACK_GAP));
const DC1_CENTER_X = DC1_RACK_XS[2];

// DC2: right cluster (5 racks)
const DC2_START_X = 500;
const DC2_RACK_XS = Array.from({ length: 5 }, (_, i) => DC2_START_X + i * (DC_RACK_W + DC_RACK_GAP));
const DC2_CENTER_X = DC2_RACK_XS[2];

const ALL_RACK_XS = [...DC1_RACK_XS, ...DC2_RACK_XS];
const DC_ALL_CENTER_X = (DC1_CENTER_X + DC2_CENTER_X) / 2;

// Server unit constants
const UNIT_COUNT = 7;
const UNIT_W = 46;
const UNIT_H = 7;
const UNIT_START_Y = 14;
const UNIT_GAP = 1;

// ── Utilities ───────────────────────────────────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpPt(p0, p1, t) { return { x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t) }; }

function pathLerp(path, t) {
  if (path.length < 2) return path[0] || { x: 0, y: 0 };
  const totalLen = pathLength(path);
  let target = t * totalLen;
  for (let i = 0; i < path.length - 1; i++) {
    const segLen = dist(path[i], path[i + 1]);
    if (target <= segLen || i === path.length - 2) {
      const segT = segLen > 0 ? Math.min(target / segLen, 1) : 0;
      return lerpPt(path[i], path[i + 1], segT);
    }
    target -= segLen;
  }
  return path[path.length - 1];
}

function pathLength(path) {
  let len = 0;
  for (let i = 0; i < path.length - 1; i++) len += dist(path[i], path[i + 1]);
  return len;
}

function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

// ── Ceiling Lights ──────────────────────────────────────────────────────────────
function createCeilingLights(container) {
  // Static layer: cords + housings
  const staticG = new PIXI.Graphics();
  staticG.zIndex = 20;
  for (const def of CEILING_LIGHT_DEFS) {
    // Cord
    staticG.moveTo(def.x, CORD_START_Y).lineTo(def.x, CORD_END_Y)
      .stroke({ width: 1.5, color: CORD_COLOR, alpha: 0.8 });
    // Housing circle
    staticG.circle(def.x, CORD_END_Y, LAMP_RADIUS)
      .fill(HOUSING_COLOR).stroke({ width: 0.5, color: 0x4a4a5a });
    // Inner glow dot
    staticG.circle(def.x, CORD_END_Y, 2)
      .fill({ color: 0xfff5d0, alpha: 0.6 });
  }
  container.addChild(staticG);

  // Per-light cone (dynamic alpha)
  const lights = CEILING_LIGHT_DEFS.map((def, i) => {
    const coneGfx = new PIXI.Graphics();
    coneGfx.zIndex = 0;
    coneGfx.moveTo(def.x, CONE_APEX_Y)
      .lineTo(def.x - CONE_HALF_W, CONE_APEX_Y + CONE_HEIGHT)
      .lineTo(def.x + CONE_HALF_W, CONE_APEX_Y + CONE_HEIGHT)
      .fill({ color: CONE_COLOR, alpha: def.coneAlpha });
    container.addChild(coneGfx);

    const basePhase = (i / CEILING_LIGHT_DEFS.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    return {
      x: def.x,
      coneGfx,
      baseAlpha: def.coneAlpha,
      flickerPhase: basePhase,
      pulsePeriod: 4.0 + (Math.random() - 0.5) * 1.6,
      flickerTimer: 8 + Math.random() * 7,
      flickering: false,
      flickerRemaining: 0,
      microFlickerPhase: Math.random() * Math.PI * 2,
    };
  });

  return { staticG, lights };
}

function updateCeilingLights(lights, elapsed, delta) {
  for (const light of lights) {
    // Flicker state machine
    if (light.flickering) {
      light.flickerRemaining -= delta;
      if (light.flickerRemaining <= 0) {
        light.flickering = false;
        light.flickerTimer = 8 + Math.random() * 7;
      }
    } else {
      light.flickerTimer -= delta;
      if (light.flickerTimer <= 0) {
        light.flickering = true;
        light.flickerRemaining = 0.04 + Math.random() * 0.06;
      }
    }

    let alpha;
    if (light.flickering) {
      // Micro-flicker: rapid oscillation during flicker
      const micro = Math.sin(elapsed * 60 + light.microFlickerPhase) * 0.5 + 0.5;
      alpha = 0.01 + micro * 0.03;
    } else {
      // Sine-wave pulsing
      const sine = Math.sin((elapsed / light.pulsePeriod) * Math.PI * 2 + light.flickerPhase);
      const norm = (sine + 1) / 2;
      alpha = 0.05 + norm * (light.baseAlpha - 0.05);
      // Subtle micro-flicker overlay
      const micro = Math.sin(elapsed * 12 + light.microFlickerPhase) * 0.003;
      alpha += micro;
    }

    // Redraw cone at computed alpha
    light.coneGfx.clear();
    light.coneGfx.moveTo(light.x, CONE_APEX_Y)
      .lineTo(light.x - CONE_HALF_W, CONE_APEX_Y + CONE_HEIGHT)
      .lineTo(light.x + CONE_HALF_W, CONE_APEX_Y + CONE_HEIGHT)
      .fill({ color: CONE_COLOR, alpha: Math.max(0.01, alpha) });
  }
}

// ── Data Center ─────────────────────────────────────────────────────────────────
function drawRack(container, x, y, phaseOff) {
  const c = new PIXI.Container();
  c.x = x;
  c.y = y;

  // Rack frame with shadow
  const f = new PIXI.Graphics();
  f.roundRect(-28 + 2, 3, DC_RACK_W, DC_RACK_H, 4)
    .fill({ color: 0x000000, alpha: 0.3 });
  f.roundRect(-28, 0, DC_RACK_W, DC_RACK_H, 4)
    .fill(0x1f2937).stroke({ width: 1.5, color: 0x374151 });
  // Inner panel
  f.roundRect(-25, 12, 50, 52, 2).fill(0x111827);
  c.addChild(f);

  // Server units with ventilation slots and drive bays
  const su = new PIXI.Graphics();
  for (let i = 0; i < UNIT_COUNT; i++) {
    const uy = UNIT_START_Y + i * (UNIT_H + UNIT_GAP);
    su.roundRect(-UNIT_W / 2, uy, UNIT_W, UNIT_H, 1)
      .fill(0x374151).stroke({ width: 0.5, color: 0x4b5563 });
    // Ventilation slots (3 horizontal lines)
    for (let v = 0; v < 3; v++) {
      su.moveTo(-UNIT_W / 2 + 3, uy + 2 + v * 2)
        .lineTo(-UNIT_W / 2 + 14, uy + 2 + v * 2)
        .stroke({ width: 0.3, color: 0x4b5563, alpha: 0.5 });
    }
    // Drive bays (small dark rectangles)
    su.rect(-UNIT_W / 2 + 2, uy + 1.5, 2, 4).fill(0x1f2937);
    su.rect(-UNIT_W / 2 + 5, uy + 1.5, 2, 4).fill(0x1f2937);
  }
  c.addChild(su);

  // LEDs: per-unit, configurable frequency and phase
  const leds = [];
  for (let i = 0; i < UNIT_COUNT; i++) {
    const uy = UNIT_START_Y + i * (UNIT_H + UNIT_GAP);
    const cnt = i % 3 === 0 ? 3 : 2;
    for (let j = 0; j < cnt; j++) {
      leds.push({
        x: UNIT_W / 2 - 4 - j * 4,
        y: uy + UNIT_H / 2,
        freq: 0.5 + Math.random() * 1.5,
        phase: Math.random() * Math.PI * 2 + phaseOff,
        color: 0x22c55e,
      });
    }
  }
  const ledG = new PIXI.Graphics();
  c.addChild(ledG);

  // Fan placeholder
  const fanG = new PIXI.Graphics();
  c.addChild(fanG);

  // Power indicator
  const pw = new PIXI.Graphics();
  pw.circle(0, 66, 2).fill(0x3b82f6);
  pw.circle(0, 66, 4).fill({ color: 0x3b82f6, alpha: 0.12 });
  c.addChild(pw);

  // Network ports at bottom
  const ports = new PIXI.Graphics();
  for (let p = 0; p < 8; p++) {
    ports.rect(-20 + p * 5, 69, 3, 3)
      .fill(0x1e3a5f).stroke({ width: 0.3, color: 0x374151 });
  }
  c.addChild(ports);

  container.addChild(c);
  return { ledG, fanG, fanAngle: Math.random() * Math.PI * 2, leds };
}

function drawCluster(container, rackXs, label, floorX, floorW, centerX, phaseBase) {
  // Floor plate
  const floor = new PIXI.Graphics();
  floor.roundRect(floorX, DC_Y - 4, floorW, DC_RACK_H + 10, 4)
    .fill({ color: 0x06b6d4, alpha: 0.04 })
    .stroke({ width: 1, color: 0x06b6d4, alpha: 0.15 });
  container.addChild(floor);

  // Label
  const lb = new PIXI.Text({
    text: label,
    style: { fontSize: 7, fill: 0x06b6d4, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 2 },
  });
  lb.alpha = 0.5;
  lb.anchor.set(0.5, 0);
  lb.x = centerX;
  lb.y = DC_Y - 14;
  container.addChild(lb);

  // Racks
  const racks = rackXs.map((rx, i) => drawRack(container, rx, DC_Y, i * 0.8 + phaseBase));

  // Inter-rack cables
  const ic = new PIXI.Graphics();
  for (let i = 0; i < rackXs.length - 1; i++) {
    const x1 = rackXs[i] + DC_RACK_W / 2 - 4;
    const x2 = rackXs[i + 1] - DC_RACK_W / 2 + 4;
    const cy = DC_Y + DC_RACK_H - 4;
    ic.moveTo(x1, cy).lineTo(x2, cy).stroke({ width: 1.5, color: 0x06b6d4, alpha: 0.2 });
    ic.rect(x1 - 2, cy - 2, 4, 4).fill({ color: 0x06b6d4, alpha: 0.3 });
    ic.rect(x2 - 2, cy - 2, 4, 4).fill({ color: 0x06b6d4, alpha: 0.3 });
  }
  container.addChild(ic);

  return racks;
}

function createDataCenter(container) {
  const r1 = drawCluster(container, DC1_RACK_XS, 'DATA CENTER', DC1_START_X - 14, 5 * (DC_RACK_W + DC_RACK_GAP) + 14, DC1_CENTER_X, 0);
  const r2 = drawCluster(container, DC2_RACK_XS, 'AI DATA CENTER', DC2_START_X - 14, 5 * (DC_RACK_W + DC_RACK_GAP) + 14, DC2_CENTER_X, 4.0);

  // Cross-cluster cable
  const cc = new PIXI.Graphics();
  const cx1 = DC1_RACK_XS[4] + DC_RACK_W / 2;
  const cx2 = DC2_RACK_XS[0] - DC_RACK_W / 2;
  const ccy = DC_Y + DC_RACK_H - 4;
  cc.moveTo(cx1, ccy).lineTo(cx2, ccy).stroke({ width: 2.5, color: 0x06b6d4, alpha: 0.35 });
  cc.moveTo(cx1, ccy).lineTo(cx2, ccy).stroke({ width: 6, color: 0x06b6d4, alpha: 0.06 });
  cc.roundRect(cx1 - 3, ccy - 3, 6, 6, 1).fill(0x164e63).stroke({ width: 0.5, color: 0x06b6d4, alpha: 0.5 });
  cc.roundRect(cx2 - 3, ccy - 3, 6, 6, 1).fill(0x164e63).stroke({ width: 0.5, color: 0x06b6d4, alpha: 0.5 });
  container.addChild(cc);

  // Shared power strip
  const ps = new PIXI.Graphics();
  const psY = DC_Y + DC_RACK_H + 2;
  ps.roundRect(DC1_START_X - 14, psY, DC2_RACK_XS[4] + DC_RACK_W / 2 - DC1_START_X + 28, 4, 1)
    .fill(0x1e3a5f).stroke({ width: 0.5, color: 0x3b82f6, alpha: 0.3 });
  ALL_RACK_XS.forEach(rx => ps.circle(rx, psY + 2, 1.5).fill({ color: 0x3b82f6, alpha: 0.4 }));
  container.addChild(ps);

  // Load stats text
  const statsText = new PIXI.Text({
    text: 'Load: 0%',
    style: { fontFamily: 'monospace', fontSize: 7, fill: 0x8b949e },
  });
  statsText.anchor.set(1, 0);
  statsText.x = DC2_RACK_XS[4] + DC_RACK_W / 2;
  statsText.y = DC_Y - 14;
  container.addChild(statsText);

  return { racks: [...r1, ...r2], statsText };
}

function updateDataCenter(dc, elapsed, serverLoad) {
  // Update stats text
  dc.statsText.text = `Load: ${Math.round(serverLoad * 100)}%`;

  for (const rack of dc.racks) {
    // Update LEDs
    rack.ledG.clear();
    for (const led of rack.leds) {
      // Color based on load
      let color;
      if (serverLoad > 0.7) {
        color = 0xef4444; // Red
      } else if (serverLoad > 0.3) {
        color = 0xeab308; // Yellow
      } else {
        color = 0x22c55e; // Green
      }

      const brightness = Math.sin(elapsed * led.freq * Math.PI * 2 + led.phase);
      const norm = (brightness + 1) / 2;
      const alpha = 0.3 + norm * 0.6;

      // Pulsing glow when high load
      const glowExtra = serverLoad > 0.7 ? Math.sin(elapsed * 3 + led.phase) * 0.15 : 0;

      rack.ledG.circle(led.x, led.y, 1.5)
        .fill({ color, alpha: Math.min(1, alpha + glowExtra) });
      // LED glow halo
      rack.ledG.circle(led.x, led.y, 3)
        .fill({ color, alpha: (alpha + glowExtra) * 0.15 });
    }

    // Rotating fan
    rack.fanAngle += 0.05 + serverLoad * 0.15;
    rack.fanG.clear();
    const fanCx = 0;
    const fanCy = 8;
    const fanR = 5;
    // Fan circle
    rack.fanG.circle(fanCx, fanCy, fanR)
      .stroke({ width: 0.5, color: 0x4b5563, alpha: 0.4 });
    // Fan blades (3 blades)
    for (let b = 0; b < 3; b++) {
      const angle = rack.fanAngle + (b / 3) * Math.PI * 2;
      rack.fanG.moveTo(fanCx, fanCy)
        .lineTo(fanCx + Math.cos(angle) * fanR * 0.8, fanCy + Math.sin(angle) * fanR * 0.8)
        .stroke({ width: 1, color: 0x6b7280, alpha: 0.5 });
    }
  }
}

// ── Radio Antenna ───────────────────────────────────────────────────────────────
function createAntenna(container) {
  const ant = new PIXI.Container();
  ant.x = DC_ALL_CENTER_X;
  ant.y = DC_Y - 10;

  // Router box
  const routerBox = new PIXI.Graphics();
  routerBox.roundRect(-8, -4, 16, 8, 2)
    .fill(0x374151).stroke({ width: 0.8, color: 0x4b5563 });
  // Status LED
  routerBox.circle(-4, -1, 1).fill({ color: 0x22c55e, alpha: 0.8 });
  // Antenna stubs
  routerBox.moveTo(-3, -4).lineTo(-4, -10).stroke({ width: 1, color: 0x6b7280 });
  routerBox.moveTo(3, -4).lineTo(4, -10).stroke({ width: 1, color: 0x6b7280 });
  routerBox.circle(-4, -10, 1).fill(0x9ca3af);
  routerBox.circle(4, -10, 1).fill(0x9ca3af);
  ant.addChild(routerBox);

  // Dynamic elements
  const antennaWaves = new PIXI.Graphics();
  ant.addChild(antennaWaves);

  const signalBars = new PIXI.Graphics();
  signalBars.x = 12;
  signalBars.y = -8;
  ant.addChild(signalBars);

  container.addChild(ant);
  return { antennaWaves, signalBars, waveTimer: 0 };
}

function updateAntenna(antenna, elapsed, activeCount) {
  // Expanding wave arcs
  antenna.antennaWaves.clear();
  const waveCount = 3;
  for (let i = 0; i < waveCount; i++) {
    const phase = (elapsed * 0.8 + i * 0.33) % 1;
    const radius = 6 + phase * 20;
    const alpha = (1 - phase) * 0.25 * (activeCount > 0 ? 1 : 0.3);
    antenna.antennaWaves.arc(0, -10, radius, -Math.PI * 0.7, -Math.PI * 0.3)
      .stroke({ width: 1, color: 0x06b6d4, alpha });
    antenna.antennaWaves.arc(0, -10, radius, -Math.PI * 0.7 + Math.PI, -Math.PI * 0.3 + Math.PI)
      .stroke({ width: 1, color: 0x06b6d4, alpha: alpha * 0.6 });
  }

  // Signal strength bars
  antenna.signalBars.clear();
  const barCount = 4;
  const signalStrength = Math.min(activeCount / 4, 1);
  for (let i = 0; i < barCount; i++) {
    const barH = 3 + i * 2;
    const isActive = (i / barCount) < signalStrength + 0.1;
    antenna.signalBars.rect(i * 3, -barH, 2, barH)
      .fill({ color: isActive ? 0x22c55e : 0x374151, alpha: isActive ? 0.7 : 0.3 });
  }
}

// ── Pipe Network ────────────────────────────────────────────────────────────────
function createPipeNetwork(container, deskPositions) {
  const pipeG = new PIXI.Graphics();
  pipeG.zIndex = 1;
  const dotContainer = new PIXI.Container();
  dotContainer.zIndex = 2;

  // Backbone: horizontal pipes at desk row bottoms connecting down to DC
  const backboneY = DC_Y - 30;

  // Main vertical backbone on left side
  pipeG.moveTo(60, 180).lineTo(60, backboneY)
    .stroke({ width: 2, color: 0x1e3a5f, alpha: 0.35 });
  // Horizontal backbone connecting to DC clusters
  pipeG.moveTo(60, backboneY).lineTo(DC2_RACK_XS[4], backboneY)
    .stroke({ width: 2, color: 0x1e3a5f, alpha: 0.3 });
  // Vertical drops to each rack
  for (const rx of ALL_RACK_XS) {
    pipeG.moveTo(rx, backboneY).lineTo(rx, DC_Y - 4)
      .stroke({ width: 1.2, color: 0x1e3a5f, alpha: 0.25 });
  }

  // Build per-desk paths going down to backbone then to nearest rack
  const paths = [];
  if (deskPositions) {
    for (let i = 0; i < deskPositions.length; i++) {
      const desk = deskPositions[i];
      if (!desk) continue;
      // Find nearest rack
      let nearestRx = ALL_RACK_XS[0];
      let minDist = Math.abs(desk.x - ALL_RACK_XS[0]);
      for (const rx of ALL_RACK_XS) {
        const d = Math.abs(desk.x - rx);
        if (d < minDist) { minDist = d; nearestRx = rx; }
      }
      const path = [
        { x: desk.x, y: desk.y + 30 },
        { x: desk.x, y: backboneY },
        { x: nearestRx, y: backboneY },
        { x: nearestRx, y: DC_Y - 4 },
      ];
      // Draw pipe for this desk
      pipeG.moveTo(path[0].x, path[0].y);
      for (let j = 1; j < path.length; j++) {
        pipeG.lineTo(path[j].x, path[j].y);
      }
      pipeG.stroke({ width: 1, color: 0x1e3a5f, alpha: 0.2 });
      paths.push({ deskIdx: i, path, dots: [] });
    }
  }

  container.addChild(pipeG);
  container.addChild(dotContainer);

  // Pre-create dot pool
  const dotPool = [];
  for (let i = 0; i < 30; i++) {
    const g = new PIXI.Graphics();
    g.visible = false;
    dotContainer.addChild(g);
    dotPool.push(g);
  }

  return { pipeG, dotContainer, paths, dotPool, dots: [], spawnTimer: 0 };
}

function updatePipeNetwork(pipes, elapsed, delta, serverLoad, activeDesks) {
  pipes.spawnTimer -= delta;
  if (pipes.spawnTimer <= 0 && pipes.paths.length > 0) {
    // Spawn a new dot on a random active path
    const activePaths = pipes.paths.filter((_, i) => activeDesks[i]);
    const pathPool = activePaths.length > 0 ? activePaths : pipes.paths;
    const chosen = pathPool[Math.floor(Math.random() * pathPool.length)];

    // Find an available dot from pool
    const availDot = pipes.dotPool.find(d => !d.visible);
    if (availDot && chosen) {
      const speed = 0.15 + serverLoad * 0.25 + Math.random() * 0.1;
      const direction = Math.random() > 0.5 ? 1 : -1;
      pipes.dots.push({
        gfx: availDot,
        path: direction > 0 ? chosen.path : [...chosen.path].reverse(),
        t: 0,
        speed,
        color: 0x3b82f6,
      });
      availDot.visible = true;
    }
    pipes.spawnTimer = 0.3 + Math.random() * 0.5;
  }

  // Update dots
  for (let i = pipes.dots.length - 1; i >= 0; i--) {
    const dot = pipes.dots[i];
    dot.t += dot.speed * delta;
    if (dot.t >= 1) {
      dot.gfx.clear();
      dot.gfx.visible = false;
      pipes.dots.splice(i, 1);
      continue;
    }
    const pos = pathLerp(dot.path, dot.t);
    dot.gfx.clear();
    // Glowing blue dot
    dot.gfx.circle(pos.x, pos.y, 2)
      .fill({ color: dot.color, alpha: 0.8 });
    dot.gfx.circle(pos.x, pos.y, 4)
      .fill({ color: dot.color, alpha: 0.15 });
    // Trailing dot
    const trailT = Math.max(0, dot.t - 0.03);
    const trailPos = pathLerp(dot.path, trailT);
    dot.gfx.circle(trailPos.x, trailPos.y, 1.2)
      .fill({ color: dot.color, alpha: 0.4 });
  }
}

// ── Network Cables ──────────────────────────────────────────────────────────────
const CABLE_COLORS = {
  0: 0x4338ca,
  1: 0x166534,
  2: 0x92400e,
  3: 0x5b21b6,
  4: 0x0c4a6e,
  5: 0x831843,
  6: 0x134e4a,
  7: 0x7c2d12,
};

function createNetworkCables(container, deskPositions) {
  const cables = [];
  if (!deskPositions) return { cables, container: null };

  const cableContainer = new PIXI.Container();
  cableContainer.zIndex = 3;

  for (let i = 0; i < deskPositions.length; i++) {
    const desk = deskPositions[i];
    if (!desk) continue;

    // Find nearest rack
    let nearestRx = ALL_RACK_XS[0];
    let minDist = Math.abs(desk.x - ALL_RACK_XS[0]);
    for (const rx of ALL_RACK_XS) {
      const d = Math.abs(desk.x - rx);
      if (d < minDist) { minDist = d; nearestRx = rx; }
    }

    // Waypoint-based routing (down from desk, across floor, up to rack)
    const floorY = DC_Y + DC_RACK_H + 15;
    const path = [
      { x: desk.x, y: desk.y + 25 },
      { x: desk.x, y: desk.y + 55 },
      { x: desk.x, y: floorY },
      { x: nearestRx, y: floorY },
      { x: nearestRx, y: DC_Y + DC_RACK_H },
    ];

    // Draw static cable
    const cg = new PIXI.Graphics();
    cg.moveTo(path[0].x, path[0].y);
    for (let j = 1; j < path.length; j++) {
      cg.lineTo(path[j].x, path[j].y);
    }
    cg.stroke({ width: 1.2, color: CABLE_COLORS[i] || 0x1e3a5f, alpha: 0.2 });
    cableContainer.addChild(cg);

    // Pulse dots (3 per cable for denser animation)
    const pulses = [];
    for (let p = 0; p < 3; p++) {
      const pg = new PIXI.Graphics();
      pg.visible = false;
      cableContainer.addChild(pg);
      pulses.push({ gfx: pg, t: -1, speed: 0.3 + Math.random() * 0.2 });
    }

    cables.push({
      deskIdx: i,
      path,
      cableGfx: cg,
      pulses,
      active: false,
      spawnTimer: Math.random() * 2,
    });
  }

  container.addChild(cableContainer);
  return { cables, cableContainer };
}

function updateNetworkCables(cableData, elapsed, delta) {
  for (const cable of cableData.cables) {
    if (!cable.active) {
      // Hide all pulses
      for (const p of cable.pulses) {
        if (p.t >= 0) { p.gfx.clear(); p.gfx.visible = false; p.t = -1; }
      }
      continue;
    }

    // Spawn new pulses periodically
    cable.spawnTimer -= delta;
    if (cable.spawnTimer <= 0) {
      const idlePulse = cable.pulses.find(p => p.t < 0 || p.t >= 1);
      if (idlePulse) {
        idlePulse.t = 0;
        idlePulse.gfx.visible = true;
      }
      cable.spawnTimer = 0.6 + Math.random() * 1.0;
    }

    // Animate pulses
    for (const p of cable.pulses) {
      if (p.t < 0) continue;
      p.t += p.speed * delta;
      if (p.t >= 1) {
        p.gfx.clear();
        p.gfx.visible = false;
        p.t = -1;
        continue;
      }
      const pos = pathLerp(cable.path, p.t);
      const brightness = 0.5 + Math.sin(elapsed * 4 + p.t * 10) * 0.3;
      p.gfx.clear();
      p.gfx.circle(pos.x, pos.y, 2.5)
        .fill({ color: 0x58a6ff, alpha: brightness });
      p.gfx.circle(pos.x, pos.y, 5)
        .fill({ color: 0x58a6ff, alpha: brightness * 0.15 });
    }
  }
}

// ── Ambient Particles ───────────────────────────────────────────────────────────
function createParticles(container, width, height) {
  const particles = [];
  const particleG = new PIXI.Graphics();
  container.addChild(particleG);

  for (let i = 0; i < 30; i++) {
    particles.push({
      x: Math.random() * width,
      y: 100 + Math.random() * (height - 250),
      baseY: 0, // set below
      size: 0.5 + Math.random() * 2.0,
      alpha: 0.06 + Math.random() * 0.15,
      floatPeriod: 5 + Math.random() * 4, // 5-9s CSS-like float
      floatAmplitude: 8 + Math.random() * 15,
      driftX: (Math.random() - 0.5) * 0.4,
      phase: Math.random() * Math.PI * 2,
    });
    particles[i].baseY = particles[i].y;
  }

  return { particles, gfx: particleG };
}

function updateParticles(pData, elapsed, width, height) {
  pData.gfx.clear();
  for (const p of pData.particles) {
    // Vertical float (sine wave, 5-9s period)
    p.y = p.baseY + Math.sin(elapsed / p.floatPeriod * Math.PI * 2 + p.phase) * p.floatAmplitude;
    // Gentle horizontal drift
    p.x += p.driftX * 0.016; // ~1 frame
    // Wrap
    if (p.x < -10) p.x = width + 10;
    if (p.x > width + 10) p.x = -10;

    // Amber-tinted dots
    const alphaOsc = p.alpha + Math.sin(elapsed * 0.5 + p.phase) * 0.03;
    pData.gfx.circle(p.x, p.y, p.size)
      .fill({ color: 0xffd580, alpha: Math.max(0.02, alphaOsc) });
  }
}

// ── Floor / Wall Details ────────────────────────────────────────────────────────
function createFloorDetails(container, width, height) {
  const floorG = new PIXI.Graphics();
  floorG.zIndex = -1;

  // Subtle floor grid
  const gridSpacing = 60;
  for (let x = 0; x < width; x += gridSpacing) {
    floorG.moveTo(x, 0).lineTo(x, height)
      .stroke({ width: 0.3, color: 0x21262d, alpha: 0.15 });
  }
  for (let y = 0; y < height; y += gridSpacing) {
    floorG.moveTo(0, y).lineTo(width, y)
      .stroke({ width: 0.3, color: 0x21262d, alpha: 0.15 });
  }

  // Ambient center glow (radial gradient approximation with concentric circles)
  const cx = width / 2;
  const cy = height / 2 - 40;
  for (let r = 200; r > 0; r -= 20) {
    floorG.circle(cx, cy, r)
      .fill({ color: 0x1e293b, alpha: 0.008 * (1 - r / 200) });
  }

  container.addChild(floorG);
  return { floorG };
}

// ── Wall Clock ──────────────────────────────────────────────────────────────────
function createClock(container, width) {
  const clockContainer = new PIXI.Container();
  clockContainer.zIndex = 15;

  const cx = width - 40;
  const cy = 35;
  const radius = 16;

  // Static face
  const face = new PIXI.Graphics();
  face.circle(cx, cy, radius).fill(0x161b22).stroke({ color: 0x444c56, width: 1 });
  // Hour markers
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const inner = radius - 3;
    const outer = radius - 1;
    face.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
      .lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
      .stroke({ color: 0x8b949e, width: 1 });
  }
  clockContainer.addChild(face);

  // Dynamic hands
  const handsG = new PIXI.Graphics();
  clockContainer.addChild(handsG);

  // Center dot
  const center = new PIXI.Graphics();
  center.circle(cx, cy, 1.5).fill(0xe6edf3);
  clockContainer.addChild(center);

  container.addChild(clockContainer);
  return { handsG, cx, cy, radius };
}

function updateClock(clock) {
  const { handsG, cx, cy } = clock;
  handsG.clear();

  const now = new Date();
  const h = now.getHours() % 12;
  const m = now.getMinutes();
  const s = now.getSeconds();

  // Hour
  const hAngle = ((h + m / 60) / 12) * Math.PI * 2 - Math.PI / 2;
  handsG.moveTo(cx, cy).lineTo(cx + Math.cos(hAngle) * 8, cy + Math.sin(hAngle) * 8)
    .stroke({ color: 0xe6edf3, width: 1.5 });
  // Minute
  const mAngle = ((m + s / 60) / 60) * Math.PI * 2 - Math.PI / 2;
  handsG.moveTo(cx, cy).lineTo(cx + Math.cos(mAngle) * 11, cy + Math.sin(mAngle) * 11)
    .stroke({ color: 0xe6edf3, width: 1 });
  // Second
  const sAngle = (s / 60) * Math.PI * 2 - Math.PI / 2;
  handsG.moveTo(cx, cy).lineTo(cx + Math.cos(sAngle) * 13, cy + Math.sin(sAngle) * 13)
    .stroke({ color: 0xf85149, width: 0.5 });
}

// ── Printer ─────────────────────────────────────────────────────────────────────
function createPrinter(container) {
  const printer = new PIXI.Container();
  printer.x = DC_ALL_CENTER_X + 50;
  printer.y = DC_Y - 25;

  // Body
  const body = new PIXI.Graphics();
  body.roundRect(-12, -6, 24, 12, 2)
    .fill(0x374151).stroke({ width: 0.8, color: 0x4b5563 });
  // Paper tray slot
  body.rect(-8, -8, 16, 3).fill(0x1f2937).stroke({ width: 0.3, color: 0x4b5563 });
  // Status LED
  body.circle(8, -3, 1).fill({ color: 0x22c55e, alpha: 0.7 });
  // Feed slot
  body.rect(-6, 5, 12, 1.5).fill(0x111827);
  printer.addChild(body);

  // Paper (animated)
  const paperG = new PIXI.Graphics();
  printer.addChild(paperG);

  container.addChild(printer);
  return {
    paperG,
    printTimer: 10 + Math.random() * 20,
    printing: false,
    paperProgress: 0,
    statusLedGfx: body,
  };
}

function updatePrinter(printer, elapsed, delta) {
  if (printer.printing) {
    printer.paperProgress += delta * 0.8;
    if (printer.paperProgress >= 1) {
      printer.printing = false;
      printer.printTimer = 15 + Math.random() * 25;
      printer.paperProgress = 0;
    }
  } else {
    printer.printTimer -= delta;
    if (printer.printTimer <= 0) {
      printer.printing = true;
      printer.paperProgress = 0;
    }
  }

  printer.paperG.clear();
  if (printer.printing) {
    // Paper emerging from bottom
    const paperLen = printer.paperProgress * 14;
    printer.paperG.rect(-5, 6, 10, paperLen)
      .fill({ color: 0xe5e7eb, alpha: 0.8 });
    // Text lines on paper
    for (let line = 0; line < Math.floor(paperLen / 3); line++) {
      // Deterministic width per line (avoids jitter from Math.random() every frame)
      const lineW = 6 + ((line * 7 + 3) % 3);
      printer.paperG.rect(-4, 7 + line * 3, lineW, 0.5)
        .fill({ color: 0x6b7280, alpha: 0.5 });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Environment Class
// ═══════════════════════════════════════════════════════════════════════════════

export class Environment {
  constructor(canvasWidth, canvasHeight) {
    this.width = canvasWidth;
    this.height = canvasHeight;
    this.container = new PIXI.Container();
    this.container.sortableChildren = true;
    this.animTime = 0;

    // Server load (0-1)
    this.serverLoad = 0;
    this.activeCount = 0;

    // Cable pulse state (compatibility)
    this.cablePulses = new Array(8).fill(null).map(() => ({
      active: false,
      pulsePos: 0,
    }));

    // ── Create layers ──
    this.floorLayer = new PIXI.Container();
    this.floorLayer.zIndex = -1;
    this.pipeLayer = new PIXI.Container();
    this.pipeLayer.zIndex = 1;
    this.cableLayer = new PIXI.Container();
    this.cableLayer.zIndex = 3;
    this.dataCenterLayer = new PIXI.Container();
    this.dataCenterLayer.zIndex = 5;
    this.particleLayer = new PIXI.Container();
    this.particleLayer.zIndex = 6;
    this.clockLayer = new PIXI.Container();
    this.clockLayer.zIndex = 10;
    this.ceilingLayer = new PIXI.Container();
    this.ceilingLayer.zIndex = 20;

    this.container.addChild(this.floorLayer);
    this.container.addChild(this.pipeLayer);
    this.container.addChild(this.cableLayer);
    this.container.addChild(this.dataCenterLayer);
    this.container.addChild(this.particleLayer);
    this.container.addChild(this.clockLayer);
    this.container.addChild(this.ceilingLayer);

    // ── Initialize subsystems ──
    this.floorDetails = createFloorDetails(this.floorLayer, canvasWidth, canvasHeight);
    this.ceilingLights = createCeilingLights(this.ceilingLayer);
    this.dataCenter = createDataCenter(this.dataCenterLayer);
    this.antenna = createAntenna(this.dataCenterLayer);
    this.clock = createClock(this.clockLayer, canvasWidth);
    this.particles = createParticles(this.particleLayer, canvasWidth, canvasHeight);
    this.printer = createPrinter(this.dataCenterLayer);

    // Pipes and cables initialized lazily (need desk positions)
    this.pipeNetwork = null;
    this.networkCables = null;
    this.deskPositions = null;
  }

  /**
   * Set cable/pipe endpoints. Called by office after layout.
   * deskPositions: array of {x, y, agentId} for each desk slot
   */
  setCableEndpoints(deskPositions) {
    // Only recreate when desk count or positions actually change (prevents per-frame rebuild)
    if (this.deskPositions && this.deskPositions.length === deskPositions.length) {
      let same = true;
      for (let i = 0; i < deskPositions.length; i++) {
        const a = this.deskPositions[i], b = deskPositions[i];
        if (!a || !b || a.x !== b.x || a.y !== b.y || a.agentId !== b.agentId) {
          same = false;
          break;
        }
      }
      if (same) return;
    }

    this.deskPositions = deskPositions;

    if (this.pipeNetwork) {
      this.pipeLayer.removeChildren();
    }
    this.pipeNetwork = createPipeNetwork(this.pipeLayer, deskPositions);

    if (this.networkCables && this.networkCables.cableContainer) {
      this.cableLayer.removeChildren();
    }
    this.networkCables = createNetworkCables(this.cableLayer, deskPositions);
  }

  /**
   * Update active states for cables and compute server load
   */
  updateAgentStates(agents) {
    let activeCount = 0;
    for (let i = 0; i < 8; i++) {
      const agent = agents[i];
      const isActive = agent && agent.status === 'active';
      this.cablePulses[i].active = isActive;
      if (isActive) activeCount++;
    }
    this.activeCount = activeCount;
    this.serverLoad = agents.length > 0 ? activeCount / Math.max(agents.length, 4) : 0;

    // Update cable active states
    if (this.networkCables) {
      for (const cable of this.networkCables.cables) {
        cable.active = this.cablePulses[cable.deskIdx]?.active || false;
      }
    }
  }

  tick(dt) {
    this.animTime += dt;
    const elapsed = this.animTime;
    const delta = dt;

    // Active desk flags for pipe network
    const activeDesks = {};
    for (let i = 0; i < 8; i++) {
      activeDesks[i] = this.cablePulses[i]?.active || false;
    }

    // Update all subsystems
    updateCeilingLights(this.ceilingLights.lights, elapsed, delta);
    updateDataCenter(this.dataCenter, elapsed, this.serverLoad);
    updateAntenna(this.antenna, elapsed, this.activeCount);
    updateClock(this.clock);
    updateParticles(this.particles, elapsed, this.width, this.height);
    updatePrinter(this.printer, elapsed, delta);

    if (this.pipeNetwork) {
      updatePipeNetwork(this.pipeNetwork, elapsed, delta, this.serverLoad, activeDesks);
    }
    if (this.networkCables) {
      updateNetworkCables(this.networkCables, elapsed, delta);
    }
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
