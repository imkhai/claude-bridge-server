import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.mjs';

const DIRS = ['tasks', 'results', 'contexts', 'shared', 'uploads', 'conversations', 'summaries'];

export async function ensureDirectories() {
  for (const dir of DIRS) {
    await mkdir(join(config.WORKSPACE, dir), { recursive: true });
  }
}

export async function saveTask(taskId, prompt) {
  const filePath = join(config.WORKSPACE, 'tasks', `task-${taskId}.md`);
  await writeFile(filePath, prompt, 'utf-8');
  return filePath;
}

export async function saveContext(taskId, context) {
  const filePath = join(config.WORKSPACE, 'contexts', `context-${taskId}.md`);
  await writeFile(filePath, context, 'utf-8');
  return filePath;
}

export async function saveResult(taskId, agentId, prompt, result, duration) {
  const filePath = join(config.WORKSPACE, 'results', `result-${taskId}.md`);
  const promptPreview = prompt.slice(0, 200);
  const completedAt = new Date().toISOString();

  const content = `# Result: ${taskId}

**Agent:** ${agentId}
**Prompt:** ${promptPreview}
**Completed:** ${completedAt}
**Duration:** ${duration}ms

---

${result}
`;

  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

export function resultPath(taskId) {
  return join(config.WORKSPACE, 'results', `result-${taskId}.md`);
}
