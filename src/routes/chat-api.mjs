import { Router } from 'express';
import { readdir, stat, unlink } from 'fs/promises';
import { join, extname } from 'path';
import multer from 'multer';
import { config } from '../config.mjs';
import { onTimelineEvent } from '../queue.mjs';
import { logger } from '../utils/logger.mjs';
import * as db from '../db.mjs';
import {
  newId,
  loadConversation,
  persistConversation,
  persistMessage,
  generateTitle,
  detectIntent,
  spawnAgents,
} from '../chat-engine.mjs';
import { generateSummary, loadSummary } from '../summarizer.mjs';

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
// Helpers
// ---------------------------------------------------------------------------

function getTurnMessages(conv, turnNumber) {
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

    // Load conversation memory for existing conversations
    let conversationContext = null;
    if (conversationId) {
      conversationContext = await loadSummary(conv.id);
    }

    // Respond immediately
    res.json({
      conversationId: conv.id,
      messageId: userMsg.id,
      routing,
    });

    // Spawn agents in background (don't await — results come via SSE)
    pushSSE(conv.id, 'routing', { routing, conversationId: conv.id });

    const pushUpdate = (event, data) => pushSSE(conv.id, event, data);

    spawnAgents(conv, routing, trimmedMessage, files, pushUpdate, conversationContext).then(() => {
      // Generate summary after all agents complete
      if (config.SUMMARY_ENABLED) {
        const turnNumber = conv.messages.filter(m => m.role === 'user').length;
        const turnMessages = getTurnMessages(conv, turnNumber);
        pushSSE(conv.id, 'summary-generating', { conversationId: conv.id });
        generateSummary(conv.id, turnMessages, turnNumber).then(summary => {
          if (summary) {
            pushSSE(conv.id, 'summary-ready', { conversationId: conv.id, turnNumber, tokensEstimate: Math.ceil(summary.length / 4) });
          }
        }).catch(err => {
          logger.error(`Summary generation failed: ${err.message}`, { conversationId: conv.id });
          pushSSE(conv.id, 'summary-error', { conversationId: conv.id, error: err.message });
        });
      }
    }).catch(err => {
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

    const summaryRow = db.getSummary(req.params.id);
    if (summaryRow) {
      conv.summary = {
        turnNumber: summaryRow.turnNumber,
        text: summaryRow.summaryText,
        updatedAt: summaryRow.updatedAt,
      };
    }

    res.json(conv);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chat/conversations/:id — Delete conversation
chatRouter.delete('/api/chat/conversations/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const deleted = db.deleteConversation(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Remove summary file
    try {
      await unlink(join(config.WORKSPACE, 'summaries', `summary-${id}.md`));
    } catch { /* file may not exist */ }

    res.json({ deleted: true, id });
  } catch (err) {
    next(err);
  }
});

// GET /api/chat/conversations/:id/summary — Get conversation summary
chatRouter.get('/api/chat/conversations/:id/summary', (req, res, next) => {
  try {
    const summaryRow = db.getSummary(req.params.id);
    if (!summaryRow) {
      return res.status(404).json({ error: 'No summary found for this conversation' });
    }

    res.json({
      conversationId: req.params.id,
      turnNumber: summaryRow.turnNumber,
      summary: summaryRow.summaryText,
      metadata: summaryRow.metadata,
      updatedAt: summaryRow.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/chat/conversations/:id/summary/regenerate — Force-regenerate summary
chatRouter.post('/api/chat/conversations/:id/summary/regenerate', async (req, res, next) => {
  try {
    const conv = loadConversation(req.params.id);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const turnNumber = conv.messages.filter(m => m.role === 'user').length;
    if (turnNumber === 0) {
      return res.status(400).json({ error: 'No user messages in conversation' });
    }

    res.json({
      conversationId: conv.id,
      status: 'queued',
      message: 'Summary regeneration queued',
    });

    // Regenerate in background
    const turnMessages = getTurnMessages(conv, turnNumber);
    pushSSE(conv.id, 'summary-generating', { conversationId: conv.id });
    generateSummary(conv.id, turnMessages, turnNumber).then(summary => {
      if (summary) {
        pushSSE(conv.id, 'summary-ready', { conversationId: conv.id, turnNumber, tokensEstimate: Math.ceil(summary.length / 4) });
      }
    }).catch(err => {
      logger.error(`Summary regeneration failed: ${err.message}`, { conversationId: conv.id });
      pushSSE(conv.id, 'summary-error', { conversationId: conv.id, error: err.message });
    });
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

  res.write(`event: connected\ndata: ${JSON.stringify({ conversationId })}\n\n`);

  if (!sseClients.has(conversationId)) {
    sseClients.set(conversationId, new Set());
  }
  sseClients.get(conversationId).add(res);

  const unsubscribe = onTimelineEvent(event => {
    try {
      res.write(`event: timeline\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      // disconnected
    }
  });

  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
    } catch {
      // disconnected
    }
  }, 15000);

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
