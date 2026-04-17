import crypto from 'crypto';
import Database from 'better-sqlite3';
import { join } from 'path';
import { readFileSync } from 'fs';
import { readdir } from 'fs/promises';
import { config } from './config.mjs';
import { logger } from './utils/logger.mjs';

let db;

export function initDatabase() {
  const dbPath = join(config.WORKSPACE, 'bridge.db');
  db = new Database(dbPath);

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  createTables();
  migrateJobsTable();
  logger.info(`SQLite database initialized at ${dbPath}`);
  return db;
}

function migrateJobsTable() {
  const cols = new Set(db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name));
  const adds = [
    { name: 'pid', type: 'INTEGER' },
    { name: 'output_path', type: 'TEXT' },
    { name: 'error_path', type: 'TEXT' },
  ];
  for (const { name, type } of adds) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
      logger.info(`Migrated jobs table: added column ${name} ${type}`);
    }
  }
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      agent_id TEXT,
      content TEXT,
      files TEXT,
      routing TEXT,
      task_id TEXT,
      duration INTEGER,
      status TEXT,
      timestamp TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      status TEXT,
      prompt TEXT,
      result TEXT,
      error TEXT,
      working_dir TEXT,
      created_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      duration INTEGER,
      exit_code INTEGER,
      result_file TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_agent ON jobs(agent_id);

    CREATE TABLE IF NOT EXISTS uploaded_files (
      id TEXT PRIMARY KEY,
      filename TEXT,
      original_name TEXT,
      path TEXT,
      mimetype TEXT,
      size INTEGER,
      conversation_id TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agent_stats (
      agent_id TEXT PRIMARY KEY,
      total_tasks INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      timeout_count INTEGER DEFAULT 0,
      total_duration INTEGER DEFAULT 0,
      last_active_at TEXT
    );

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL UNIQUE,
      turn_number INTEGER NOT NULL DEFAULT 1,
      summary_text TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_summaries_conversation ON conversation_summaries(conversation_id);
  `);
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

const stmtCache = {};

function stmt(key, sql) {
  if (!stmtCache[key]) {
    stmtCache[key] = db.prepare(sql);
  }
  return stmtCache[key];
}

export function getConversations() {
  const convs = stmt('getConvs',
    `SELECT c.id, c.title, c.created_at AS createdAt, c.updated_at AS updatedAt,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messageCount,
            (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.timestamp DESC LIMIT 1) AS lastMessage
     FROM conversations c
     ORDER BY c.updated_at DESC`
  ).all();

  return convs.map(c => ({
    ...c,
    lastMessage: c.lastMessage ? c.lastMessage.slice(0, 100) : null,
  }));
}

export function getConversation(id) {
  const conv = stmt('getConv',
    `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE id = ?`
  ).get(id);

  if (!conv) return null;

  const messages = stmt('getConvMsgs',
    `SELECT id, conversation_id, role, agent_id AS agentId, content, files, routing,
            task_id AS taskId, duration, status, timestamp
     FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC`
  ).all(id);

  conv.messages = messages.map(m => ({
    ...m,
    files: m.files ? JSON.parse(m.files) : undefined,
    routing: m.routing ? JSON.parse(m.routing) : undefined,
  }));

  return conv;
}

export function saveConversation(conv) {
  const now = new Date().toISOString();

  const upsertConv = stmt('upsertConv',
    `INSERT INTO conversations (id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`
  );

  upsertConv.run(conv.id, conv.title, conv.createdAt, now);
}

export function addMessage(conversationId, msg) {
  const ins = stmt('insertMsg',
    `INSERT OR REPLACE INTO messages (id, conversation_id, role, agent_id, content, files, routing, task_id, duration, status, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  ins.run(
    msg.id,
    conversationId,
    msg.role,
    msg.agentId || null,
    msg.content || null,
    msg.files ? JSON.stringify(msg.files) : null,
    msg.routing ? JSON.stringify(msg.routing) : null,
    msg.taskId || null,
    msg.duration || null,
    msg.status || null,
    msg.timestamp,
  );
}

export function deleteConversation(id) {
  const conv = stmt('getConv',
    `SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM conversations WHERE id = ?`
  ).get(id);

  if (!conv) return false;

  stmt('delSummary', `DELETE FROM conversation_summaries WHERE conversation_id = ?`).run(id);
  stmt('delMsgs', `DELETE FROM messages WHERE conversation_id = ?`).run(id);
  stmt('delConv', `DELETE FROM conversations WHERE id = ?`).run(id);
  return true;
}

// ---------------------------------------------------------------------------
// Conversation Summaries
// ---------------------------------------------------------------------------

export function upsertSummary({ conversationId, turnNumber, summaryText, metadata }) {
  const now = new Date().toISOString();
  const id = `summary-${crypto.randomUUID().slice(0, 12)}`;

  stmt('upsertSummary',
    `INSERT INTO conversation_summaries (id, conversation_id, turn_number, summary_text, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       turn_number = excluded.turn_number,
       summary_text = excluded.summary_text,
       metadata = excluded.metadata,
       updated_at = excluded.updated_at`
  ).run(
    id,
    conversationId,
    turnNumber,
    summaryText,
    metadata ? JSON.stringify(metadata) : null,
    now,
    now,
  );
}

export function getSummary(conversationId) {
  const row = stmt('getSummary',
    `SELECT summary_text AS summaryText, turn_number AS turnNumber, metadata, updated_at AS updatedAt
     FROM conversation_summaries WHERE conversation_id = ?`
  ).get(conversationId);

  if (!row) return null;

  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

export function deleteSummary(conversationId) {
  stmt('delSummaryById', `DELETE FROM conversation_summaries WHERE conversation_id = ?`).run(conversationId);
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export function saveJob(job) {
  const upsert = stmt('upsertJob',
    `INSERT INTO jobs (id, agent_id, status, prompt, result, error, working_dir, created_at, started_at, finished_at, duration, exit_code, result_file, pid, output_path, error_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status, result = excluded.result, error = excluded.error,
       started_at = excluded.started_at, finished_at = excluded.finished_at,
       duration = excluded.duration, exit_code = excluded.exit_code, result_file = excluded.result_file,
       pid = excluded.pid, output_path = excluded.output_path, error_path = excluded.error_path`
  );

  upsert.run(
    job.taskId,
    job.agentId,
    job.status,
    job.prompt ? job.prompt.slice(0, 200) : '',
    job.result || null,
    job.error || null,
    job.workingDir || null,
    job.createdAt || null,
    job.startedAt || null,
    job.finishedAt || null,
    job.duration || null,
    job.exitCode ?? null,
    job.resultFile || null,
    job.pid ?? null,
    job.outputPath || null,
    job.errorPath || null,
  );

  // Update agent_stats
  updateAgentStats(job);
}

export function getRunningJobs() {
  return stmt('getRunning',
    `SELECT id AS taskId, agent_id AS agentId, status, prompt, working_dir AS workingDir,
            created_at AS createdAt, started_at AS startedAt, pid,
            output_path AS outputPath, error_path AS errorPath, result_file AS resultFile
     FROM jobs
     WHERE status = 'running'`
  ).all();
}

function updateAgentStats(job) {
  if (!['done', 'error', 'timeout'].includes(job.status)) return;

  const existing = stmt('getAgentStat',
    `SELECT * FROM agent_stats WHERE agent_id = ?`
  ).get(job.agentId);

  if (!existing) {
    stmt('insertAgentStat',
      `INSERT INTO agent_stats (agent_id, total_tasks, success_count, error_count, timeout_count, total_duration, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      job.agentId,
      1,
      job.status === 'done' ? 1 : 0,
      job.status === 'error' ? 1 : 0,
      job.status === 'timeout' ? 1 : 0,
      job.duration || 0,
      job.finishedAt,
    );
  } else {
    stmt('updateAgentStat',
      `UPDATE agent_stats SET
        total_tasks = total_tasks + 1,
        success_count = success_count + ?,
        error_count = error_count + ?,
        timeout_count = timeout_count + ?,
        total_duration = total_duration + ?,
        last_active_at = ?
       WHERE agent_id = ?`
    ).run(
      job.status === 'done' ? 1 : 0,
      job.status === 'error' ? 1 : 0,
      job.status === 'timeout' ? 1 : 0,
      job.duration || 0,
      job.finishedAt,
      job.agentId,
    );
  }
}

export function getCompletedJobs(limit = 500) {
  return stmt('getCompleted',
    `SELECT id AS taskId, agent_id AS agentId, status, prompt, duration,
            started_at AS startedAt, finished_at AS finishedAt, exit_code AS exitCode, error
     FROM jobs
     WHERE status IN ('done', 'error', 'timeout', 'cancelled')
     ORDER BY finished_at DESC
     LIMIT ?`
  ).all(limit);
}

export function getPerformanceStats() {
  const rows = stmt('perfStats',
    `SELECT agent_id AS agentId, total_tasks, success_count, error_count, timeout_count,
            total_duration, last_active_at AS lastActiveAt
     FROM agent_stats`
  ).all();

  return rows;
}

// ---------------------------------------------------------------------------
// Uploaded files
// ---------------------------------------------------------------------------

export function saveUploadedFile(file) {
  stmt('insertFile',
    `INSERT INTO uploaded_files (id, filename, original_name, path, mimetype, size, conversation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    file.id,
    file.filename,
    file.originalName,
    file.path,
    file.mimetype,
    file.size,
    file.conversationId || null,
    file.createdAt || new Date().toISOString(),
  );
}

export function getUploadedFiles() {
  return stmt('getFiles',
    `SELECT id, filename, original_name AS originalName, path, mimetype, size,
            conversation_id AS conversationId, created_at AS createdAt
     FROM uploaded_files
     ORDER BY created_at DESC`
  ).all();
}

// ---------------------------------------------------------------------------
// Migration: import existing JSON conversations
// ---------------------------------------------------------------------------

export async function migrateJsonConversations() {
  const convDir = join(config.WORKSPACE, 'conversations');
  let files;
  try {
    files = await readdir(convDir);
  } catch {
    return; // no conversations dir yet
  }

  const jsonFiles = files.filter(f => f.endsWith('.json'));
  if (jsonFiles.length === 0) return;

  // Check if we already have conversations in the DB
  const count = db.prepare('SELECT COUNT(*) AS cnt FROM conversations').get().cnt;
  if (count > 0) {
    logger.info(`SQLite already has ${count} conversations, skipping JSON migration`);
    return;
  }

  logger.info(`Migrating ${jsonFiles.length} JSON conversations to SQLite...`);

  const insertConv = db.prepare(
    `INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`
  );
  const insertMsg = db.prepare(
    `INSERT OR IGNORE INTO messages (id, conversation_id, role, agent_id, content, files, routing, task_id, duration, status, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const migrate = db.transaction(() => {
    for (const file of jsonFiles) {
      try {
        // readFileSync since we're inside a transaction
        const raw = readFileSync(join(convDir, file), 'utf-8');
        const conv = JSON.parse(raw);

        insertConv.run(conv.id, conv.title, conv.createdAt, conv.updatedAt);

        if (conv.messages) {
          for (const msg of conv.messages) {
            insertMsg.run(
              msg.id,
              conv.id,
              msg.role,
              msg.agentId || null,
              msg.content || null,
              msg.files ? JSON.stringify(msg.files) : null,
              msg.routing ? JSON.stringify(msg.routing) : null,
              msg.taskId || null,
              msg.duration || null,
              msg.status || null,
              msg.timestamp,
            );
          }
        }
      } catch (err) {
        logger.warn(`Failed to migrate ${file}: ${err.message}`);
      }
    }
  });

  migrate();
  logger.info('JSON conversation migration complete');
}

export function closeDatabase() {
  if (db) {
    db.close();
    logger.info('SQLite database closed');
  }
}
