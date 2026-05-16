import { api } from "./client";

export type Schedule = {
  id: string;
  name: string;
  enabled: boolean;
  type: string;
  target: string;
  options: Record<string, unknown>;
  agent_ids: string[];
  tags: string[];
  agents_per_tag: number;
  interval_seconds: number;
  next_run_at: string;
  last_run_at: string | null;
  last_run_group_id: string | null;
  last_run_error: string | null;
  runs_total: number;
  runs_failed: number;
  created_by: string | null;
  created_at: string;
};

export type ScheduleCreatePayload = {
  name: string;
  type: string;
  target: string;
  options: Record<string, unknown>;
  interval_seconds: number;
  enabled?: boolean;
  agent_ids?: string[];
  tags?: string[];
  agents_per_tag?: number;
};

export type ScheduleUpdatePayload = Partial<{
  name: string;
  enabled: boolean;
  interval_seconds: number;
  options: Record<string, unknown>;
  target: string;
  agent_ids: string[];
  tags: string[];
  agents_per_tag: number;
}>;

export function listSchedules() {
  return api<Schedule[]>("GET", "/api/schedules");
}

export function createSchedule(payload: ScheduleCreatePayload) {
  return api<Schedule>("POST", "/api/schedules", payload);
}

export function updateSchedule(id: string, patch: ScheduleUpdatePayload) {
  return api<Schedule>("PATCH", `/api/schedules/${id}`, patch);
}

export function deleteSchedule(id: string) {
  return api<void>("DELETE", `/api/schedules/${id}`);
}

export function triggerSchedule(id: string) {
  return api<{ triggered: true; group_id: string; task_count: number }>(
    "POST",
    `/api/schedules/${id}/trigger`,
  );
}
