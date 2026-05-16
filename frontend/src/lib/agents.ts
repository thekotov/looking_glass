// Threshold under which an agent's `last_seen` still counts as "online"
// in client-side views. The server uses its own 60s threshold for the
// /api/stats aggregation — keep these in sync when changing either side.
export const ONLINE_THRESHOLD_MS = 60_000;

export function isAgentOnline(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_THRESHOLD_MS;
}
