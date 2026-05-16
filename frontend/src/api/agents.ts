import { api } from "./client";

export type AgentStatus = "pending" | "active" | "rejected" | "disabled";

export type Agent = {
  id: string;
  hostname: string;
  display_name: string | null;
  description: string | null;
  version: string;
  status: AgentStatus;
  public_ip: string | null;
  capabilities: string[];
  tags: string[];
  last_seen: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  country_code: string | null;
  created_at: string;
};

export type AgentUpdatePatch = {
  display_name?: string | null;
  description?: string | null;
  tags?: string[];
  status?: "active" | "disabled";
  latitude?: number | null;
  longitude?: number | null;
  city?: string | null;
  country_code?: string | null;
};

/** What to show as the agent's label. Falls back to hostname, then short id. */
export function agentLabel(agent: Pick<Agent, "display_name" | "hostname" | "id">): string {
  const dn = agent.display_name?.trim();
  if (dn) return dn;
  if (agent.hostname) return agent.hostname;
  return agent.id.slice(0, 8);
}

export function listAgents() {
  return api<Agent[]>("GET", "/api/agents");
}

export function approveAgent(id: string, tags: string[]) {
  return api<Agent>("POST", `/api/agents/${id}/approve`, { tags });
}

export function rejectAgent(id: string) {
  return api<Agent>("POST", `/api/agents/${id}/reject`);
}

export function updateAgent(id: string, patch: AgentUpdatePatch) {
  return api<Agent>("PATCH", `/api/agents/${id}`, patch);
}

export function deleteAgent(id: string) {
  return api<void>("DELETE", `/api/agents/${id}`);
}

export function geoDetectAgent(id: string) {
  return api<Agent>("POST", `/api/agents/${id}/geo-detect`);
}
