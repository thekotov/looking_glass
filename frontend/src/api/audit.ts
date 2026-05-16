import { api } from "./client";

export type AuditEvent = {
  id: string;
  user_id: string | null;
  username: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export function listAudit(params: { action?: string; username?: string; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (params.action) qs.set("action", params.action);
  if (params.username) qs.set("username", params.username);
  if (params.limit) qs.set("limit", String(params.limit));
  const path = qs.toString() ? `/api/audit?${qs.toString()}` : "/api/audit";
  return api<AuditEvent[]>("GET", path);
}
