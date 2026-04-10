import crypto from 'crypto';
import { Router } from 'express';
import { config } from '../config.mjs';
import { logger } from '../utils/logger.mjs';
import { validatePathWithinWorkspace } from '../utils/validators.mjs';
import { getTelegram, sendMessage, sendFile } from '../telegram.mjs';

export const telegramRouter = Router();

// POST /api/telegram/webhook — Telegram webhook endpoint
telegramRouter.post('/api/telegram/webhook', (req, res) => {
  const bot = getTelegram();
  if (!bot) {
    return res.status(503).json({ error: 'Telegram bot not initialized' });
  }

  // Validate webhook secret if configured
  if (config.TELEGRAM_WEBHOOK_SECRET) {
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'] || '';
    const expected = config.TELEGRAM_WEBHOOK_SECRET;

    const bufA = Buffer.from(secretHeader);
    const bufB = Buffer.from(expected);
    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
      logger.warn('Telegram webhook: invalid secret token');
      return res.status(403).json({ error: 'Forbidden' });
    }
  }

  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    logger.error(`Telegram webhook processing error: ${err.message}`);
    res.sendStatus(200); // Always 200 to prevent Telegram retries
  }
});

// GET /api/telegram/status — Bot status
telegramRouter.get('/api/telegram/status', (req, res) => {
  const bot = getTelegram();
  const enabled = bot !== null;

  let mode = 'disabled';
  if (enabled) {
    mode = config.TELEGRAM_WEBHOOK_URL ? 'webhook' : 'polling';
  }

  res.json({
    enabled,
    mode,
    chatId: config.TELEGRAM_CHAT_ID || null,
    connected: enabled,
  });
});

// POST /api/telegram/send — Manual send message
telegramRouter.post('/api/telegram/send', async (req, res, next) => {
  try {
    const { chatId, message } = req.body;

    if (!chatId || !message) {
      return res.status(400).json({ error: 'chatId and message are required' });
    }

    const result = await sendMessage(String(chatId), message);
    if (!result) {
      return res.status(500).json({ error: 'Failed to send message' });
    }

    res.json({ ok: true, messageId: result.message_id });
  } catch (err) {
    next(err);
  }
});

// POST /api/telegram/send-file — Manual send file
telegramRouter.post('/api/telegram/send-file', async (req, res, next) => {
  try {
    const { chatId, filePath, caption } = req.body;

    if (!chatId || !filePath) {
      return res.status(400).json({ error: 'chatId and filePath are required' });
    }

    let validatedPath;
    try {
      validatedPath = validatePathWithinWorkspace(filePath, 'filePath');
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const result = await sendFile(String(chatId), validatedPath, caption);
    if (!result) {
      return res.status(500).json({ error: 'Failed to send file' });
    }

    res.json({ ok: true, messageId: result.message_id });
  } catch (err) {
    next(err);
  }
});
