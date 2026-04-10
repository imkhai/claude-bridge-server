import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from './config.mjs';
import { queue } from './queue.mjs';
import * as db from './db.mjs';
import { logger } from './utils/logger.mjs';

const SUMMARIES_DIR = join(config.WORKSPACE, 'summaries');

export async function generateSummary(conversationId, turnMessages, turnNumber) {
  if (!config.SUMMARY_ENABLED) return null;

  const summaryPath = join(SUMMARIES_DIR, `summary-${conversationId}.md`);

  // Load existing summary if this is a follow-up turn
  let existingSummary = '';
  try {
    existingSummary = await readFile(summaryPath, 'utf-8');
  } catch {
    // No prior summary — first turn
  }

  // Build the input for the summarizer
  const turnContent = turnMessages.map(msg => {
    if (msg.role === 'user') return `**User:** ${msg.content}`;
    if (msg.role === 'agent') return `**Agent (${msg.agentId}):** ${msg.content.slice(0, config.SUMMARY_MAX_TURN_CHARS)}`;
    if (msg.role === 'system') return `**System:** ${msg.content}`;
    return '';
  }).join('\n\n---\n\n');

  const prompt = buildSummarizerPrompt(conversationId, turnNumber, existingSummary, turnContent);

  const startMs = Date.now();

  try {
    const job = await queue.submitAndWait({
      prompt,
      agentId: 'summarizer',
      workingDir: config.WORKSPACE,
      allowedTools: [],
      maxTurns: 1,
    });

    const duration = Date.now() - startMs;

    if (job.status === 'done' && job.result) {
      const summaryText = job.result.trim().slice(0, config.SUMMARY_MAX_CHARS);

      // Write to file
      await writeFile(summaryPath, summaryText, 'utf-8');

      // Upsert to SQLite
      db.upsertSummary({
        conversationId,
        turnNumber,
        summaryText,
        metadata: {
          agentIds: turnMessages.filter(m => m.role === 'agent').map(m => m.agentId),
          generationDurationMs: duration,
          tokensEstimate: Math.ceil(summaryText.length / 4),
        },
      });

      logger.info(`Summary generated for ${conversationId} (turn ${turnNumber}, ${summaryText.length} chars, ${duration}ms)`);
      return summaryText;
    } else {
      logger.error(`Summarizer failed for ${conversationId}: ${job.error}`);
      return null;
    }
  } catch (err) {
    logger.error(`Summary generation error for ${conversationId}: ${err.message}`);
    return null;
  }
}

function buildSummarizerPrompt(conversationId, turnNumber, existingSummary, turnContent) {
  let prompt = `You are a conversation summarizer for a multi-agent coding system. Your job is to produce a concise, structured summary that will be injected as context for future agents working on this conversation.

## Rules
- Output ONLY the summary in the exact Markdown format below — no preamble, no explanation
- Keep the entire summary under 2000 tokens (~1500 words / ~6000 characters)
- Be specific: include file paths, function names, error messages, PR numbers
- Compress older turns more aggressively than recent ones
- Preserve all key decisions and their rationale
- Track what's done vs. what's still pending

## Output Format

# Conversation Summary
**Conversation:** ${conversationId}
**Turn:** ${turnNumber}
**Updated:** {current ISO timestamp}

## What Was Asked
{bullet per turn, 1-2 sentences each}

## What Was Done
{bullet per significant action, be specific}

## Key Decisions
{bullet per decision with rationale}

## Files Changed
{bullet per file with what changed}

## Current State
{1-3 sentences}

## Open Items
{bullets for anything unresolved}
`;

  if (existingSummary) {
    prompt += `\n\n## Previous Summary (turns 1-${turnNumber - 1})\n\n${existingSummary}`;
  }

  prompt += `\n\n## New Turn ${turnNumber} Content\n\n${turnContent}`;

  return prompt;
}

export async function loadSummary(conversationId) {
  // Try SQLite first (faster)
  const row = db.getSummary(conversationId);
  if (row) return row.summaryText;

  // Fall back to file
  try {
    const summaryPath = join(SUMMARIES_DIR, `summary-${conversationId}.md`);
    return await readFile(summaryPath, 'utf-8');
  } catch {
    return null;
  }
}
