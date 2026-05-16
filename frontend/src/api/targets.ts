import { api } from "./client";

export type TargetListItem = {
  target: string;
  task_count: number;
  last_seen: string;
  types: string[];
  distinct_agents: number;
};

export type MatrixTaskType = "ping" | "tcp_connect";

export type TargetAgentStats = {
  agent_id: string;
  agent_label: string;
  agent_tags: string[];
  samples: number;
  success_count: number;
  failure_count: number;
  availability_percent: number;
  rtt_avg_ms: number | null;
  rtt_min_ms: number | null;
  rtt_max_ms: number | null;
  loss_percent: number | null;
  last_sample_at: string | null;
};

export type TargetSummary = {
  target: string;
  type: string;
  since: string;
  until: string;
  total_samples: number;
  overall_availability_percent: number;
  per_agent: TargetAgentStats[];
};

export type TargetSeriesPoint = {
  bucket_start: string;
  agent_id: string;
  samples: number;
  rtt_avg_ms: number | null;
  rtt_min_ms: number | null;
  rtt_max_ms: number | null;
  loss_percent: number | null;
  success_count: number;
  failure_count: number;
};

export type TargetSeriesAgent = {
  agent_id: string;
  agent_label: string;
  agent_tags: string[];
};

export type TargetSeries = {
  target: string;
  type: string;
  since: string;
  until: string;
  bucket_seconds: number;
  agents: TargetSeriesAgent[];
  points: TargetSeriesPoint[];
};

export function listTargets(since = "7d", limit = 100) {
  const q = new URLSearchParams({ since, limit: String(limit) }).toString();
  return api<TargetListItem[]>("GET", `/api/targets?${q}`);
}

export function getTargetSummary(
  target: string,
  opts: { since?: string; type?: MatrixTaskType } = {},
) {
  const q = new URLSearchParams({
    target,
    since: opts.since ?? "24h",
    type: opts.type ?? "ping",
  }).toString();
  return api<TargetSummary>("GET", `/api/targets/summary?${q}`);
}

export function getTargetSeries(
  target: string,
  opts: { since?: string; type?: MatrixTaskType; bucket?: string } = {},
) {
  const q = new URLSearchParams({
    target,
    since: opts.since ?? "24h",
    type: opts.type ?? "ping",
    bucket: opts.bucket ?? "auto",
  }).toString();
  return api<TargetSeries>("GET", `/api/targets/series?${q}`);
}
