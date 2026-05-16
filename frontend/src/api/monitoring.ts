import { api } from "./client";

export type HealthComponent = {
  status: "ok" | "error";
  latency_ms?: number;
  error?: string;
};

export type HealthV2 = {
  generated_at: string;
  components: {
    postgres?: HealthComponent;
    redis?: HealthComponent;
  };
  tasks: {
    queued: number;
    running: number;
    last_1h_total: number;
    last_1h_failed: number;
    error_rate_1h: number;
  };
  agents: {
    total: number;
    active: number;
    online: number;
    uptime_ratio: number;
  };
  scheduler?: {
    total_schedules: number;
    enabled_schedules: number;
    last_fire_at: string | null;
  };
};

export function getHealthV2() {
  return api<HealthV2>("GET", "/api/health/v2");
}
