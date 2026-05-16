import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as agentsApi from "../api/agents";
import { agentLabel } from "../api/agents";
import * as tasksApi from "../api/tasks";
import type { TaskGroupTask, TaskStatus } from "../api/tasks";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { previewCommand } from "../lib/commandPreview";
import { useConfirm } from "../components/ConfirmDialog";
import CreateTaskDialog, { type CreateTaskInitial } from "../components/CreateTaskDialog";
import type { TaskType } from "../components/CreateTaskDialog/TypeFields";
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
import { TaskStatusBadge } from "./Tasks";

export default function TaskGroup() {
  const { groupId } = useParams<{ groupId: string }>();
  const { t } = useT();
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const canDelete = user && (user.role === "operator" || user.role === "admin");
  const canCreate = canDelete;
  const [rerunOpen, setRerunOpen] = useState<CreateTaskInitial | null>(null);

  const groupQ = useQuery({
    queryKey: ["task-group", groupId],
    queryFn: () => tasksApi.getTaskGroup(groupId!),
    enabled: !!groupId,
    refetchInterval: (q) => {
      const g = q.state.data;
      if (!g) return 1500;
      const allTerminal = g.tasks.every((t) => tasksApi.isTerminal(t.status));
      return allTerminal ? false : 1500;
    },
  });

  const agentsQ = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.listAgents,
  });
  const agentsById = new Map((agentsQ.data ?? []).map((a) => [a.id, a]));

  const del = useMutation({
    mutationFn: () => tasksApi.deleteTaskGroup(groupId!),
    onSuccess: () => {
      toast.info(t("tasks.deleted"));
      navigate("/tasks");
    },
    onError: (err) =>
      toast.error(t("tasks.deleteFailed"), err instanceof Error ? err.message : String(err)),
  });

  async function onDeleteGroup() {
    const allTerminal = groupQ.data?.tasks.every((tk) => tasksApi.isTerminal(tk.status)) ?? false;
    if (!allTerminal) {
      toast.warning(t("tasks.deleteGroupRunningHint"));
      return;
    }
    const ok = await confirm({
      title: t("tasks.confirmDeleteGroup"),
      body: `${groupQ.data?.type} ${groupQ.data?.target} · ${groupQ.data?.tasks.length} tasks`,
      danger: true,
      confirmLabel: t("common.delete"),
    });
    if (ok) del.mutate();
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-6xl px-6 py-6">
        <Breadcrumbs
          items={[
            { to: "/tasks", label: t("nav.tasks") },
            ...(groupQ.data
              ? [{ label: `${groupQ.data.type} ${groupQ.data.target}`, mono: true }]
              : [{ label: t("group.prefix", { id: groupId?.slice(0, 8) ?? "" }) } as const]),
          ]}
        />

        {groupQ.isLoading && <p className="text-slate-500">{t("common.loading")}</p>}
        {groupQ.isError && (
          <p className="text-red-400">
            {groupQ.error instanceof Error ? groupQ.error.message : t("common.failedToLoad")}
          </p>
        )}
        {groupQ.data && (
          <>
            <header className="mb-6 rounded-lg border border-slate-800 bg-slate-900 px-6 py-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="font-mono text-lg text-slate-100">
                      {groupQ.data.type} {groupQ.data.target}
                    </h1>
                    <span className="text-xs text-slate-500">
                      {groupQ.data.tasks.length === 1
                        ? t("group.agentsOne", { n: groupQ.data.tasks.length })
                        : t("group.agentsMany", { n: groupQ.data.tasks.length })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {t("group.createdAt", { date: new Date(groupQ.data.created_at).toLocaleString() })}
                  </p>
                  <div className="mt-3">
                    <JsonViewer data={groupQ.data.options} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <ExportButtons
                    basePath={`/api/tasks/groups/${groupQ.data.group_id}/export`}
                    filenameStem={`group-${groupQ.data.group_id.slice(0, 8)}`}
                  />
                  {canCreate && (
                    <button
                      onClick={() =>
                        setRerunOpen({
                          type: groupQ.data!.type as TaskType,
                          target: groupQ.data!.target,
                          options: groupQ.data!.options,
                          routing: {
                            mode: "agents",
                            agentIds: groupQ.data!.tasks.map((tk) => tk.agent_id),
                          },
                        })
                      }
                      className="rounded border border-blue-800 bg-blue-950/40 px-3 py-1 text-xs text-blue-200 hover:bg-blue-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                    >
                      ↻ {t("task.rerun")}
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={onDeleteGroup}
                      disabled={del.isPending}
                      className="rounded border border-red-900 px-3 py-1 text-xs text-red-300 hover:bg-red-950 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                    >
                      {t("tasks.deleteGroup")}
                    </button>
                  )}
                </div>
              </div>

              {/* Multi-agent progress: only worth showing for ≥2 agents */}
              {groupQ.data.tasks.length > 1 && (
                <GroupProgress
                  tasks={groupQ.data.tasks}
                  agentsById={agentsById}
                />
              )}
            </header>

            <div className="space-y-4">
              {groupQ.data.tasks.map((t) => {
                const a = agentsById.get(t.agent_id);
                return (
                  <AgentRunPanel
                    key={t.id}
                    task={t}
                    hostname={a ? agentLabel(a) : undefined}
                    tags={a?.tags ?? []}
                  />
                );
              })}
            </div>
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

function AgentRunPanel({
  task,
  hostname,
  tags,
}: {
  task: TaskGroupTask;
  hostname?: string;
  tags: string[];
}) {
  const qc = useQueryClient();
  const { t } = useT();
  const [expanded, setExpanded] = useState(!tasksApi.isTerminal(task.status));

  const cancel = useMutation({
    mutationFn: () => tasksApi.cancelTask(task.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-group"] }),
  });

  return (
    <section
      id={`task-${task.id}`}
      className="scroll-mt-24 rounded-lg border border-slate-800 bg-slate-900 [&:target]:ring-1 [&:target]:ring-emerald-500/40"
    >
      <header
        className="flex cursor-pointer items-center justify-between px-6 py-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <TaskStatusBadge status={task.status as TaskStatus} />
          <span className="font-mono text-sm text-slate-100">
            {hostname ?? task.agent_id.slice(0, 8)}
          </span>
          {tags.length > 0 && (
            <span className="text-[10px] uppercase text-slate-500">{tags.join(",")}</span>
          )}
          <span className="text-xs text-slate-500">{durationStr(task)}</span>
        </div>
        <div className="flex items-center gap-2">
          {!tasksApi.isTerminal(task.status) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                cancel.mutate();
              }}
              className="rounded border border-amber-900 px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-950"
            >
              {t("group.cancelShort")}
            </button>
          )}
          <Link
            to={`/tasks/${task.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] uppercase text-slate-500 hover:text-slate-300"
          >
            {t("group.detailsLink")}
          </Link>
        </div>
      </header>

      {expanded && (
        <div className="border-t border-slate-800">
          <LiveMTRTable
            taskId={task.id}
            taskType={task.type}
            enabled={!tasksApi.isTerminal(task.status)}
          />
          <LiveTaskChart
            taskId={task.id}
            taskType={task.type}
            enabled={!tasksApi.isTerminal(task.status)}
          />
          <LiveOutput taskId={task.id} enabled={!tasksApi.isTerminal(task.status)} />

          {task.error && (
            <div className="px-6 py-3 text-sm text-red-300">
              <span className="text-[10px] uppercase text-red-400">{t("task.error")}</span>
              <pre className="mt-1 whitespace-pre-wrap font-mono">{task.error}</pre>
            </div>
          )}

          {task.result?.parsed_json && (
            <div className="border-t border-slate-800 px-4 pt-4 pb-1">
              <TaskResultView type={task.type} parsed={task.result.parsed_json} />
            </div>
          )}

          {task.result?.stdout && (
            <div className="border-t border-slate-800 px-6 py-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] uppercase tracking-wide text-slate-500">{t("task.stdout")}</h3>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard?.writeText(
                        previewCommand(task.type, task.target, task.options),
                      )
                    }
                    title={previewCommand(task.type, task.target, task.options)}
                    className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                  >
                    {t("task.copyCommand")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      navigator.clipboard?.writeText(task.result?.stdout ?? "")
                    }
                    className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 hover:bg-slate-800 hover:text-slate-300"
                  >
                    {t("task.copyOutput")}
                  </button>
                </div>
              </div>
              <pre className="mt-1 overflow-x-auto font-mono text-xs text-slate-300">
                {task.result.stdout}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function GroupProgress({
  tasks,
  agentsById,
}: {
  tasks: TaskGroupTask[];
  agentsById: Map<string, ReturnType<typeof agentsApi.listAgents> extends Promise<(infer T)[]> ? T : never>;
}) {
  const { t } = useT();
  const total = tasks.length;
  const counts = {
    completed: 0,
    failed: 0,
    timeout: 0,
    running: 0,
    claimed: 0,
    queued: 0,
    cancelled: 0,
  } as Record<TaskStatus, number>;
  for (const tk of tasks) counts[tk.status]++;
  const terminalCount =
    counts.completed + counts.failed + counts.timeout + counts.cancelled;
  const doneRatio = total > 0 ? terminalCount / total : 0;
  const okRatio = total > 0 ? counts.completed / total : 0;
  const failRatio = total > 0 ? (counts.failed + counts.timeout) / total : 0;
  const cancelledRatio = total > 0 ? counts.cancelled / total : 0;
  const allTerminal = terminalCount === total;

  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-slate-300">
          {allTerminal
            ? t("group.allDone", { done: terminalCount, total })
            : t("group.progress", { done: terminalCount, total })}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide">
          {counts.completed > 0 && (
            <Tag color="emerald" n={counts.completed} label={t("group.statusOk")} />
          )}
          {counts.failed > 0 && (
            <Tag color="red" n={counts.failed} label={t("group.statusFail")} />
          )}
          {counts.timeout > 0 && (
            <Tag color="amber" n={counts.timeout} label={t("group.statusTimeout")} />
          )}
          {(counts.running + counts.claimed) > 0 && (
            <Tag color="blue" n={counts.running + counts.claimed} label={t("group.statusRunning")} />
          )}
          {counts.queued > 0 && (
            <Tag color="slate" n={counts.queued} label={t("group.statusQueued")} />
          )}
          {counts.cancelled > 0 && (
            <Tag color="slate" n={counts.cancelled} label={t("group.statusCancelled")} />
          )}
        </span>
      </div>
      {/* Stacked bar: ok | fail+timeout | cancelled | remaining(running/queued) */}
      <div
        className="h-2 w-full overflow-hidden rounded bg-slate-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={terminalCount}
      >
        <div className="flex h-full w-full">
          <div className="bg-emerald-500" style={{ width: `${okRatio * 100}%` }} />
          <div className="bg-red-500" style={{ width: `${failRatio * 100}%` }} />
          <div className="bg-slate-500" style={{ width: `${cancelledRatio * 100}%` }} />
          <div
            className="bg-blue-500/40"
            style={{ width: `${Math.max(0, 1 - doneRatio - cancelledRatio) * 100}%` }}
          />
        </div>
      </div>
      {/* Per-agent dot row */}
      <ul className="mt-3 flex flex-wrap gap-1">
        {tasks.map((tk) => {
          const a = agentsById.get(tk.agent_id);
          const label = a ? agentLabel(a) : tk.agent_id.slice(0, 8);
          return (
            <li key={tk.id}>
              <a
                href={`#task-${tk.id}`}
                title={`${label} — ${tk.status}`}
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] hover:bg-slate-800 ${PER_AGENT_TONE[tk.status]}`}
              >
                <span aria-hidden>{STATUS_GLYPH[tk.status]}</span>
                <span className="truncate max-w-[14ch]">{label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Tag({
  color,
  n,
  label,
}: {
  color: "emerald" | "red" | "amber" | "blue" | "slate";
  n: number;
  label: string;
}) {
  const cls = {
    emerald: "border-emerald-900 bg-emerald-950 text-emerald-300",
    red: "border-red-900 bg-red-950 text-red-300",
    amber: "border-amber-900 bg-amber-950 text-amber-300",
    blue: "border-blue-900 bg-blue-950 text-blue-300",
    slate: "border-slate-700 bg-slate-900 text-slate-400",
  }[color];
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${cls}`}>
      <span>{n}</span>
      <span className="opacity-70">{label}</span>
    </span>
  );
}

const STATUS_GLYPH: Record<TaskStatus, string> = {
  queued: "·",
  claimed: "·",
  running: "⟳",
  completed: "✓",
  failed: "✕",
  timeout: "⏱",
  cancelled: "⊘",
};

const PER_AGENT_TONE: Record<TaskStatus, string> = {
  queued: "border-slate-700 text-slate-500",
  claimed: "border-blue-900 text-blue-400",
  running: "border-blue-700 text-blue-300",
  completed: "border-emerald-900 text-emerald-300",
  failed: "border-red-900 text-red-300",
  timeout: "border-amber-900 text-amber-300",
  cancelled: "border-slate-700 text-slate-500",
};

function durationStr(t: TaskGroupTask): string {
  if (!t.started_at) return "—";
  const end = t.finished_at ?? new Date().toISOString();
  const ms = new Date(end).getTime() - new Date(t.started_at).getTime();
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
