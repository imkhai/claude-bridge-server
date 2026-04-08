import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import TelegramBot from 'node-telegram-bot-api';
import { config } from './config.mjs';
import { logger } from './utils/logger.mjs';
import {
  newId,
  loadConversation,
  persistConversation,
  persistMessage,
  generateTitle,
  detectIntent,
  spawnAgents,
} from './chat-engine.mjs';

let bot = null;

// ---------------------------------------------------------------------------
// Rate limiter — token bucket (30 msgs/sec)
// ---------------------------------------------------------------------------
const RATE_LIMIT = 30;
const timestamps = [];

function canSend() {
  const now = Date.now();
  while (timestamps.length > 0 && timestamps[0] < now - 1000) {
    timestamps.shift();
  }
  return timestamps.length < RATE_LIMIT;
}

async function waitForSlot() {
  while (!canSend()) {
    await new Promise(r => setTimeout(r, 50));
  }
  timestamps.push(Date.now());
}

// ---------------------------------------------------------------------------
// MarkdownV2 escaping
// ---------------------------------------------------------------------------
const MD_ESCAPE_RE = /[_*[\]()~`>#+=|{}.!-]/g;

export function escapeMarkdownV2(text) {
  return text.replace(MD_ESCAPE_RE, '\\$&');
}

// ---------------------------------------------------------------------------
// Message splitting (Telegram 4096 char limit)
// ---------------------------------------------------------------------------
const MAX_MSG_LEN = 4096;

function splitMessage(text) {
  if (text.length <= MAX_MSG_LEN) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > MAX_MSG_LEN) {
    let splitIdx = remaining.lastIndexOf('\n', MAX_MSG_LEN);
    if (splitIdx <= 0) {
      splitIdx = MAX_MSG_LEN;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n/, '');
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initTelegram() {
  if (!config.TELEGRAM_BOT_TOKEN) {
    logger.warn('Telegram: disabled (no TELEGRAM_BOT_TOKEN)');
    return null;
  }

  const options = {};

  if (config.TELEGRAM_WEBHOOK_URL) {
    options.webHook = false;
    bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, options);
    await bot.setWebHook(config.TELEGRAM_WEBHOOK_URL, {
      secret_token: config.TELEGRAM_WEBHOOK_SECRET || undefined,
    });
    logger.info(`Telegram: enabled (webhook)`);
  } else {
    options.polling = true;
    bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, options);
    logger.info('Telegram: enabled (polling)');
  }

  bot.on('message', handleInboundMessage);

  bot.on('polling_error', err => {
    logger.error(`Telegram polling error: ${err.message}`);
  });

  const tokenLast4 = config.TELEGRAM_BOT_TOKEN.slice(-4);
  logger.info(`Telegram: token ****${tokenLast4}, chat filter: ${config.TELEGRAM_CHAT_ID || 'any'}`);

  return bot;
}

export function getTelegram() {
  return bot;
}

export async function sendMessage(chatId, text, options = {}) {
  if (!bot) return null;
  await waitForSlot();

  const chunks = splitMessage(text);
  let lastMsg = null;

  for (const chunk of chunks) {
    try {
      lastMsg = await bot.sendMessage(chatId, chunk, options);
    } catch (err) {
      logger.error(`Telegram sendMessage error: ${err.message}`, { chatId });
    }
  }

  return lastMsg;
}

export async function sendFile(chatId, filePath, caption) {
  if (!bot) return null;
  await waitForSlot();

  try {
    return await bot.sendDocument(chatId, filePath, { caption });
  } catch (err) {
    logger.error(`Telegram sendFile error: ${err.message}`, { chatId, filePath });
    return null;
  }
}

export async function sendPhoto(chatId, filePath, caption) {
  if (!bot) return null;
  await waitForSlot();

  try {
    return await bot.sendPhoto(chatId, filePath, { caption });
  } catch (err) {
    logger.error(`Telegram sendPhoto error: ${err.message}`, { chatId, filePath });
    return null;
  }
}

export async function shutdownTelegram() {
  if (!bot) return;
  try {
    if (bot.isPolling()) {
      await bot.stopPolling();
    }
    bot = null;
    logger.info('Telegram: shutdown complete');
  } catch (err) {
    logger.error(`Telegram shutdown error: ${err.message}`);
    bot = null;
  }
}

// ---------------------------------------------------------------------------
// Inbound message handling
// ---------------------------------------------------------------------------

const conversationTelegramMap = new Map();

export function getTelegramChatForConversation(conversationId) {
  return conversationTelegramMap.get(conversationId) || null;
}

async function handleInboundMessage(msg) {
  const chatId = msg.chat.id;

  if (config.TELEGRAM_CHAT_ID && String(chatId) !== String(config.TELEGRAM_CHAT_ID)) {
    logger.warn(`Telegram: rejected message from unauthorized chat ${chatId}`);
    return;
  }

  try {
    const text = msg.text || msg.caption || '';
    if (!text.trim()) {
      await sendMessage(chatId, 'Please send a text message.');
      return;
    }

    // Download any photos/documents
    const files = [];
    const uploadsDir = join(config.WORKSPACE, 'uploads');
    await mkdir(uploadsDir, { recursive: true });

    if (msg.photo && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1];
      const filePath = await downloadTelegramFile(photo.file_id, uploadsDir, '.jpg');
      if (filePath) files.push(filePath);
    }

    if (msg.document) {
      const filePath = await downloadTelegramFile(
        msg.document.file_id,
        uploadsDir,
        msg.document.file_name ? `.${msg.document.file_name.split('.').pop()}` : '',
      );
      if (filePath) files.push(filePath);
    }

    // Use stable conversation key per Telegram chat
    const convKey = `tg-${chatId}`;
    let conv = loadConversation(convKey);
    if (!conv) {
      conv = {
        id: convKey,
        title: generateTitle(text),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      persistConversation(conv);
    }

    conversationTelegramMap.set(conv.id, { chatId, messageId: msg.message_id });

    const userMsg = {
      id: newId('msg'),
      role: 'user',
      content: text.trim(),
      files,
      timestamp: new Date().toISOString(),
    };
    conv.messages.push(userMsg);
    persistMessage(conv.id, userMsg);

    const routing = detectIntent(text.trim(), files);

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

    await sendMessage(chatId, `🔄 Routing: ${routing.pattern} — ${routing.agents.join(' → ')} (${routing.method})`);

    const pushUpdate = (event, data) => {
      telegramPushUpdate(chatId, event, data);
    };

    spawnAgents(conv, routing, text.trim(), files, pushUpdate).catch(err => {
      logger.error(`Telegram agent orchestration failed: ${err.message}`, { chatId });
      sendMessage(chatId, `❌ Agent orchestration failed: ${err.message}`);
    });
  } catch (err) {
    logger.error(`Telegram inbound handler error: ${err.message}`, { chatId, stack: err.stack });
    await sendMessage(chatId, `❌ Error processing message: ${err.message}`);
  }
}

async function downloadTelegramFile(fileId, destDir, ext) {
  try {
    const fileLink = await bot.getFileLink(fileId);
    const response = await fetch(fileLink);

    if (!response.ok) {
      logger.error(`Telegram file download failed: HTTP ${response.status}`);
      return null;
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
      logger.warn('Telegram file too large (>50MB), skipping');
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `${Date.now()}-tg-${fileId.slice(0, 8)}${ext}`;
    const filePath = join(destDir, filename);
    await writeFile(filePath, buffer);

    logger.debug(`Telegram file saved: ${filePath} (${buffer.length} bytes)`);
    return filePath;
  } catch (err) {
    logger.error(`Telegram file download error: ${err.message}`);
    return null;
  }
}

function telegramPushUpdate(chatId, event, data) {
  switch (event) {
    case 'agent-status':
      if (data.status === 'running') {
        sendMessage(chatId, `⚙️ Agent ${data.agentId} is working...`);
      }
      break;

    case 'agent-message': {
      const content = data.content || '';
      const preview = content.length > 500 ? content.slice(0, 500) + '...' : content;
      const duration = data.duration ? `${(data.duration / 1000).toFixed(1)}s` : '?';
      const status = data.status === 'done' ? '✅' : '❌';

      sendMessage(chatId, `${status} ${data.agentId} (${duration})\n\n${preview}`);
      break;
    }

    case 'complete':
      if (!data.error) {
        sendMessage(chatId, '✅ All agents complete.');
      }
      break;

    case 'error':
      sendMessage(chatId, `❌ Error: ${data.error}`);
      break;
  }
}
