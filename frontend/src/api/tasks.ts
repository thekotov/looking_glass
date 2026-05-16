import { api } from "./client";

export type TaskStatus =
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

export type Task = {
  id: string;
  group_id: string;
  type: string;
  target: string;
  options: Record<string, unknown>;
  status: TaskStatus;
  priority: number;
  agent_id: string;
  created_by: string | null;
  error: string | null;
  created_at: string;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type TaskResult = {
  id: string;
  task_id: string;
  agent_id: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number | null;
  parsed_json: Record<string, unknown> | null;
  created_at: string;
};

export type TaskDetail = Task & { result: TaskResult | null; siblings: string[] };

export type TaskGroupTask = Task & { result: TaskResult | null };

export type TaskGroup = {
  group_id: string;
  type: string;
  target: string;
  options: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
  tasks: TaskGroupTask[];
};

export type CreateTaskRequest = {
  type: string;
  target: string;
  options: Record<string, unknown>;
  priority?: number;
} & (
  | { agent_id: string }
  | { agent_ids: string[] }
  | { tags: string[]; agents_per_tag?: number }
);

export type CreateTaskResponse = {
  group_id: string;
  tasks: Task[];
};

export function listTasks(params: { agent_id?: string; status?: TaskStatus; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.agent_id) qs.set("agent_id", params.agent_id);
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  const path = qs.toString() ? `/api/tasks?${qs.toString()}` : "/api/tasks";
  return api<Task[]>("GET", path);
}

export function getTask(id: string) {
  return api<TaskDetail>("GET", `/api/tasks/${id}`);
}

export function getTaskGroup(groupId: string) {
  return api<TaskGroup>("GET", `/api/tasks/groups/${groupId}`);
}

export function createTask(req: CreateTaskRequest) {
  return api<CreateTaskResponse>("POST", "/api/tasks", req);
}

export function cancelTask(id: string) {
  return api<Task>("POST", `/api/tasks/${id}/cancel`);
}

export function deleteTask(id: string) {
  return api<void>("DELETE", `/api/tasks/${id}`);
}

export function deleteTaskGroup(groupId: string) {
  return api<void>("DELETE", `/api/tasks/groups/${groupId}`);
}

export const TERMINAL_STATUSES: readonly TaskStatus[] = [
  "completed",
  "failed",
  "timeout",
  "cancelled",
];

export function isTerminal(s: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}
