import crypto from 'crypto';
import { Router } from 'express';
import { readdir, stat } from 'fs/promises';
import { join, extname } from 'path';
import multer from 'multer';
import { config } from '../config.mjs';
import { queue, onTimelineEvent } from '../queue.mjs';
import { logger } from '../utils/logger.mjs';
import * as db from '../db.mjs';
import { validateAllowedTools } from '../utils/validators.mjs';

export const chatRouter = Router();

// ---------------------------------------------------------------------------
// Multer setup for file uploads
// ---------------------------------------------------------------------------
const ALLOWED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp',        // images
  '.md', '.txt', '.pdf',                            // documents
  '.js', '.mjs', '.ts', '.tsx', '.jsx',             // code
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', // code
  '.json', '.yaml', '.yml', '.toml', '.csv',        // data
  '.sh', '.bash', '.zsh',                           // scripts
  '.css', '.html',                                   // web
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, join(config.WORKSPACE, 'uploads'));
  },
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${ts}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed`));
    }
  },
});

// ---------------------------------------------------------------------------
// Helpers — conversation storage (backed by SQLite)
// ---------------------------------------------------------------------------

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
}

function loadConversation(id) {
  return db.getConversation(id);
}

function persistConversation(conv) {
  db.saveConversation(conv);
}

function persistMessage(conversationId, msg) {
  db.addMessage(conversationId, msg);
}

function generateTitle(message) {
  // First 60 chars of first sentence, cleaned up
  const clean = message.replace(/\n/g, ' ').trim();
  if (clean.length <= 60) return clean;
  return clean.slice(0, 57) + '...';
}

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------
const IMAGE_RE = /\.(png|jpg|jpeg|gif|webp)$/i;
const DOC_RE = /\.(md|txt|pdf)$/i;

function detectIntent(message, files = []) {
  const lower = message.toLowerCase();
  const hasImages = files.some(f => IMAGE_RE.test(f));
  const hasDocs = files.some(f => DOC_RE.test(f));

  // Bug report with screenshot
  if (hasImages && /bug|issue|fix|broken|error|wrong|crash/i.test(lower)) {
    return {
      pattern: 'bug-report',
      agents: ['image-analyzer', 'investigator', 'senior-engineer', 'qa-reviewer', 'code-reviewer'],
      method: 'chain',
    };
  }

  // Implementation with spec document
  if (hasDocs && /implement|build|create/i.test(lower)) {
    return {
      pattern: 'implementation-with-spec',
      agents: ['architect', 'backend-engineer', 'frontend-engineer', 'qa-reviewer', 'code-reviewer'],
      method: 'chain',
    };
  }

  // Implementation
  if (/implement|build|create|add feature/i.test(lower)) {
    return {
      pattern: 'implementation',
      agents: ['architect', 'frontend-engineer', 'integration-engineer', 'code-reviewer'],
      method: 'chain',
    };
  }

  // Review / audit
  if (/review|audit|security/i.test(lower)) {
    return {
      pattern: 'review',
      agents: ['security-auditor', 'tech-lead', 'senior-engineer', 'qa-reviewer'],
      method: 'chain',
    };
  }

  // Bug fix (no screenshot)
  if (/fix|bug|broken|error|crash|issue/i.test(lower)) {
    return {
      pattern: 'bugfix',
      agents: ['investigator', 'senior-engineer', 'qa-reviewer', 'code-reviewer'],
      method: 'chain',
    };
  }

  // Design / UI
  if (/design|ui |ux |layout|style|css/i.test(lower)) {
    return {
      pattern: 'design',
      agents: ['ui-architect', 'frontend-engineer'],
      method: 'chain',
    };
  }

  // Documentation
  if (/doc|readme|update doc|write doc/i.test(lower)) {
    return {
      pattern: 'documentation',
      agents: ['documentation-agent'],
      method: 'single',
    };
  }

  // Research / explanation
  if (/explain|what is|how does|how do|why does|why do|tell me about/i.test(lower)) {
    return {
      pattern: 'research',
      agents: ['researcher'],
      method: 'single',
    };
  }

  // Default: general agent
  return {
    pattern: 'general',
    agents: ['general-agent'],
    method: 'single',
  };
}

// ---------------------------------------------------------------------------
// SSE connections per conversation
// ---------------------------------------------------------------------------
const sseClients = new Map(); // conversationId -> Set<res>

function pushSSE(conversationId, event, data) {
  const clients = sseClients.get(conversationId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // client disconnected
    }
  }
}

// ---------------------------------------------------------------------------
// Agent orchestration
// ---------------------------------------------------------------------------
// CHAT_WORKING_DIR allows chat agents to work outside workspace (e.g., on project source)
// Falls back to WORKSPACE if not set
const WORKING_DIR = process.env.CHAT_WORKING_DIR || config.WORKSPACE;
const CHAT_REQUESTED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

// Gate chat tools through the same server policy as API requests.
let DEFAULT_TOOLS;
try {
  DEFAULT_TOOLS = validateAllowedTools(CHAT_REQUESTED_TOOLS) || CHAT_REQUESTED_TOOLS;
} catch {
  DEFAULT_TOOLS = CHAT_REQUESTED_TOOLS.filter(t => {
    try { validateAllowedTools([t]); return true; } catch { return false; }
  });
}

// Agents that need Bash for git/gh CLI operations (PRs, merges, commits)
const BASH_AGENTS = new Set([
  'code-reviewer',       // gh pr review, gh pr merge
  'frontend-engineer',   // git commit, git push, gh pr create
  'backend-engineer',    // git commit, git push, gh pr create
  'senior-engineer',     // git commit, git push, gh pr create
  'integration-engineer', // git commit, git push, gh pr create
]);

function getToolsForAgent(agentId) {
  if (BASH_AGENTS.has(agentId)) {
    return [...DEFAULT_TOOLS, 'Bash'];
  }
  return DEFAULT_TOOLS;
}

async function spawnAgents(conv, routing, userMessage, files) {
  try {
    const { pattern, agents, method } = routing;
    const taskIds = [];

    // If images present, prepend image-analyzer if not already first
    const hasImages = files.some(f => IMAGE_RE.test(f));
    let imageAnalysis = null;

    if (hasImages && agents[0] !== 'image-analyzer') {
      // Spawn image analyzer first
      const imagePaths = files.filter(f => IMAGE_RE.test(f));
      const analyzerResult = await runSingleAgent(
        'image-analyzer',
        `Analyze these images and describe what you see in detail: ${imagePaths.join(', ')}. Then explain how they relate to this request: "${userMessage}"`,
        null,
        conv.id,
      );
      taskIds.push(analyzerResult.taskId);
      imageAnalysis = analyzerResult.result;

      // Add agent message to conversation
      const agentMsg = {
        id: newId('msg'),
        role: 'agent',
        agentId: 'image-analyzer',
        content: analyzerResult.result || analyzerResult.error || 'Image analysis failed',
        taskId: analyzerResult.taskId,
        duration: analyzerResult.duration,
        status: analyzerResult.status,
        timestamp: new Date().toISOString(),
      };
      conv.messages.push(agentMsg);
      persistMessage(conv.id, agentMsg);
      persistConversation(conv);
      pushSSE(conv.id, 'agent-message', agentMsg);
    }

    // Build context from files + image analysis
    let baseContext = '';
    if (imageAnalysis) {
      baseContext += `## Image Analysis\n${imageAnalysis}\n\n`;
    }
    const nonImageFiles = files.filter(f => !IMAGE_RE.test(f));
    if (nonImageFiles.length > 0) {
      baseContext += `## Reference Files\nThe user attached these files: ${nonImageFiles.join(', ')}. Read them for context.\n\n`;
    }

    // Filter out image-analyzer from remaining agents if we already ran it
    const remainingAgents = agents.filter(a => a !== 'image-analyzer');

    if (method === 'chain') {
      await runChainAgents(conv, remainingAgents, userMessage, baseContext, taskIds);
    } else if (method === 'parallel') {
      await runParallelAgents(conv, remainingAgents, userMessage, baseContext, taskIds);
    } else {
      // single
      await runSingleAgentFlow(conv, remainingAgents[0], userMessage, baseContext, taskIds);
    }

    // Final completion event
    pushSSE(conv.id, 'complete', { conversationId: conv.id });
  } catch (err) {
    logger.error(`spawnAgents crashed: ${err.message}`, { conversationId: conv.id, stack: err.stack });
    pushSSE(conv.id, 'error', { error: `Agent orchestration failed: ${err.message}` });
    pushSSE(conv.id, 'complete', { conversationId: conv.id, error: err.message });
  }
}

async function runSingleAgent(agentId, prompt, contextContent, conversationId) {
  const params = {
    prompt,
    agentId,
    workingDir: WORKING_DIR,
    allowedTools: getToolsForAgent(agentId),
  };
  if (contextContent) {
    params.context = contextContent;
  }

  pushSSE(conversationId, 'agent-status', { agentId, status: 'running' });

  let job;
  try {
    job = await queue.submitAndWait(params);
  } catch (err) {
    logger.error(`Agent ${agentId} queue error: ${err.message}`, { conversationId });
    pushSSE(conversationId, 'agent-status', {
      agentId,
      status: 'error',
      duration: 0,
      taskId: null,
    });
    return {
      taskId: null,
      result: null,
      error: err.message,
      status: 'error',
      duration: 0,
      resultFile: null,
    };
  }

  pushSSE(conversationId, 'agent-status', {
    agentId,
    status: job.status,
    duration: job.duration,
    taskId: job.taskId,
  });

  return {
    taskId: job.taskId,
    result: job.result,
    error: job.error,
    status: job.status,
    duration: job.duration,
    resultFile: job.resultFile,
  };
}

async function runChainAgents(conv, agents, userMessage, baseContext, taskIds) {
  let previousResult = baseContext;

  for (const agentId of agents) {
    const prompt = buildAgentPrompt(agentId, userMessage, previousResult);

    pushSSE(conv.id, 'agent-status', { agentId, status: 'running' });

    const result = await runSingleAgent(agentId, prompt, previousResult || null, conv.id);
    taskIds.push(result.taskId);

    const agentMsg = {
      id: newId('msg'),
      role: 'agent',
      agentId,
      content: result.result || result.error || `Agent ${agentId} failed`,
      taskId: result.taskId,
      duration: result.duration,
      status: result.status,
      timestamp: new Date().toISOString(),
    };
    conv.messages.push(agentMsg);
    persistMessage(conv.id, agentMsg);
    persistConversation(conv);
    pushSSE(conv.id, 'agent-message', agentMsg);

    if (result.status !== 'done') {
      // Chain breaks on failure
      pushSSE(conv.id, 'agent-error', {
        agentId,
        error: result.error || 'Agent failed',
      });
      break;
    }

    // Pass result as context to next agent
    previousResult = result.result;
  }
}

async function runParallelAgents(conv, agents, userMessage, baseContext, taskIds) {
  const promises = agents.map(agentId => {
    const prompt = buildAgentPrompt(agentId, userMessage, baseContext);
    return runSingleAgent(agentId, prompt, baseContext || null, conv.id)
      .then(result => ({ agentId, ...result }));
  });

  const results = await Promise.allSettled(promises);

  for (const settled of results) {
    if (settled.status === 'fulfilled') {
      const { agentId, taskId, result, error, status, duration } = settled.value;
      taskIds.push(taskId);

      const agentMsg = {
        id: newId('msg'),
        role: 'agent',
        agentId,
        content: result || error || `Agent ${agentId} failed`,
        taskId,
        duration,
        status,
        timestamp: new Date().toISOString(),
      };
      conv.messages.push(agentMsg);
      persistMessage(conv.id, agentMsg);
      pushSSE(conv.id, 'agent-message', agentMsg);
    }
  }

  persistConversation(conv);
}

async function runSingleAgentFlow(conv, agentId, userMessage, baseContext, taskIds) {
  const prompt = buildAgentPrompt(agentId, userMessage, baseContext);
  const result = await runSingleAgent(agentId, prompt, baseContext || null, conv.id);
  taskIds.push(result.taskId);

  const agentMsg = {
    id: newId('msg'),
    role: 'agent',
    agentId,
    content: result.result || result.error || `Agent ${agentId} failed`,
    taskId: result.taskId,
    duration: result.duration,
    status: result.status,
    timestamp: new Date().toISOString(),
  };
  conv.messages.push(agentMsg);
  persistMessage(conv.id, agentMsg);
  persistConversation(conv);
  pushSSE(conv.id, 'agent-message', agentMsg);
}

function buildAgentPrompt(agentId, userMessage, previousContext) {
  const rolePrompts = {
    'architect': `You are a senior software architect. Analyze this request and create a detailed implementation plan with file structure, key decisions, and step-by-step approach.`,
    'frontend-engineer': `You are a senior frontend engineer. Implement the frontend code based on the plan or request. Write clean, production-ready code. After making code changes, create a feature branch (e.g. feat/description or fix/description), stage and commit your changes with a clear commit message. NEVER add Co-Authored-By or any AI signature lines to commits. Push the branch and create a PR with gh pr create --title <title> --body <description>. Do NOT merge the PR yourself - the code-reviewer will handle that.`,
    'backend-engineer': `You are a senior backend engineer. Implement the server-side code based on the plan or request. Write clean, production-ready code. After making code changes, create a feature branch (e.g. feat/description or fix/description), stage and commit your changes with a clear commit message. NEVER add Co-Authored-By or any AI signature lines to commits. Push the branch and create a PR with gh pr create --title <title> --body <description>. Do NOT merge the PR yourself - the code-reviewer will handle that.`,
    'integration-engineer': `You are an integration engineer. Review the implementation, ensure all parts work together, run tests if applicable, and fix any issues. After making code changes, create a feature branch (e.g. feat/description or fix/description), stage and commit your changes with a clear commit message. NEVER add Co-Authored-By or any AI signature lines to commits. Push the branch and create a PR with gh pr create --title <title> --body <description>. Do NOT merge the PR yourself - the code-reviewer will handle that.`,
    'senior-engineer': `You are a senior software engineer. Implement the fix or feature with production-quality code. Consider edge cases and error handling. After making code changes, create a feature branch (e.g. feat/description or fix/description), stage and commit your changes with a clear commit message. NEVER add Co-Authored-By or any AI signature lines to commits. Push the branch and create a PR with gh pr create --title <title> --body <description>. Do NOT merge the PR yourself - the code-reviewer will handle that.`,
    'investigator': `You are a bug investigator. Analyze the issue, search the codebase for root causes, and document your findings with specific file paths and line numbers.`,
    'qa-reviewer': `You are a QA reviewer. Review the changes made, verify correctness, check for edge cases, and confirm the implementation meets requirements.`,
    'security-auditor': `You are a security auditor. Perform a thorough security review of the code. Look for vulnerabilities (OWASP Top 10), injection risks, auth issues, and data exposure.`,
    'tech-lead': `You are a tech lead. Review the findings and prioritize the issues. Create an action plan for fixes.`,
    'ui-architect': `You are a UI/UX architect. Design the user interface, layout, color scheme, and interaction patterns. Provide detailed specs.`,
    'researcher': `You are a research engineer. Analyze the codebase thoroughly to answer the question. Provide clear, detailed explanations with references to specific code.`,
    'documentation-agent': `You are a documentation specialist. Write clear, comprehensive documentation.`,
    'general-agent': `You are a helpful software engineering assistant. Handle this request thoroughly.`,
    'code-reviewer': `You are a senior code reviewer. Review the pull request created by the engineering team. Use gh pr list to find recent PRs, gh pr diff <number> to review the code changes, and gh pr view <number> for details. If the code looks good, approve with gh pr review <number> --approve and merge with gh pr merge <number> --merge --delete-branch. If you find issues, request changes with gh pr review <number> --request-changes --body <your feedback>.`,
    'image-analyzer': `You are an image analysis specialist. Describe the image contents in detail.`,
  };

  const role = rolePrompts[agentId] || rolePrompts['general-agent'];
  let prompt = `${role}\n\n## User Request\n${userMessage}`;

  if (previousContext) {
    prompt += `\n\n## Previous Context\n${previousContext}`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /api/chat/send — Send a message, detect intent, spawn agents
chatRouter.post('/api/chat/send', async (req, res, next) => {
  try {
    const { conversationId, message, files = [] } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'message is required' });
    }

    const trimmedMessage = message.trim();

    // Load or create conversation
    let conv;
    if (conversationId) {
      conv = loadConversation(conversationId);
      if (!conv) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
    } else {
      conv = {
        id: newId('conv'),
        title: generateTitle(trimmedMessage),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      persistConversation(conv);
    }

    // Add user message
    const userMsg = {
      id: newId('msg'),
      role: 'user',
      content: trimmedMessage,
      files,
      timestamp: new Date().toISOString(),
    };
    conv.messages.push(userMsg);
    persistMessage(conv.id, userMsg);

    // Detect intent
    const routing = detectIntent(trimmedMessage, files);

    // Add system message about routing
    const systemMsg = {
      id: newId('msg'),
      role: 'system',
      content: `Routing: **${routing.pattern}** — Spawning ${routing.agents.join(' → ')} (${routing.method})`,
      routing,
      timestamp: new Date().toISOString(),
    };
    conv.messages.push(systemMsg);
    persistMessage(conv.id, systemMsg);
    persistConversation(conv);

    // Respond immediately
    res.json({
      conversationId: conv.id,
      messageId: userMsg.id,
      routing,
    });

    // Spawn agents in background (don't await — results come via SSE)
    pushSSE(conv.id, 'routing', { routing, conversationId: conv.id });

    spawnAgents(conv, routing, trimmedMessage, files).catch(err => {
      logger.error(`Agent orchestration failed: ${err.message}`, { conversationId: conv.id });
      pushSSE(conv.id, 'error', { error: err.message });
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/upload — Upload files
chatRouter.post('/api/chat/upload', upload.array('files', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const result = req.files.map(f => ({
    filename: f.originalname,
    path: f.path,
    type: f.mimetype,
    size: f.size,
  }));

  res.json({ files: result });
});

// Handle multer errors
chatRouter.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err.message && err.message.includes('not allowed')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// GET /api/chat/conversations — List all conversations
chatRouter.get('/api/chat/conversations', (req, res, next) => {
  try {
    const conversations = db.getConversations();
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/conversations/:id — Get single conversation
chatRouter.get('/api/chat/conversations/:id', (req, res, next) => {
  try {
    const conv = loadConversation(req.params.id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json(conv);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chat/conversations/:id — Delete conversation
chatRouter.delete('/api/chat/conversations/:id', (req, res, next) => {
  try {
    const id = req.params.id;
    const deleted = db.deleteConversation(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    res.json({ deleted: true, id });
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/files — List uploaded files
chatRouter.get('/api/chat/files', async (req, res, next) => {
  try {
    const uploadsDir = join(config.WORKSPACE, 'uploads');
    let files;
    try {
      files = await readdir(uploadsDir);
    } catch {
      return res.json({ files: [] });
    }

    const fileList = [];
    for (const filename of files) {
      if (filename.startsWith('.')) continue;
      try {
        const filePath = join(uploadsDir, filename);
        const s = await stat(filePath);
        const ext = extname(filename).toLowerCase();
        const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);

        fileList.push({
          filename,
          path: filePath,
          size: s.size,
          createdAt: s.birthtime.toISOString(),
          isImage,
          ext,
        });
      } catch {
        // skip
      }
    }

    // Sort by createdAt descending
    fileList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ files: fileList });
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/stream/:conversationId — SSE for real-time updates
chatRouter.get('/api/chat/stream/:conversationId', (req, res) => {
  const { conversationId } = req.params;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial heartbeat
  res.write(`event: connected\ndata: ${JSON.stringify({ conversationId })}\n\n`);

  // Register this client
  if (!sseClients.has(conversationId)) {
    sseClients.set(conversationId, new Set());
  }
  sseClients.get(conversationId).add(res);

  // Also forward timeline events relevant to this conversation
  const unsubscribe = onTimelineEvent(event => {
    try {
      res.write(`event: timeline\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      // disconnected
    }
  });

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
    } catch {
      // disconnected
    }
  }, 15000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    const clients = sseClients.get(conversationId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) {
        sseClients.delete(conversationId);
      }
    }
    logger.debug('Chat SSE client disconnected', { conversationId });
  });

  logger.debug('Chat SSE client connected', { conversationId });
});

// Serve uploaded files statically
chatRouter.get('/api/chat/uploads/:filename', (req, res) => {
  const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
  const filePath = join(config.WORKSPACE, 'uploads', filename);
  res.sendFile(filePath, err => {
    if (err) {
      res.status(404).json({ error: 'File not found' });
    }
  });
});
