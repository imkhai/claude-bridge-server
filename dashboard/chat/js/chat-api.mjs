/**
 * Chat API Client — handles all HTTP/SSE communication with the bridge server.
 */

const BASE = '';

export async function sendMessage(conversationId, message, files = []) {
  const res = await fetch(`${BASE}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId, message, files }),
  });
  if (!res.ok) throw new Error(`Send failed: ${res.status}`);
  return res.json();
}

export async function uploadFiles(formData) {
  const res = await fetch(`${BASE}/api/chat/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

export async function getConversations() {
  const res = await fetch(`${BASE}/api/chat/conversations`);
  if (!res.ok) throw new Error(`Fetch conversations failed: ${res.status}`);
  return res.json();
}

export async function getConversation(id) {
  const res = await fetch(`${BASE}/api/chat/conversations/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Fetch conversation failed: ${res.status}`);
  return res.json();
}

export async function deleteConversation(id) {
  const res = await fetch(`${BASE}/api/chat/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
  return res.json();
}

export async function getFiles() {
  const res = await fetch(`${BASE}/api/chat/files`);
  if (!res.ok) throw new Error(`Fetch files failed: ${res.status}`);
  return res.json();
}

/**
 * Connect to SSE stream for real-time updates.
 * Returns an EventSource that emits: message, agent-start, agent-done, agent-error, routing, done.
 */
export function connectSSE(conversationId, handlers = {}) {
  const url = `${BASE}/api/chat/stream/${encodeURIComponent(conversationId)}`;
  const es = new EventSource(url);

  es.addEventListener('message', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (handlers.onMessage) handlers.onMessage(data);
    } catch { /* ignore parse errors */ }
  });

  es.addEventListener('routing', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (handlers.onRouting) handlers.onRouting(data);
    } catch { /* ignore */ }
  });

  es.addEventListener('agent-status', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.status === 'running') {
        if (handlers.onAgentStart) handlers.onAgentStart(data);
      } else {
        if (handlers.onAgentProgress) handlers.onAgentProgress(data);
      }
    } catch { /* ignore */ }
  });

  es.addEventListener('agent-message', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.status === 'done') {
        if (handlers.onAgentDone) handlers.onAgentDone(data);
      } else {
        if (handlers.onAgentError) handlers.onAgentError(data);
      }
    } catch { /* ignore */ }
  });

  es.addEventListener('agent-error', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (handlers.onAgentError) handlers.onAgentError(data);
    } catch { /* ignore */ }
  });

  es.addEventListener('complete', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (handlers.onDone) handlers.onDone(data);
    } catch { /* ignore */ }
    es.close();
  });

  es.addEventListener('error', () => {
    if (handlers.onError) handlers.onError();
  });

  return es;
}
