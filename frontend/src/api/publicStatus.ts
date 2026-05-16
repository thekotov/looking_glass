import { api, apiPublic } from "./client";

export type PublicTarget = {
  id: string;
  target: string;
  label: string | null;
  sort_order: number;
  created_at: string;
};

export type PublicAgentRollup = {
  agent_id: string;
  agent_label: string;
  agent_tags: string[];
  samples: number;
  availability_percent: number;
  rtt_avg_ms: number | null;
  loss_percent: number | null;
  last_sample_at: string | null;
};

export type PublicTargetStatus = {
  target: string;
  label: string | null;
  sort_order: number;
  window_seconds: number;
  overall_availability_percent: number;
  per_agent: PublicAgentRollup[];
};

export type PublicStatus = {
  generated_at: string;
  window_seconds: number;
  targets: PublicTargetStatus[];
};

// ---------- no-auth ----------

export function getPublicStatus(windowSeconds = 24 * 3600) {
  return apiPublic<PublicStatus>(
    "GET",
    `/api/public/status?window_seconds=${windowSeconds}`,
  );
}

export type UptimeDay = {
  date: string; // YYYY-MM-DD
  samples: number;
  success_count: number;
  availability_percent: number;
};

export type PublicTargetUptime = {
  target: string;
  label: string | null;
  sort_order: number;
  days: UptimeDay[];
};

export type PublicStatusUptime = {
  generated_at: string;
  days: number;
  targets: PublicTargetUptime[];
};

export function getPublicStatusUptime(days = 90) {
  return apiPublic<PublicStatusUptime>(
    "GET",
    `/api/public/status/uptime?days=${days}`,
  );
}

// ---------- public looking glass form ----------

export type PublicLookupAgent = {
  id: string;
  label: string;
  tags: string[];
  city: string | null;
  country_code: string | null;
};

export type PublicLookupType = "ping" | "traceroute" | "tcp_connect";

export type PublicLookupTask = {
  task_id: string;
  status: string;
  type: string;
  target: string;
  created_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
  stdout: string | null;
  parsed_json: Record<string, unknown> | null;
  agent: PublicLookupAgent;
};

export function getPublicLookupAgents() {
  return apiPublic<{ agents: PublicLookupAgent[] }>(
    "GET",
    "/api/public/lookup/agents",
  );
}

export function createPublicLookup(payload: {
  type: PublicLookupType;
  target: string;
  agent_id: string;
  count?: number;
  port?: number;
}) {
  return apiPublic<PublicLookupTask>("POST", "/api/public/lookup", payload);
}

export function getPublicLookup(taskId: string) {
  return apiPublic<PublicLookupTask>("GET", `/api/public/lookup/${taskId}`);
}

// ---------- admin ----------

export function listPublicTargets() {
  return api<PublicTarget[]>("GET", "/api/public-targets");
}

export function addPublicTarget(payload: {
  target: string;
  label?: string | null;
  sort_order?: number;
}) {
  return api<PublicTarget>("POST", "/api/public-targets", payload);
}

export function updatePublicTarget(
  id: string,
  patch: { label?: string | null; sort_order?: number },
) {
  return api<PublicTarget>("PATCH", `/api/public-targets/${id}`, patch);
}

export function deletePublicTarget(id: string) {
  return api<void>("DELETE", `/api/public-targets/${id}`);
}
