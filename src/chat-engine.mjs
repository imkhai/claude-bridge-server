import crypto from 'crypto';
import { config } from './config.mjs';
import { queue } from './queue.mjs';
import { logger } from './utils/logger.mjs';
import * as db from './db.mjs';
import { validateAllowedTools } from './utils/validators.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const IMAGE_RE = /\.(png|jpg|jpeg|gif|webp)$/i;
export const DOC_RE = /\.(md|txt|pdf)$/i;

// CHAT_WORKING_DIR allows chat agents to work outside workspace (e.g., on project source)
export const WORKING_DIR = process.env.CHAT_WORKING_DIR || config.WORKSPACE;

const CHAT_REQUESTED_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];

// Gate chat tools through the same server policy as API requests.
let DEFAULT_TOOLS;
try {
  DEFAULT_TOOLS = validateAllowedTools(CHAT_REQUESTED_TOOLS) || CHAT_REQUESTED_TOOLS;
} catch {
  DEFAULT_TOOLS = CHAT_REQUESTED_TOOLS.filter(t => {
    try { validateAllowedTools([t]); return true; } catch { return false; }
  });
}

// ---------------------------------------------------------------------------
// Conversation helpers (backed by SQLite)
// ---------------------------------------------------------------------------

export function newId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
}

export function loadConversation(id) {
  return db.getConversation(id);
}

export function persistConversation(conv) {
  db.saveConversation(conv);
}

export function persistMessage(conversationId, msg) {
  db.addMessage(conversationId, msg);
}

export function generateTitle(message) {
  const clean = message.replace(/\n/g, ' ').trim();
  if (clean.length <= 60) return clean;
  return clean.slice(0, 57) + '...';
}

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

export function detectIntent(message, files = []) {
  const lower = message.toLowerCase();
  const hasImages = files.some(f => IMAGE_RE.test(f));
  const hasDocs = files.some(f => DOC_RE.test(f));

  if (hasImages && /bug|issue|fix|broken|error|wrong|crash/i.test(lower)) {
    return { pattern: 'bug-report', agents: ['image-analyzer', 'investigator', 'senior-engineer', 'qa-reviewer', 'code-reviewer'], method: 'chain' };
  }
  if (hasDocs && /implement|build|create/i.test(lower)) {
    return { pattern: 'implementation-with-spec', agents: ['architect', 'backend-engineer', 'frontend-engineer', 'qa-reviewer', 'code-reviewer'], method: 'chain' };
  }
  if (/implement|build|create|add feature/i.test(lower)) {
    return { pattern: 'implementation', agents: ['architect', 'frontend-engineer', 'integration-engineer', 'code-reviewer'], method: 'chain' };
  }
  if (/review|audit|security/i.test(lower)) {
    return { pattern: 'review', agents: ['security-auditor', 'tech-lead', 'senior-engineer', 'qa-reviewer'], method: 'chain' };
  }
  if (/fix|bug|broken|error|crash|issue/i.test(lower)) {
    return { pattern: 'bugfix', agents: ['investigator', 'senior-engineer', 'qa-reviewer', 'code-reviewer'], method: 'chain' };
  }
  if (/design|ui |ux |layout|style|css/i.test(lower)) {
    return { pattern: 'design', agents: ['ui-architect', 'frontend-engineer'], method: 'chain' };
  }
  if (/doc|readme|update doc|write doc/i.test(lower)) {
    return { pattern: 'documentation', agents: ['documentation-agent'], method: 'single' };
  }
  if (/explain|what is|how does|how do|why does|why do|tell me about/i.test(lower)) {
    return { pattern: 'research', agents: ['researcher'], method: 'single' };
  }
  return { pattern: 'general', agents: ['general-agent'], method: 'single' };
}

// ---------------------------------------------------------------------------
// Agent prompt builder
// ---------------------------------------------------------------------------

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

export function buildAgentPrompt(agentId, userMessage, previousContext, conversationSummary = null) {
  const role = rolePrompts[agentId] || rolePrompts['general-agent'];
  let prompt = `${role}\n\n`;

  if (conversationSummary) {
    prompt += `## Conversation History\nThis is a follow-up message in an ongoing conversation. Here is what happened previously:\n\n${conversationSummary}\n\n---\n\n`;
  }

  prompt += `## User Request\n${userMessage}`;

  if (previousContext) {
    prompt += `\n\n## Previous Context\n${previousContext}`;
  }
  return prompt;
}

// ---------------------------------------------------------------------------
// Agent execution
// ---------------------------------------------------------------------------

/**
 * Run a single agent task via the queue.
 * @param {string} agentId
 * @param {string} prompt
 * @param {string|null} contextContent
 * @param {string} conversationId
 * @param {function} [pushUpdate] - callback(event, data) for status updates
 */
export async function runSingleAgent(agentId, prompt, contextContent, conversationId, pushUpdate) {
  const params = {
    prompt,
    agentId,
    workingDir: WORKING_DIR,
    allowedTools: DEFAULT_TOOLS,
  };
  if (contextContent) {
    params.context = contextContent;
  }

  if (pushUpdate) pushUpdate('agent-status', { agentId, status: 'running' });

  let job;
  try {
    job = await queue.submitAndWait(params);
  } catch (err) {
    logger.error(`Agent ${agentId} queue error: ${err.message}`, { conversationId });
    if (pushUpdate) pushUpdate('agent-status', { agentId, status: 'error', duration: 0, taskId: null });
    return { taskId: null, result: null, error: err.message, status: 'error', duration: 0, resultFile: null };
  }

  if (pushUpdate) pushUpdate('agent-status', { agentId, status: job.status, duration: job.duration, taskId: job.taskId });

  return {
    taskId: job.taskId,
    result: job.result,
    error: job.error,
    status: job.status,
    duration: job.duration,
    resultFile: job.resultFile,
  };
}

/**
 * Spawn agents based on routing.
 * @param {object} conv - conversation object
 * @param {object} routing - { pattern, agents, method }
 * @param {string} userMessage
 * @param {string[]} files - file paths
 * @param {function} pushUpdate - callback(event, data)
 */
export async function spawnAgents(conv, routing, userMessage, files, pushUpdate, conversationContext = null) {
  try {
    const { agents, method } = routing;
    const taskIds = [];

    const hasImages = files.some(f => IMAGE_RE.test(f));
    let imageAnalysis = null;

    if (hasImages && agents[0] !== 'image-analyzer') {
      const imagePaths = files.filter(f => IMAGE_RE.test(f));
      const analyzerResult = await runSingleAgent(
        'image-analyzer',
        `Analyze these images and describe what you see in detail: ${imagePaths.join(', ')}. Then explain how they relate to this request: "${userMessage}"`,
        null,
        conv.id,
        pushUpdate,
      );
      taskIds.push(analyzerResult.taskId);
      imageAnalysis = analyzerResult.result;

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
      if (pushUpdate) pushUpdate('agent-message', agentMsg);
    }

    let baseContext = '';
    if (imageAnalysis) {
      baseContext += `## Image Analysis\n${imageAnalysis}\n\n`;
    }
    const nonImageFiles = files.filter(f => !IMAGE_RE.test(f));
    if (nonImageFiles.length > 0) {
      baseContext += `## Reference Files\nThe user attached these files: ${nonImageFiles.join(', ')}. Read them for context.\n\n`;
    }

    const remainingAgents = agents.filter(a => a !== 'image-analyzer');

    if (method === 'chain') {
      await runChainAgents(conv, remainingAgents, userMessage, baseContext, taskIds, pushUpdate, conversationContext);
    } else if (method === 'parallel') {
      await runParallelAgents(conv, remainingAgents, userMessage, baseContext, taskIds, pushUpdate, conversationContext);
    } else {
      await runSingleAgentFlow(conv, remainingAgents[0], userMessage, baseContext, taskIds, pushUpdate, conversationContext);
    }

    if (pushUpdate) pushUpdate('complete', { conversationId: conv.id });
  } catch (err) {
    logger.error(`spawnAgents crashed: ${err.message}`, { conversationId: conv.id, stack: err.stack });
    if (pushUpdate) {
      pushUpdate('error', { error: `Agent orchestration failed: ${err.message}` });
      pushUpdate('complete', { conversationId: conv.id, error: err.message });
    }
  }
}

export async function runChainAgents(conv, agents, userMessage, baseContext, taskIds, pushUpdate, conversationContext = null) {
  let previousResult = baseContext;

  for (const agentId of agents) {
    const prompt = buildAgentPrompt(agentId, userMessage, previousResult, conversationContext);

    if (pushUpdate) pushUpdate('agent-status', { agentId, status: 'running' });

    const result = await runSingleAgent(agentId, prompt, previousResult || null, conv.id, pushUpdate);
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
    if (pushUpdate) pushUpdate('agent-message', agentMsg);

    if (result.status !== 'done') {
      if (pushUpdate) pushUpdate('agent-error', { agentId, error: result.error || 'Agent failed' });
      break;
    }

    previousResult = result.result;
  }
}

export async function runParallelAgents(conv, agents, userMessage, baseContext, taskIds, pushUpdate, conversationContext = null) {
  const promises = agents.map(agentId => {
    const prompt = buildAgentPrompt(agentId, userMessage, baseContext, conversationContext);
    return runSingleAgent(agentId, prompt, baseContext || null, conv.id, pushUpdate)
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
      if (pushUpdate) pushUpdate('agent-message', agentMsg);
    }
  }

  persistConversation(conv);
}

export async function runSingleAgentFlow(conv, agentId, userMessage, baseContext, taskIds, pushUpdate, conversationContext = null) {
  const prompt = buildAgentPrompt(agentId, userMessage, baseContext, conversationContext);
  const result = await runSingleAgent(agentId, prompt, baseContext || null, conv.id, pushUpdate);
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
  if (pushUpdate) pushUpdate('agent-message', agentMsg);
}
