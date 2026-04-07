import { resolve, relative } from 'path';
import { config } from '../config.mjs';

/**
 * Validates that a path is within the configured workspace.
 * Returns the resolved absolute path, or throws if outside workspace.
 */
export function validatePathWithinWorkspace(inputPath, label = 'path') {
  if (!inputPath) return null;

  const resolved = resolve(inputPath);
  const workspaceResolved = resolve(config.WORKSPACE);
  const rel = relative(workspaceResolved, resolved);

  if (rel.startsWith('..') || resolve(workspaceResolved, rel) !== resolved) {
    throw new Error(`${label} must be within workspace directory`);
  }

  return resolved;
}

/**
 * Validates workingDir: must be within workspace, defaults to workspace.
 */
export function validateWorkingDir(workingDir) {
  if (!workingDir) return config.WORKSPACE;
  return validatePathWithinWorkspace(workingDir, 'workingDir');
}

/**
 * Validates contextFile: must be within workspace.
 */
export function validateContextFile(contextFile) {
  if (!contextFile) return null;
  return validatePathWithinWorkspace(contextFile, 'contextFile');
}

/**
 * Validates allowedTools against the server's DEFAULT_ALLOWED_TOOLS whitelist.
 */
export function validateAllowedTools(requestedTools) {
  if (!requestedTools) return null;
  if (!Array.isArray(requestedTools)) {
    throw new Error('allowedTools must be an array');
  }

  for (const tool of requestedTools) {
    if (typeof tool !== 'string' || tool.trim().length === 0) {
      throw new Error('Each allowedTools entry must be a non-empty string');
    }
  }

  if (config.DEFAULT_ALLOWED_TOOLS) {
    const serverAllowed = new Set(
      config.DEFAULT_ALLOWED_TOOLS.split(',').map(t => t.trim()).filter(Boolean)
    );
    const denied = requestedTools.filter(t => !serverAllowed.has(t));
    if (denied.length > 0) {
      throw new Error(`Tools not permitted by server policy: ${denied.join(', ')}`);
    }
  }

  return requestedTools;
}

/**
 * Validates and sanitizes common input fields.
 */
export function validateInputFields({ agentId, maxTurns, prompt, context }) {
  const errors = [];

  if (agentId !== undefined) {
    if (typeof agentId !== 'string' || agentId.length > 100) {
      errors.push('agentId must be a string of max 100 characters');
    }
    if (typeof agentId === 'string' && /[\x00-\x1f\x7f]/.test(agentId)) {
      errors.push('agentId must not contain control characters');
    }
  }

  if (maxTurns !== undefined && maxTurns !== null) {
    const n = Number(maxTurns);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      errors.push('maxTurns must be an integer between 1 and 100');
    }
  }

  if (prompt === undefined || prompt === null) {
    errors.push('prompt is required');
  } else {
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      errors.push('prompt must be a non-empty string');
    }
    if (typeof prompt === 'string' && prompt.length > 100_000) {
      errors.push('prompt must be under 100,000 characters');
    }
  }

  if (context !== undefined && context !== null) {
    if (typeof context !== 'string') {
      errors.push('context must be a string');
    }
    if (typeof context === 'string' && context.length > 500_000) {
      errors.push('context must be under 500,000 characters');
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
}

/**
 * Validates disallowedTools: must be an array of non-empty strings.
 */
export function validateDisallowedTools(disallowedTools) {
  if (!disallowedTools) return null;
  if (!Array.isArray(disallowedTools)) {
    throw new Error('disallowedTools must be an array');
  }

  for (const tool of disallowedTools) {
    if (typeof tool !== 'string' || tool.trim().length === 0) {
      throw new Error('Each disallowedTools entry must be a non-empty string');
    }
  }

  return disallowedTools;
}
