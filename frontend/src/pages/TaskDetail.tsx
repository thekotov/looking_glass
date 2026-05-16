import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as agentsApi from "../api/agents";
import * as tasksApi from "../api/tasks";
import type { Task } from "../api/tasks";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { useConfirm } from "../components/ConfirmDialog";
import CreateTaskDialog, { type CreateTaskInitial } from "../components/CreateTaskDialog";
import ExportButtons from "../components/ExportButtons";
import { JsonViewer } from "../components/JsonViewer";
import LiveMTRTable from "../components/LiveMTRTable";
import LiveOutput from "../components/LiveOutput";
import LiveTaskChart from "../components/LiveTaskChart";
import NavBar from "../components/NavBar";
import TaskResultView from "../components/results/TaskResultView";
import { useToast } from "../components/Toast";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../i18n";
import { estimateDurationSec, previewCommand } from "../lib/commandPreview";
import type { TaskType } from "../components/CreateTaskDialog/TypeFields";
import { TaskStatusBadge } from "./Tasks";

export default function TaskDetail() {
  const { taskId } = useParams<{ taskId: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const canCreate = user && (user.role === "operator" || user.role === "admin");
  const [rerunOpen, setRerunOpen] = useState<CreateTaskInitial | null>(null);
  const agentsQ = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.listAgents,
    enabled: !!canCreate,
  });

  const query = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => tasksApi.getTask(taskId!),
    enabled: !!taskId,
    refetchInterval: (q) => {
      const t = q.state.data;
      if (!t) return 2000;
      return tasksApi.isTerminal(t.status) ? false : 1500;
    },
  });

  const cancel = useMutation({
    mutationFn: () => tasksApi.cancelTask(taskId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", taskId] });
      toast.info(t("task.cancel"));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const del = useMutation({
    mutationFn: () => tasksApi.deleteTask(taskId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.info(t("tasks.deleted"));
      navigate("/tasks");
    },
    onError: (err) => toast.error(t("tasks.deleteFailed"), err instanceof Error ? err.message : String(err)),
  });

  async function onDeleteClick(task: Task) {
    const ok = await confirm({
      title: t("tasks.confirmDelete"),
      body: `${task.type} ${task.target}`,
      danger: true,
      confirmLabel: t("common.delete"),
    });
    if (ok) del.mutate();
  }

  function copyOptions(task: Task) {
    navigator.clipboard
      ?.writeText(JSON.stringify(task.options, null, 2))
      .then(
        () => toast.success(t("task.copied")),
        () => undefined,
      );
  }

  function copyToClipboard(text: string, msg: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(msg),
      () => undefined,
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-6">
        <Breadcrumbs
          items={[
            { to: "/tasks", label: t("nav.tasks") },
            ...(query.data
              ? [
                  {
                    to: query.data.group_id ? `/groups/${query.data.group_id}` : undefined,
                    label: `${query.data.type} ${query.data.target}`,
                    mono: true,
                  },
                ]
              : []),
            { label: (taskId ?? "").slice(0, 8), mono: true },
          ]}
        />

        {query.isLoading && <p className="text-slate-500">{t("common.loading")}</p>}
        {query.isError && (
          <p className="text-red-400">
            {query.error instanceof Error ? query.error.message : t("common.failedToLoad")}
          </p>
        )}
        {query.data && (
          <>
            <header className="mb-6 flex items-start justify-between rounded-lg border border-slate-800 bg-slate-900 px-6 py-4">
              <div>
                <div className="flex items-center gap-3">
                  <LiveTaskBadge task={query.data} />
                  <h1 className="font-mono text-lg text-slate-100">
                    {query.data.type} {query.data.target}
                  </h1>
                  {query.data.siblings.length > 0 && (
                    <Link
                      to={`/groups/${query.data.group_id}`}
                      className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase text-slate-400 hover:bg-slate-800"
                    >
                      {t("task.groupOf", { n: query.data.siblings.length + 1 })}
                    </Link>
                  )}
                </div>
                <TaskMeta task={query.data} />
              </div>
              <div className="flex flex-col items-end gap-2">
                {!tasksApi.isTerminal(query.data.status) && (
                  <button
                    onClick={() => cancel.mutate()}
                    disabled={cancel.isPending}
                    className="rounded border border-amber-900 px-3 py-1 text-xs text-amber-300 hover:bg-amber-950"
                  >
                    {t("task.cancel")}
                  </button>
                )}
                {canCreate && tasksApi.isTerminal(query.data.status) && (
                  <button
                    onClick={() =>
                      setRerunOpen({
                        type: query.data!.type as TaskType,
                        target: query.data!.target,
                        options: query.data!.options,
                        routing: {
                          mode: "agents",
                          agentIds: [query.data!.agent_id],
                        },
                      })
                    }
                    className="rounded border border-blue-800 bg-blue-950/40 px-3 py-1 text-xs text-blue-200 hover:bg-blue-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                  >
                    ↻ {t("task.rerun")}
                  </button>
                )}
                {tasksApi.isTerminal(query.data.status) && (
                  <button
                    onClick={() => onDeleteClick(query.data!)}
                    disabled={del.isPending}
                    className="rounded border border-red-900 px-3 py-1 text-xs text-red-300 hover:bg-red-950 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                  >
                    {t("common.delete")}
                  </button>
                )}
                <ExportButtons
                  basePath={`/api/tasks/${query.data.id}/export`}
                  filenameStem={`task-${query.data.id.slice(0, 8)}`}
                />
              </div>
            </header>

            <LiveMTRTable
              taskId={query.data.id}
              taskType={query.data.type}
              enabled={!tasksApi.isTerminal(query.data.status)}
            />
            <LiveTaskChart
              taskId={query.data.id}
              taskType={query.data.type}
              enabled={!tasksApi.isTerminal(query.data.status)}
            />
            <LiveOutput taskId={query.data.id} enabled={!tasksApi.isTerminal(query.data.status)} />

            {query.data.error && (
              <section className="mb-6 rounded-lg border border-red-900 bg-red-950/40 px-6 py-4">
                <h2 className="text-xs uppercase tracking-wide text-red-300">{t("task.error")}</h2>
                <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-red-200">
                  {query.data.error}
                </p>
              </section>
            )}

            {query.data.result?.parsed_json && (
              <TaskResultView
                type={query.data.type}
                parsed={query.data.result.parsed_json}
              />
            )}

            {query.data.result?.stdout && (
              <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
                  <h2 className="text-xs uppercase tracking-wide text-slate-500">
                    {t("task.stdout")}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          previewCommand(query.data!.type, query.data!.target, query.data!.options),
                          t("task.copyCommandDone"),
                        )
                      }
                      title={previewCommand(query.data!.type, query.data!.target, query.data!.options)}
                      className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                    >
                      {t("task.copyCommand")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(query.data!.result!.stdout, t("task.copyOutputDone"))
                      }
                      className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                    >
                      {t("task.copyOutput")}
                    </button>
                  </div>
                </div>
                <pre className="overflow-x-auto px-6 py-4 font-mono text-xs text-slate-300">
                  {query.data.result.stdout}
                </pre>
              </section>
            )}

            {query.data.result?.stderr && (
              <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
                  <h2 className="text-xs uppercase tracking-wide text-red-400">
                    {t("task.stderr")}
                  </h2>
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(query.data!.result!.stderr, t("task.copyOutputDone"))
                    }
                    className="rounded border border-red-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-300 hover:bg-red-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                  >
                    {t("task.copyOutput")}
                  </button>
                </div>
                <pre className="overflow-x-auto px-6 py-4 font-mono text-xs text-red-300">
                  {query.data.result.stderr}
                </pre>
              </section>
            )}

            <section className="rounded-lg border border-slate-800 bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
                <h2 className="text-xs uppercase tracking-wide text-slate-500">
                  {t("task.options")}
                </h2>
                <button
                  type="button"
                  onClick={() => copyOptions(query.data!)}
                  className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                >
                  {t("task.copyOptions")}
                </button>
              </div>
              <div className="px-6 py-3">
                <JsonViewer data={query.data.options} />
              </div>
            </section>
          </>
        )}
      </main>

      <CreateTaskDialog
        open={!!rerunOpen}
        agents={agentsQ.data ?? []}
        initial={rerunOpen ?? undefined}
        onClose={() => setRerunOpen(null)}
      />
    </div>
  );
}

function TaskMeta({ task }: { task: Task }) {
  const { t } = useT();
  const finishedLabel = task.finished_at
    ? new Date(task.finished_at).toLocaleString()
    : task.started_at
    ? "—"
    : t("task.waitingAgent");
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 sm:grid-cols-4">
      <Meta label={t("field.agent")} value={task.agent_id.slice(0, 8)} />
      <Meta label={t("field.priority")} value={String(task.priority)} />
      <Meta label={t("field.created")} value={new Date(task.created_at).toLocaleString()} />
      <Meta label={t("field.finished")} value={finishedLabel} />
    </dl>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-600">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

/**
 * Wraps the status badge with a pulsing dot + ETA for running tasks.
 * For terminal tasks it just shows the badge.
 */
function LiveTaskBadge({ task }: { task: Task }) {
  const { t } = useT();
  const running = !tasksApi.isTerminal(task.status);
  const eta = running ? estimateDurationSec(task.type, task.options ?? {}) : null;
  return (
    <span className="inline-flex items-center gap-2">
      {running && (
        <span className="relative inline-flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
        </span>
      )}
      <TaskStatusBadge status={task.status} />
      {eta !== null && (
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {t("task.eta", { n: eta })}
        </span>
      )}
    </span>
  );
}
