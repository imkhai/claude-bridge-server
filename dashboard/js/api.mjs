// API client module for dashboard endpoints

const BASE = '';

export async function fetchAgents() {
  const res = await fetch(`${BASE}/api/dashboard/agents`);
  if (!res.ok) throw new Error(`agents: ${res.status}`);
  return res.json();
}

export async function fetchChains() {
  const res = await fetch(`${BASE}/api/dashboard/chains`);
  if (!res.ok) throw new Error(`chains: ${res.status}`);
  return res.json();
}

export async function fetchTimeline() {
  const res = await fetch(`${BASE}/api/dashboard/timeline`);
  if (!res.ok) throw new Error(`timeline: ${res.status}`);
  return res.json();
}

export async function fetchWorklog() {
  const res = await fetch(`${BASE}/api/dashboard/worklog`);
  if (!res.ok) throw new Error(`worklog: ${res.status}`);
  return res.json();
}

export async function fetchLeaderboard() {
  const res = await fetch(`${BASE}/api/dashboard/leaderboard`);
  if (!res.ok) throw new Error(`leaderboard: ${res.status}`);
  return res.json();
}

export async function fetchHealth() {
  const res = await fetch(`${BASE}/health`);
  if (!res.ok) throw new Error(`health: ${res.status}`);
  return res.json();
}
