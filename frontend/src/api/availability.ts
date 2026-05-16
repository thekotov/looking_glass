import { api } from "./client";

export type CheckType = "icmp" | "tcp";

export type CreateAvailabilityRequest = {
  targets: string[];
  check_types: CheckType[];
  tcp_port?: number;
  agent_ids?: string[];
  timeout_sec?: number;
  ping_count?: number;
};

export type SkippedPair = {
  agent_id: string;
  hostname: string;
  check_type: CheckType;
  reason: string;
};

export type CreateAvailabilityResponse = {
  group_id: string;
  task_count: number;
  skipped: SkippedPair[];
};

export function createAvailabilityCheck(req: CreateAvailabilityRequest) {
  return api<CreateAvailabilityResponse>("POST", "/api/availability-checks", req);
}

// ---------- presets (saved configurations) ----------

export type AvailabilityPreset = {
  id: string;
  name: string;
  targets: string[];
  check_icmp: boolean;
  check_tcp: boolean;
  tcp_port: number;
  timeout_sec: number;
  ping_count: number;
  agent_ids: string[];
  last_run_group_id: string | null;
  last_run_at: string | null;
  runs_total: number;
  created_by: string | null;
  created_at: string;
};

export type PresetCreatePayload = Omit<
  AvailabilityPreset,
  "id" | "last_run_group_id" | "last_run_at" | "runs_total" | "created_by" | "created_at"
>;

export type PresetUpdatePayload = Partial<PresetCreatePayload>;

export function listPresets() {
  return api<AvailabilityPreset[]>("GET", "/api/availability-presets");
}

export function createPreset(payload: PresetCreatePayload) {
  return api<AvailabilityPreset>("POST", "/api/availability-presets", payload);
}

export function updatePreset(id: string, patch: PresetUpdatePayload) {
  return api<AvailabilityPreset>("PATCH", `/api/availability-presets/${id}`, patch);
}

export function deletePreset(id: string) {
  return api<void>("DELETE", `/api/availability-presets/${id}`);
}

export function runPreset(id: string) {
  return api<CreateAvailabilityResponse>("POST", `/api/availability-presets/${id}/run`);
}
