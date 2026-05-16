import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import * as auditApi from "../api/audit";
import NavBar from "../components/NavBar";
import { useT } from "../i18n";

const ACTIONS = [
  "",
  "login",
  "login_failed",
  "user_create",
  "user_update",
  "user_delete",
  "password_change",
  "agent_approve",
  "agent_reject",
  "agent_delete",
  "task_create",
  "task_cancel",
  "availability_check_create",
];

export default function Audit() {
  const { t } = useT();
  const [action, setAction] = useState("");
  const [username, setUsername] = useState("");

  const q = useQuery({
    queryKey: ["audit", action, username],
    queryFn: () =>
      auditApi.listAudit({
        action: action || undefined,
        username: username || undefined,
        limit: 200,
      }),
    refetchInterval: 5000,
  });

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-6xl px-6 py-6">
        <h1 className="mb-4 text-2xl font-semibold text-slate-100">{t("audit.title")}</h1>

        <div className="mb-4 flex flex-wrap gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">{t("audit.action")}</span>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="mt-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a || t("audit.any")}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">{t("audit.username")}</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("audit.filter")}
              className="mt-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </label>
        </div>

        <section className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
          {q.isLoading && <p className="px-6 py-4 text-sm text-slate-500">{t("common.loading")}</p>}
          {q.isError && (
            <p className="px-6 py-4 text-sm text-red-400">
              {q.error instanceof Error ? q.error.message : t("common.failedToLoad")}
            </p>
          )}
          {q.data && q.data.length === 0 && (
            <p className="px-6 py-4 text-sm text-slate-500">{t("audit.empty")}</p>
          )}
          {q.data && q.data.length > 0 && (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">{t("audit.thWhen")}</th>
                  <th className="px-6 py-3 font-medium">{t("audit.thUser")}</th>
                  <th className="px-6 py-3 font-medium">{t("audit.thAction")}</th>
                  <th className="px-6 py-3 font-medium">{t("audit.thTarget")}</th>
                  <th className="px-6 py-3 font-medium">{t("audit.thIp")}</th>
                  <th className="px-6 py-3 font-medium">{t("audit.thDetails")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {q.data.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap px-6 py-2 text-slate-400">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-2 font-mono text-slate-300">
                      {e.username ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-6 py-2">
                      <ActionBadge action={e.action} />
                    </td>
                    <td className="px-6 py-2 font-mono text-xs text-slate-400">
                      {e.resource_type && e.resource_id
                        ? `${e.resource_type}/${e.resource_id.slice(0, 8)}`
                        : "—"}
                    </td>
                    <td className="px-6 py-2 font-mono text-xs text-slate-500">
                      {e.ip ?? "—"}
                    </td>
                    <td className="px-6 py-2 font-mono text-xs text-slate-400">
                      {e.details ? (
                        <pre className="max-w-md whitespace-pre-wrap break-all">
                          {JSON.stringify(e.details)}
                        </pre>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const color = action.includes("delete") || action.includes("failed") || action === "agent_reject"
    ? "bg-red-950 text-red-300 border-red-900"
    : action.startsWith("agent_") || action === "task_create" || action === "task_cancel" || action === "availability_check_create"
    ? "bg-blue-950 text-blue-300 border-blue-900"
    : "bg-slate-800 text-slate-300 border-slate-700";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${color}`}>
      {action}
    </span>
  );
}
