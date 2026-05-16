import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as agentsApi from "../api/agents";
import { agentLabel } from "../api/agents";
import * as tasksApi from "../api/tasks";
import type { Task, TaskStatus } from "../api/tasks";
import { BulkActionBar } from "../components/BulkActionBar";
import CreateTaskDialog from "../components/CreateTaskDialog";
import { FilterChips, type ChipOption } from "../components/FilterChips";
import NavBar from "../components/NavBar";
import { SavedViews } from "../components/SavedViews";
import { SearchInput } from "../components/SearchInput";
import { SkeletonRows } from "../components/Skeleton";
import { SortableHeader, type SortState } from "../components/SortableHeader";
import { useToast } from "../components/Toast";
import { useAuth } from "../hooks/useAuth";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useUndoable } from "../hooks/useUndoable";
import { useUrlState, useUrlStateMulti } from "../hooks/useUrlState";
import { useT } from "../i18n";

type Agent = ReturnType<typeof agentsApi.listAgents> extends Promise<(infer T)[]> ? T : never;

type Group = {
  groupId: string;
  tasks: Task[];
};

type TaskSortKey = "created" | "duration" | "status";

const ALL_STATUSES: TaskStatus[] = [
  "queued",
  "claimed",
  "running",
  "completed",
  "failed",
  "timeout",
  "cancelled",
];

export default function Tasks() {
  const { user } = useAuth();
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const undoable = useUndoable();
  const canCreate = user && (user.role === "operator" || user.role === "admin");
  const canDelete = canCreate;
  const [createOpen, setCreateOpen] = useState(false);
  // Expanded task-group ids live in the URL (?open=g1,g2). Survives refresh,
  // shareable, back-button works — same pattern as filters/sort.
  const [openParam, setOpenParam] = useUrlState("open", "");
  const expanded = useMemo(
    () => new Set(openParam.split(",").filter(Boolean)),
    [openParam],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useDocumentTitle(t("tasks.title"));

  // Global "n" shortcut: open new-task dialog when fired from elsewhere.
  useEffect(() => {
    if (!canCreate) return;
    function onNew() {
      setCreateOpen(true);
    }
    window.addEventListener("lg:new-task", onNew);
    return () => window.removeEventListener("lg:new-task", onNew);
  }, [canCreate]);

  // URL-backed filter state.
  const [search, setSearch] = useUrlState("q", "");
  const [statusFilters, setStatusFilters] = useUrlStateMulti("status");
  const [typeFilters, setTypeFilters] = useUrlStateMulti("type");
  const [sortKey, setSortKey] = useUrlState("sort", "created");
  const [sortDir, setSortDir] = useUrlState("dir", "desc");
  const sort: SortState<TaskSortKey> = {
    key: (sortKey as TaskSortKey) || "created",
    dir: sortDir === "asc" ? "asc" : "desc",
  };
  function setSort(s: SortState<TaskSortKey>) {
    setSortKey(s.key);
    setSortDir(s.dir);
  }

  const tasks = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.listTasks({ limit: 100 }),
    refetchInterval: 2000,
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.listAgents,
  });
  const agentsById = useMemo(
    () => new Map((agents.data ?? []).map((a) => [a.id, a])),
    [agents.data],
  );

  // Counts for chip badges — based on the *unfiltered* set so users can see
  // "5 failed" even when a type filter is active.
  const statusCounts = useMemo(() => {
    const c = new Map<TaskStatus, number>();
    for (const x of tasks.data ?? []) c.set(x.status, (c.get(x.status) ?? 0) + 1);
    return c;
  }, [tasks.data]);

  const typeCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const x of tasks.data ?? []) c.set(x.type, (c.get(x.type) ?? 0) + 1);
    return c;
  }, [tasks.data]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tasks.data ?? []).filter((task) => {
      if (statusFilters.length > 0 && !statusFilters.includes(task.status)) return false;
      if (typeFilters.length > 0 && !typeFilters.includes(task.type)) return false;
      if (!q) return true;
      const a = agentsById.get(task.agent_id);
      const hay = [
        task.target,
        task.type,
        task.status,
        task.id,
        a ? agentLabel(a) : task.agent_id,
        task.error ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [tasks.data, search, statusFilters, typeFilters, agentsById]);

  // Group tasks by group_id. Single-task groups render as a flat row;
  // multi-task groups get a parent row with an expandable list of children.
  const groups: Group[] = useMemo(() => {
    const byId = new Map<string, Task[]>();
    for (const task of filteredTasks) {
      let bucket = byId.get(task.group_id);
      if (!bucket) {
        bucket = [];
        byId.set(task.group_id, bucket);
      }
      bucket.push(task);
    }
    const arr = Array.from(byId, ([groupId, ts]) => ({ groupId, tasks: ts }));
    const STATUS_RANK: Record<TaskStatus, number> = {
      running: 0,
      claimed: 1,
      queued: 2,
      failed: 3,
      timeout: 4,
      completed: 5,
      cancelled: 6,
    };
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sort.key) {
        case "created":
          cmp = maxCreatedAt(a.tasks) - maxCreatedAt(b.tasks);
          break;
        case "duration":
          cmp = maxDurationMs(a.tasks) - maxDurationMs(b.tasks);
          break;
        case "status":
          cmp = STATUS_RANK[worstStatus(a.tasks)] - STATUS_RANK[worstStatus(b.tasks)];
          break;
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filteredTasks, sort]);

  // Soft-delete a single task with 6s undo grace period.
  function deleteTask(id: string) {
    const prev = qc.getQueryData<Task[]>(["tasks"]);
    undoable({
      preview: () => {
        qc.setQueryData<Task[]>(["tasks"], (curr) =>
          (curr ?? []).filter((x) => x.id !== id),
        );
      },
      revert: () => {
        if (prev) qc.setQueryData(["tasks"], prev);
      },
      commit: async () => {
        await tasksApi.deleteTask(id);
        qc.invalidateQueries({ queryKey: ["tasks"] });
      },
      title: t("tasks.deleted"),
      errorTitle: t("tasks.deleteFailed"),
    });
  }

  function deleteGroup(id: string) {
    const prev = qc.getQueryData<Task[]>(["tasks"]);
    undoable({
      preview: () => {
        qc.setQueryData<Task[]>(["tasks"], (curr) =>
          (curr ?? []).filter((x) => x.group_id !== id),
        );
      },
      revert: () => {
        if (prev) qc.setQueryData(["tasks"], prev);
      },
      commit: async () => {
        await tasksApi.deleteTaskGroup(id);
        qc.invalidateQueries({ queryKey: ["tasks"] });
      },
      title: t("tasks.deleted"),
      errorTitle: t("tasks.deleteFailed"),
    });
  }

  function deleteSelectedTasks() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const prev = qc.getQueryData<Task[]>(["tasks"]);
    setSelected(new Set());
    undoable({
      preview: () => {
        qc.setQueryData<Task[]>(["tasks"], (curr) =>
          (curr ?? []).filter((x) => !selected.has(x.id)),
        );
      },
      revert: () => {
        if (prev) qc.setQueryData(["tasks"], prev);
      },
      commit: async () => {
        const results = await Promise.allSettled(
          ids.map((id) => tasksApi.deleteTask(id)),
        );
        qc.invalidateQueries({ queryKey: ["tasks"] });
        const failed = results.filter((r) => r.status === "rejected");
        if (failed.length > 0) {
          throw new Error(
            t("tasks.bulkDeletePartial", { failed: failed.length, total: ids.length }),
          );
        }
      },
      title: t("tasks.bulkDeleted", { n: ids.length }),
      errorTitle: t("tasks.deleteFailed"),
    });
  }

  // No confirm modal on delete — Undo toast covers the recovery path.
  function onDeleteTask(task: Task) {
    deleteTask(task.id);
  }

  function onDeleteGroup(g: Group) {
    const allTerminal = g.tasks.every((tk) => tasksApi.isTerminal(tk.status));
    if (!allTerminal) {
      toast.warning(t("tasks.deleteGroupRunningHint"));
      return;
    }
    deleteGroup(g.groupId);
  }

  function toggle(groupId: string) {
    const next = new Set(expanded);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    setOpenParam(next.size === 0 ? "" : Array.from(next).join(","));
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectGroup(g: Group) {
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = g.tasks.map((x) => x.id);
      const allIn = ids.every((id) => next.has(id));
      if (allIn) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  }
  function selectAllVisible() {
    const ids = new Set<string>();
    for (const g of groups) for (const tk of g.tasks) ids.add(tk.id);
    setSelected(ids);
  }
  // Drop selections that no longer exist after a refetch.
  const visibleIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) for (const x of g.tasks) s.add(x.id);
    return s;
  }, [groups]);
  if (selected.size > 0) {
    let drift = false;
    for (const id of selected) if (!visibleIds.has(id)) { drift = true; break; }
    if (drift) {
      const next = new Set<string>();
      for (const id of selected) if (visibleIds.has(id)) next.add(id);
      // Defer to avoid setState-during-render warning
      queueMicrotask(() => setSelected(next));
    }
  }

  const statusOptions: ChipOption<TaskStatus>[] = ALL_STATUSES.map((s) => ({
    value: s,
    label: s,
    count: statusCounts.get(s) ?? 0,
    tone: STATUS_CHIP_TONE[s],
  })).filter((o) => (o.count ?? 0) > 0);

  const typeOptions: ChipOption<string>[] = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ value: type, label: type, count }));

  const hasActiveFilters = !!search || statusFilters.length > 0 || typeFilters.length > 0;
  function clearFilters() {
    setSearch("");
    setStatusFilters([]);
    setTypeFilters([]);
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-100">{t("tasks.title")}</h1>
          {canCreate ? (
            <button
              onClick={() => setCreateOpen(true)}
              className="rounded bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              {t("tasks.newTask")}
            </button>
          ) : (
            <span className="text-xs text-slate-500">
              {t("tasks.readonlyCannotCreate")}
            </span>
          )}
        </div>

        {canDelete && selected.size > 0 && (
          <BulkActionBar
            count={selected.size}
            total={visibleIds.size}
            onSelectAll={selectAllVisible}
            onClear={() => setSelected(new Set())}
            selectAllLabel={t("common.selectAll")}
            clearLabel={t("common.clearSelection")}
          >
            <button
              type="button"
              onClick={deleteSelectedTasks}
              className="rounded border border-red-500 bg-red-600/20 px-2 py-0.5 text-xs font-medium text-red-100 hover:bg-red-600/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              {t("tasks.bulkDelete", { n: selected.size })}
            </button>
          </BulkActionBar>
        )}

        {tasks.data && tasks.data.length > 0 && (
          <div className="mb-2">
            <SavedViews
              scope="tasks"
              presets={[
                { name: t("tasks.preset.failed"), query: "status=failed,timeout" },
                { name: t("tasks.preset.running"), query: "status=running,claimed,queued" },
              ]}
            />
          </div>
        )}

        {/* Toolbar */}
        {tasks.data && tasks.data.length > 0 && (
          <div className="mb-3 space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder={t("tasks.searchPlaceholder")}
                ariaLabel={t("tasks.searchAria")}
                className="sm:max-w-sm"
              />
              {statusOptions.length > 1 && (
                <FilterChips
                  options={statusOptions}
                  value={statusFilters as TaskStatus[]}
                  onChange={(v) => setStatusFilters(v)}
                  ariaLabel={t("tasks.filterStatus")}
                />
              )}
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-[10px] uppercase tracking-wide text-slate-500 hover:text-slate-300"
                >
                  {t("common.clearFilters")}
                </button>
              )}
            </div>
            {typeOptions.length > 1 && (
              <FilterChips
                options={typeOptions}
                value={typeFilters}
                onChange={(v) => setTypeFilters(v)}
                ariaLabel={t("tasks.filterType")}
              />
            )}
          </div>
        )}

        <section className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
          {tasks.isLoading && <SkeletonRows rows={6} cols={6} />}
          {tasks.isError && (
            <p role="alert" className="px-6 py-4 text-sm text-red-400">
              {tasks.error instanceof Error ? tasks.error.message : t("common.failedToLoad")}
            </p>
          )}
          {tasks.data && tasks.data.length === 0 && (
            <p className="px-6 py-4 text-sm text-slate-500">{t("tasks.empty")}</p>
          )}
          {tasks.data && tasks.data.length > 0 && groups.length === 0 && (
            <p className="px-6 py-6 text-center text-sm text-slate-500">
              {t("tasks.noMatches")}{" "}
              <button
                type="button"
                onClick={clearFilters}
                className="text-slate-300 underline-offset-2 hover:underline"
              >
                {t("common.clearFilters")}
              </button>
            </p>
          )}
          {groups.length > 0 && (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {canDelete && <th className="w-8 px-2 py-3" aria-label="select" />}
                  <th className="w-8 px-2 py-3" aria-label="expand" />
                  <SortableHeader<TaskSortKey>
                    label={t("th.status")}
                    sortKey="status"
                    current={sort}
                    onSort={setSort}
                    className="px-6 py-3 font-medium"
                    defaultDir="asc"
                  />
                  <th className="px-6 py-3 font-medium">{t("th.type")}</th>
                  <th className="px-6 py-3 font-medium">{t("th.target")}</th>
                  <th className="px-6 py-3 font-medium">{t("th.agent")}</th>
                  <SortableHeader<TaskSortKey>
                    label={t("th.created")}
                    sortKey="created"
                    current={sort}
                    onSort={setSort}
                    className="px-6 py-3 font-medium"
                  />
                  <SortableHeader<TaskSortKey>
                    label={t("th.duration")}
                    sortKey="duration"
                    current={sort}
                    onSort={setSort}
                    className="px-6 py-3 font-medium"
                  />
                  {canDelete && <th className="px-6 py-3 font-medium" aria-label={t("th.actions")} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {groups.map((g) =>
                  g.tasks.length === 1 ? (
                    <SingleRow
                      key={g.groupId}
                      task={g.tasks[0]}
                      agentsById={agentsById}
                      canDelete={!!canDelete}
                      onDelete={onDeleteTask}
                      selected={selected.has(g.tasks[0].id)}
                      onToggleSelect={canDelete ? () => toggleSelected(g.tasks[0].id) : undefined}
                    />
                  ) : (
                    <GroupRows
                      key={g.groupId}
                      group={g}
                      agentsById={agentsById}
                      expanded={expanded.has(g.groupId)}
                      onToggle={() => toggle(g.groupId)}
                      canDelete={!!canDelete}
                      onDeleteTask={onDeleteTask}
                      onDeleteGroup={onDeleteGroup}
                      selected={selected}
                      onToggleSelect={canDelete ? toggleSelected : undefined}
                      onToggleSelectGroup={canDelete ? () => toggleSelectGroup(g) : undefined}
                    />
                  ),
                )}
              </tbody>
            </table>
          )}
        </section>
      </main>

      <CreateTaskDialog
        open={createOpen}
        agents={agents.data ?? []}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function SingleRow({
  task,
  agentsById,
  canDelete,
  onDelete,
  selected,
  onToggleSelect,
}: {
  task: Task;
  agentsById: Map<string, Agent>;
  canDelete: boolean;
  onDelete: (t: Task) => void;
  selected: boolean;
  onToggleSelect?: () => void;
}) {
  const { t } = useT();
  const a = agentsById.get(task.agent_id);
  return (
    <tr className={`hover:bg-slate-900/50 ${selected ? "bg-emerald-950/20" : ""}`}>
      {canDelete && (
        <td className="w-8 px-2 py-3 text-center">
          <input
            type="checkbox"
            aria-label="select task"
            checked={selected}
            onChange={onToggleSelect}
            className="h-3.5 w-3.5 cursor-pointer rounded border-slate-700 bg-slate-950 accent-emerald-500"
          />
        </td>
      )}
      <td className="w-8" />
      <td className="px-6 py-3">
        <TaskStatusBadge status={task.status} />
      </td>
      <td className="px-6 py-3 font-mono text-slate-300">{task.type}</td>
      <td className="px-6 py-3 font-mono text-slate-300">
        <Link
          to={`/tasks/${task.id}`}
          className="text-slate-100 underline-offset-2 hover:underline"
        >
          {task.target}
        </Link>
      </td>
      <td className="px-6 py-3 text-slate-400">
        {a ? agentLabel(a) : task.agent_id.slice(0, 8)}
      </td>
      <td className="px-6 py-3 text-slate-400">{new Date(task.created_at).toLocaleString()}</td>
      <td className="px-6 py-3 text-slate-400">{durationStr(task)}</td>
      {canDelete && (
        <td className="px-6 py-3 text-right">
          <button
            onClick={() => onDelete(task)}
            disabled={!tasksApi.isTerminal(task.status)}
            title={!tasksApi.isTerminal(task.status) ? t("tasks.deleteRunningHint") : undefined}
            className="rounded border border-red-900 px-2 py-0.5 text-[10px] uppercase text-red-300 hover:bg-red-950 disabled:opacity-30 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            ✕
          </button>
        </td>
      )}
    </tr>
  );
}

function GroupRows({
  group,
  agentsById,
  expanded,
  onToggle,
  canDelete,
  onDeleteTask,
  onDeleteGroup,
  selected,
  onToggleSelect,
  onToggleSelectGroup,
}: {
  group: Group;
  agentsById: Map<string, Agent>;
  expanded: boolean;
  onToggle: () => void;
  canDelete: boolean;
  onDeleteTask: (t: Task) => void;
  onDeleteGroup: (g: Group) => void;
  selected: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectGroup?: () => void;
}) {
  const { t } = useT();
  const head = group.tasks[0];
  const counts = useMemo(() => countByStatus(group.tasks), [group.tasks]);
  const oldest = useMemo(
    () => group.tasks.reduce((min, x) =>
      new Date(x.created_at).getTime() < new Date(min.created_at).getTime() ? x : min,
    group.tasks[0]),
    [group.tasks],
  );

  const allTaskIds = group.tasks.map((x) => x.id);
  const selectedInGroup = allTaskIds.filter((id) => selected.has(id)).length;
  const allSelected = selectedInGroup === allTaskIds.length;
  const someSelected = selectedInGroup > 0 && !allSelected;
  const groupRowClass = selectedInGroup > 0 ? "bg-emerald-950/20" : "bg-slate-900/40";

  return (
    <>
      <tr className={`cursor-pointer hover:bg-slate-900/60 ${groupRowClass}`} onClick={onToggle}>
        {canDelete && (
          <td className="w-8 px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              aria-label="select group"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={onToggleSelectGroup}
              className="h-3.5 w-3.5 cursor-pointer rounded border-slate-700 bg-slate-950 accent-emerald-500"
            />
          </td>
        )}
        <td className="w-8 px-2 py-3 text-center">
          <span
            aria-label={expanded ? "collapse" : "expand"}
            className={`inline-block text-slate-500 transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          >
            ▶
          </span>
        </td>
        <td className="px-6 py-3">
          <StatusCounts counts={counts} />
        </td>
        <td className="px-6 py-3 font-mono text-slate-300">{head.type}</td>
        <td className="px-6 py-3 font-mono text-slate-300">
          <Link
            to={`/groups/${group.groupId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-slate-100 underline-offset-2 hover:underline"
          >
            {head.target}
          </Link>
        </td>
        <td className="px-6 py-3 text-slate-400">
          <span className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            {t("tasks.groupAgents", { n: group.tasks.length })}
          </span>
        </td>
        <td className="px-6 py-3 text-slate-400">
          {new Date(oldest.created_at).toLocaleString()}
        </td>
        <td className="px-6 py-3 text-slate-400">{groupDurationStr(group.tasks)}</td>
        {canDelete && (
          <td className="px-6 py-3 text-right" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onDeleteGroup(group)}
              title={t("tasks.deleteGroup")}
              className="rounded border border-red-900 px-2 py-0.5 text-[10px] uppercase text-red-300 hover:bg-red-950 disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              ✕
            </button>
          </td>
        )}
      </tr>
      {expanded &&
        group.tasks.map((task) => {
          const a = agentsById.get(task.agent_id);
          const sel = selected.has(task.id);
          return (
            <tr key={task.id} className={`hover:bg-slate-900/50 ${sel ? "bg-emerald-950/20" : "bg-slate-950/40"}`}>
              {canDelete && (
                <td className="w-8 px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    aria-label="select task"
                    checked={sel}
                    onChange={() => onToggleSelect?.(task.id)}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-slate-700 bg-slate-950 accent-emerald-500"
                  />
                </td>
              )}
              <td className="w-8 px-2 py-2 text-center text-slate-700">└</td>
              <td className="px-6 py-2">
                <TaskStatusBadge status={task.status} />
              </td>
              <td className="px-6 py-2 font-mono text-slate-500">{task.type}</td>
              <td className="px-6 py-2 font-mono text-slate-500">
                <Link
                  to={`/tasks/${task.id}`}
                  className="text-slate-300 underline-offset-2 hover:underline"
                >
                  {task.target}
                </Link>
              </td>
              <td className="px-6 py-2 text-slate-300">
                {a ? agentLabel(a) : task.agent_id.slice(0, 8)}
              </td>
              <td className="px-6 py-2 text-slate-500">—</td>
              <td className="px-6 py-2 text-slate-400">{durationStr(task)}</td>
              {canDelete && (
                <td className="px-6 py-2 text-right">
                  <button
                    onClick={() => onDeleteTask(task)}
                    disabled={!tasksApi.isTerminal(task.status)}
                    title={
                      !tasksApi.isTerminal(task.status)
                        ? t("tasks.deleteRunningHint")
                        : undefined
                    }
                    className="rounded border border-red-900 px-2 py-0.5 text-[10px] uppercase text-red-300 hover:bg-red-950 disabled:opacity-30 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                  >
                    ✕
                  </button>
                </td>
              )}
            </tr>
          );
        })}
    </>
  );
}

function StatusCounts({ counts }: { counts: Map<TaskStatus, number> }) {
  // Compact "OK 2 · FAIL 1 · RUN 0" display. We show at most 3 dominant
  // statuses; for groups where everything's the same status, the parent
  // ends up looking like a regular badge.
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (entries.length === 1) {
    const [status, n] = entries[0];
    return (
      <span className="inline-flex items-center gap-1">
        <TaskStatusBadge status={status} />
        <span className="text-[10px] text-slate-500">×{n}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {entries.map(([status, n]) => (
        <span key={status} className="inline-flex items-center gap-0.5">
          <TaskStatusBadge status={status} />
          <span className="text-[10px] text-slate-500">{n}</span>
        </span>
      ))}
    </span>
  );
}

function countByStatus(tasks: Task[]): Map<TaskStatus, number> {
  const m = new Map<TaskStatus, number>();
  for (const t of tasks) m.set(t.status, (m.get(t.status) ?? 0) + 1);
  return m;
}

function maxCreatedAt(tasks: Task[]): number {
  return tasks.reduce(
    (m, t) => Math.max(m, new Date(t.created_at).getTime()),
    0,
  );
}

function maxDurationMs(tasks: Task[]): number {
  let max = 0;
  for (const t of tasks) {
    if (!t.started_at) continue;
    const end = t.finished_at ?? new Date().toISOString();
    const ms = new Date(end).getTime() - new Date(t.started_at).getTime();
    if (ms > max) max = ms;
  }
  return max;
}

// Pick the most "interesting" status in the group for sorting: running >
// claimed > queued > failed > timeout > completed > cancelled. Mirrors the
// STATUS_RANK in the group sort.
function worstStatus(tasks: Task[]): TaskStatus {
  const order: TaskStatus[] = [
    "running",
    "claimed",
    "queued",
    "failed",
    "timeout",
    "completed",
    "cancelled",
  ];
  for (const s of order) {
    if (tasks.some((t) => t.status === s)) return s;
  }
  return tasks[0]?.status ?? "queued";
}

const STATUS_CHIP_TONE: Record<TaskStatus, ChipOption<string>["tone"]> = {
  queued: "default",
  claimed: "blue",
  running: "blue",
  completed: "emerald",
  failed: "red",
  timeout: "amber",
  cancelled: "default",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const styles: Record<TaskStatus, string> = {
    queued: "bg-slate-800 text-slate-300 border-slate-700",
    claimed: "bg-blue-950 text-blue-300 border-blue-900",
    running: "bg-blue-900 text-blue-200 border-blue-700",
    completed: "bg-emerald-950 text-emerald-300 border-emerald-900",
    failed: "bg-red-950 text-red-300 border-red-900",
    timeout: "bg-amber-950 text-amber-300 border-amber-900",
    cancelled: "bg-slate-900 text-slate-500 border-slate-800",
  };
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function durationStr(t: Task): string {
  if (!t.started_at) return "—";
  const end = t.finished_at ?? new Date().toISOString();
  const ms = new Date(end).getTime() - new Date(t.started_at).getTime();
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function groupDurationStr(tasks: Task[]): string {
  // Use the longest task's duration as the group's representative duration —
  // matches how a user thinks about "how long did this group take".
  let maxMs = 0;
  let anyStarted = false;
  for (const t of tasks) {
    if (!t.started_at) continue;
    anyStarted = true;
    const end = t.finished_at ?? new Date().toISOString();
    const ms = new Date(end).getTime() - new Date(t.started_at).getTime();
    if (ms > maxMs) maxMs = ms;
  }
  if (!anyStarted) return "—";
  if (maxMs < 1000) return `${maxMs} ms`;
  return `${(maxMs / 1000).toFixed(1)} s`;
}
