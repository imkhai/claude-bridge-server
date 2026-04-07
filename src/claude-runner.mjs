import { spawn } from 'child_process';
import { config } from './config.mjs';
import { logger } from './utils/logger.mjs';

const MAX_BUFFER = 10 * 1024 * 1024; // 10MB
const processes = new Map();

class ClaudeProcessError extends Error {
  constructor(type, message, exitCode, stderr) {
    super(message);
    this.type = type;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export async function checkClaudeCli() {
  // Validate CLAUDE_PATH doesn't contain suspicious characters
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

export function runClaude({ prompt, contextFile, workingDir, taskId, agentId, allowedTools, disallowedTools, maxTurns }) {
  return new Promise((resolve, reject) => {
    let fullPrompt = prompt;
    if (contextFile) {
      // Use clear delimiters and sanitize the path string to prevent prompt injection via filename
      const safePath = contextFile.replace(/[^a-zA-Z0-9\-_./]/g, '_');
      fullPrompt = `<context-file>${safePath}</context-file>\nRead the above file for context, then complete this task:\n${prompt}`;
    }

    const args = ['-p', fullPrompt, '--no-session-persistence'];

    // Tool permissions: allow Claude to use tools (read/write files, run commands, etc.)
    // Per-task allowedTools override, or fall back to DEFAULT_ALLOWED_TOOLS from config
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

    const proc = spawn(config.CLAUDE_PATH, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    processes.set(taskId, proc);

    let stdout = '';
    let stderr = '';
    let bufferSize = 0;
    let killed = false;

    // Timeout handling
    const timer = setTimeout(() => {
      killed = true;
      logger.warn(`Process timed out after ${config.TIMEOUT_MS}ms`, { taskId, agentId });
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
    }, config.TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => {
      bufferSize += chunk.length;
      if (bufferSize > MAX_BUFFER) {
        killed = true;
        logger.error(`Buffer limit exceeded (${MAX_BUFFER} bytes)`, { taskId, agentId });
        proc.kill('SIGKILL');
        return;
      }
      stdout += chunk;
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      processes.delete(taskId);

      if (killed && bufferSize > MAX_BUFFER) {
        reject(new ClaudeProcessError('error', 'Buffer limit exceeded', code, stderr));
      } else if (killed) {
        reject(new ClaudeProcessError('timeout', `Process timed out after ${config.TIMEOUT_MS}ms`, code, stderr));
      } else if (code !== 0) {
        reject(new ClaudeProcessError('error', `Process exited with code ${code}`, code, stderr));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      processes.delete(taskId);
      reject(new ClaudeProcessError('error', err.message, null, ''));
    });
  });
}

export function cancelProcess(taskId) {
  const proc = processes.get(taskId);
  if (!proc) return false;

  proc.kill('SIGTERM');
  setTimeout(() => {
    if (!proc.killed) {
      proc.kill('SIGKILL');
    }
  }, 5000);
  return true;
}

export function killAllProcesses() {
  for (const [taskId, proc] of processes) {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }, 5000);
  }
}
