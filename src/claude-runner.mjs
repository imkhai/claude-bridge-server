import { spawn } from 'child_process';
import { openSync, closeSync } from 'fs';
import { join } from 'path';
import { config } from './config.mjs';
import { logger } from './utils/logger.mjs';

export async function checkClaudeCli() {
  if (/[;&|`$]/.test(config.CLAUDE_PATH)) {
    logger.error(`CLAUDE_PATH contains suspicious characters: ${config.CLAUDE_PATH}`);
    return false;
  }

  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const proc = spawn(config.CLAUDE_PATH, ['--version'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk; });

    proc.on('close', (code) => {
      if (code === 0) {
        logger.info(`Claude CLI found: ${stdout.trim()}`);
        resolve(true);
      } else {
        logger.error(`Claude CLI check failed with exit code ${code}`);
        resolve(false);
      }
    });

    proc.on('error', (err) => {
      logger.error(`Claude CLI not found: ${err.message}`);
      resolve(false);
    });
  });
}

export function resultPaths(taskId) {
  return {
    outputPath: join(config.WORKSPACE, 'results', `result-${taskId}.md`),
    errorPath: join(config.WORKSPACE, 'results', `result-${taskId}.err`),
  };
}

export function runClaude({ prompt, contextFile, workingDir, taskId, agentId, allowedTools, disallowedTools, maxTurns }) {
  let fullPrompt = prompt;
  if (contextFile) {
    const safePath = contextFile.replace(/[^a-zA-Z0-9\-_./]/g, '_');
    fullPrompt = `<context-file>${safePath}</context-file>\nRead the above file for context, then complete this task:\n${prompt}`;
  }

  const args = ['-p', fullPrompt, '--no-session-persistence'];

  const effectiveAllowedTools = allowedTools || (config.DEFAULT_ALLOWED_TOOLS ? config.DEFAULT_ALLOWED_TOOLS.split(',').map((t) => t.trim()).filter(Boolean) : null);
  if (effectiveAllowedTools) {
    const tools = Array.isArray(effectiveAllowedTools) ? effectiveAllowedTools : [effectiveAllowedTools];
    tools.forEach((tool) => args.push('--allowedTools', tool));
  }

  if (disallowedTools) {
    const tools = Array.isArray(disallowedTools) ? disallowedTools : [disallowedTools];
    tools.forEach((tool) => args.push('--disallowedTools', tool));
  }

  const effectiveMaxTurns = maxTurns || config.DEFAULT_MAX_TURNS;
  if (effectiveMaxTurns) {
    args.push('--max-turns', String(effectiveMaxTurns));
  }
  const cwd = workingDir || config.WORKSPACE;

  logger.info(`Spawning: claude ${args.filter((a) => a !== fullPrompt).join(' ')}`, { taskId, agentId });

  const env = { ...process.env };
  delete env.CLAUDECODE;

  const { outputPath, errorPath } = resultPaths(taskId);
  const outFd = openSync(outputPath, 'w');
  const errFd = openSync(errorPath, 'w');

  let proc;
  try {
    proc = spawn(config.CLAUDE_PATH, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', outFd, errFd],
    });
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }

  const startedAt = Date.now();
  proc.unref();

  return { pid: proc.pid, outputPath, errorPath, startedAt };
}

export function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

export function killProcess(pid, signal = 'SIGTERM') {
  if (!pid) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}
