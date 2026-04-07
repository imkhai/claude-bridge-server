import { spawn } from 'child_process';
import { config } from './config.mjs';
import { logger } from './utils/logger.mjs';

const MAX_BUFFER = 10 * 1024 * 1024; // 10MB
const processes = new Map();

export async function checkClaudeCli() {
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

export function runClaude({ prompt, contextFile, workingDir, taskId, agentId }) {
  return new Promise((resolve, reject) => {
    let fullPrompt = prompt;
    if (contextFile) {
      fullPrompt = `Read the file at ${contextFile} for context. Then: ${prompt}`;
    }

    const args = ['-p', fullPrompt, '--no-session-persistence'];
    const cwd = workingDir || config.WORKSPACE;

    logger.info(`Spawning claude process`, { taskId, agentId });

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
        reject({ type: 'error', message: 'Buffer limit exceeded', exitCode: code, stderr });
      } else if (killed) {
        reject({ type: 'timeout', message: `Process timed out after ${config.TIMEOUT_MS}ms`, exitCode: code, stderr });
      } else if (code !== 0) {
        reject({ type: 'error', message: `Process exited with code ${code}`, exitCode: code, stderr });
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      processes.delete(taskId);
      reject({ type: 'error', message: err.message, exitCode: null, stderr: '' });
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
