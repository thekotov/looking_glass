import { api } from "./client";

export type AgentStats = {
  total: number;
  active: number;
  pending: number;
  inactive: number;
  online: number;
};

export type RecentFailure = {
  id: string;
  type: string;
  target: string;
  agent_id: string;
  error: string | null;
  finished_at: string | null;
  status: string;
};

export type TaskStats = {
  last_24h_total: number;
  last_24h_by_status: Record<string, number>;
  last_24h_by_type: Record<string, number>;
  recent_failures: RecentFailure[];
};

export type Stats = {
  agents: AgentStats;
  tasks: TaskStats;
};

export function getStats(hours = 24) {
  return api<Stats>("GET", `/api/stats?hours=${hours}`);
}

export type HourBucket = {
  hour: string;
  total: number;
  failed: number;
};

export function getTasksPerHour(hours = 24) {
  return api<HourBucket[]>("GET", `/api/stats/tasks-per-hour?hours=${hours}`);
}

export type AgentRecent = {
  agent_id: string;
  statuses: string[];
  durations_ms: (number | null)[];
};

export function getAgentsRecent(perAgent = 20) {
  return api<AgentRecent[]>("GET", `/api/stats/agents-recent?per_agent=${perAgent}`);
}
