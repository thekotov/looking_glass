import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import * as agentsApi from "../api/agents";
import { agentLabel, type Agent, type AgentStatus } from "../api/agents";
import { getAgentsRecent } from "../api/stats";
import { BulkActionBar } from "../components/BulkActionBar";
import { useConfirm } from "../components/ConfirmDialog";
import CreateTaskDialog, { type CreateTaskInitial } from "../components/CreateTaskDialog";
import { FilterChips, type ChipOption } from "../components/FilterChips";
import NavBar from "../components/NavBar";
import { PinButton } from "../components/PinButton";
import { SavedViews } from "../components/SavedViews";
import { SearchInput } from "../components/SearchInput";
import { SkeletonList } from "../components/Skeleton";
import { nextSort, type SortState } from "../components/SortableHeader";
import TagsEditor from "../components/TagsEditor";
import { useToast } from "../components/Toast";
import { useAuth } from "../hooks/useAuth";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useUndoable } from "../hooks/useUndoable";
import { useUrlState, useUrlStateMulti } from "../hooks/useUrlState";
import { useT } from "../i18n";
import { isAgentOnline } from "../lib/agents";
import { usePins } from "../lib/pins";

type AgentFilter = "pending" | "active" | "disabled" | "rejected" | "online" | "offline";
type AgentSortKey = "name" | "last_seen" | "status";

export default function Agents() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { t } = useT();
  const toast = useToast();
  const undoable = useUndoable();
  const canCreate = user?.role === "operator" || user?.role === "admin";
  const isAdmin = user?.role === "admin";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quickRun, setQuickRun] = useState<CreateTaskInitial | null>(null);
  useDocumentTitle(t("agents.title"));

  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.listAgents,
    refetchInterval: 3000,
  });
  // Per-agent last-20-statuses strip. Refreshed more slowly than the agents
  // list itself — these only change when tasks complete.
  const recentQ = useQuery({
    queryKey: ["agents-recent", 20],
    queryFn: () => getAgentsRecent(20),
    refetchInterval: 15_000,
  });
  const recentByAgent = useMemo(() => {
    const m = new Map<string, { statuses: string[]; durations: (number | null)[] }>();
    for (const r of recentQ.data ?? []) {
      m.set(r.agent_id, { statuses: r.statuses, durations: r.durations_ms });
    }
    return m;
  }, [recentQ.data]);
  // Strip view toggle: short coloured-status pills vs duration_ms line sparkline.
  const [stripView, setStripView] = useUrlState("strip", "status");

  // Scroll to the agent in the URL hash (e.g. arrived from the map).
  const location = useLocation();
  useEffect(() => {
    if (!location.hash || !agentsQuery.data) return;
    const id = decodeURIComponent(location.hash.slice(1));
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [location.hash, agentsQuery.data]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of agentsQuery.data ?? []) {
      for (const tag of a.tags) set.add(tag);
    }
    return Array.from(set).sort();
  }, [agentsQuery.data]);

  // URL-backed filter state — survives reload, shareable, back-button works.
  const [search, setSearch] = useUrlState("q", "");
  const [filters, setFilters] = useUrlStateMulti("filter");
  const [sortKey, setSortKey] = useUrlState("sort", "status");
  const [sortDir, setSortDir] = useUrlState("dir", "asc");
  const sort: SortState<AgentSortKey> = {
    key: (sortKey as AgentSortKey) || "status",
    dir: sortDir === "desc" ? "desc" : "asc",
  };
  function setSort(s: SortState<AgentSortKey>) {
    setSortKey(s.key);
    setSortDir(s.dir);
  }

  const all = agentsQuery.data ?? [];

  // Counts for chip badges — computed before filtering so they remain stable.
  const counts = useMemo(() => {
    const c: Record<AgentFilter, number> = {
      pending: 0,
      active: 0,
      disabled: 0,
      rejected: 0,
      online: 0,
      offline: 0,
    };
    for (const a of all) {
      if (a.status === "pending") c.pending++;
      if (a.status === "active") c.active++;
      if (a.status === "disabled") c.disabled++;
      if (a.status === "rejected") c.rejected++;
      if (a.status === "active") {
        if (isAgentOnline(a.last_seen)) c.online++;
        else c.offline++;
      }
    }
    return c;
  }, [all]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((a) => {
      if (q) {
        const hay = [
          a.display_name ?? "",
          a.hostname ?? "",
          a.public_ip ?? "",
          a.city ?? "",
          a.country_code ?? "",
          a.tags.join(" "),
          a.id,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (filters.length === 0) return true;
      // Chips OR together within the same group. A status chip and an online
      // chip both selected → "status AND on/offline".
      const statusFilters = filters.filter((f) =>
        ["pending", "active", "disabled", "rejected"].includes(f),
      );
      const onlineFilters = filters.filter((f) => f === "online" || f === "offline");
      if (statusFilters.length > 0 && !statusFilters.includes(a.status)) return false;
      if (onlineFilters.length > 0) {
        const on = isAgentOnline(a.last_seen);
        if (onlineFilters.includes("online") && !on) return false;
        if (onlineFilters.includes("offline") && on) return false;
      }
      return true;
    });
  }, [all, search, filters]);

  const pinned = usePins("agents");
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

  const sorted = useMemo(() => {
    const STATUS_ORDER: Record<AgentStatus, number> = {
      pending: 0,
      active: 1,
      disabled: 2,
      rejected: 3,
    };
    const out = [...filtered];
    out.sort((a, b) => {
      // Pinned items always float to the top regardless of sort order.
      const ap = pinnedSet.has(a.id) ? 0 : 1;
      const bp = pinnedSet.has(b.id) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      let cmp = 0;
      switch (sort.key) {
        case "name":
          cmp = agentLabel(a).localeCompare(agentLabel(b));
          break;
        case "last_seen": {
          const av = a.last_seen ? new Date(a.last_seen).getTime() : 0;
          const bv = b.last_seen ? new Date(b.last_seen).getTime() : 0;
          cmp = av - bv;
          break;
        }
        case "status":
          cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          if (cmp === 0) cmp = agentLabel(a).localeCompare(agentLabel(b));
          break;
      }
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [filtered, sort, pinnedSet]);

  // Drop stale selections after refetch deletes/renames change the list.
  const visibleIds = useMemo(() => new Set(sorted.map((a) => a.id)), [sorted]);
  if (selected.size > 0) {
    let drift = false;
    for (const id of selected) if (!visibleIds.has(id)) { drift = true; break; }
    if (drift) {
      const next = new Set<string>();
      for (const id of selected) if (visibleIds.has(id)) next.add(id);
      queueMicrotask(() => setSelected(next));
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Bulk operations. All four go through the optimistic patch/remove
  // helpers we already use for single-agent mutations.
  async function bulkPatch(updater: (a: Agent) => Agent, ids: string[]) {
    await qc.cancelQueries({ queryKey: ["agents"] });
    const prev = qc.getQueryData<Agent[]>(["agents"]);
    qc.setQueryData<Agent[]>(["agents"], (curr) =>
      (curr ?? []).map((x) => (ids.includes(x.id) ? updater(x) : x)),
    );
    return prev;
  }
  async function bulkRemove(ids: string[]) {
    await qc.cancelQueries({ queryKey: ["agents"] });
    const prev = qc.getQueryData<Agent[]>(["agents"]);
    qc.setQueryData<Agent[]>(["agents"], (curr) =>
      (curr ?? []).filter((x) => !ids.includes(x.id)),
    );
    return prev;
  }

  async function bulkApprove() {
    if (!isAdmin) return;
    const ids = Array.from(selected).filter(
      (id) => all.find((a) => a.id === id)?.status === "pending",
    );
    if (ids.length === 0) return;
    const prev = await bulkPatch((a) => ({ ...a, status: "active" }), ids);
    setSelected(new Set());
    try {
      await Promise.all(ids.map((id) => agentsApi.approveAgent(id, [])));
      toast.success(t("agents.approve"), `${ids.length}`);
    } catch (e) {
      if (prev) qc.setQueryData(["agents"], prev);
      toast.error(t("agents.approve"), e instanceof Error ? e.message : String(e));
    } finally {
      qc.invalidateQueries({ queryKey: ["agents"] });
    }
  }

  async function bulkAddTags(addTags: string[]) {
    if (!isAdmin || addTags.length === 0) return;
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const prev = await bulkPatch(
      (a) => ({ ...a, tags: Array.from(new Set([...a.tags, ...addTags])) }),
      ids,
    );
    setSelected(new Set());
    try {
      await Promise.all(
        ids.map((id) => {
          const current = all.find((a) => a.id === id);
          const merged = current
            ? Array.from(new Set([...current.tags, ...addTags]))
            : addTags;
          return agentsApi.updateAgent(id, { tags: merged });
        }),
      );
      toast.success(t("agents.bulkTagAdded"), addTags.join(", "));
    } catch (e) {
      if (prev) qc.setQueryData(["agents"], prev);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      qc.invalidateQueries({ queryKey: ["agents"] });
    }
  }

  async function bulkDisable(enable: boolean) {
    if (!isAdmin) return;
    const ids = Array.from(selected).filter((id) => {
      const a = all.find((x) => x.id === id);
      return a && a.status !== "pending" && a.status !== "rejected";
    });
    if (ids.length === 0) return;
    const next: AgentStatus = enable ? "active" : "disabled";
    const prev = await bulkPatch((a) => ({ ...a, status: next }), ids);
    setSelected(new Set());
    try {
      await Promise.all(
        ids.map((id) => agentsApi.updateAgent(id, { status: next })),
      );
      toast.success(
        enable ? t("agents.enable") : t("agents.disable"),
        `${ids.length}`,
      );
    } catch (e) {
      if (prev) qc.setQueryData(["agents"], prev);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      qc.invalidateQueries({ queryKey: ["agents"] });
    }
  }

  function bulkDelete() {
    if (!isAdmin) return;
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const prevSnapshot = qc.getQueryData<Agent[]>(["agents"]);
    setSelected(new Set());
    undoable({
      preview: () => {
        bulkRemove(ids);
      },
      revert: () => {
        if (prevSnapshot) qc.setQueryData(["agents"], prevSnapshot);
      },
      commit: async () => {
        const results = await Promise.allSettled(
          ids.map((id) => agentsApi.deleteAgent(id)),
        );
        qc.invalidateQueries({ queryKey: ["agents"] });
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          throw new Error(
            t("tasks.bulkDeletePartial", { failed, total: ids.length }),
          );
        }
      },
      title: t("agents.bulkDeleted", { n: ids.length }),
      errorTitle: t("common.delete"),
    });
  }

  const chipOptions: ChipOption<AgentFilter>[] = [
    { value: "pending", label: t("agents.filter.pending"), count: counts.pending, tone: "amber" },
    { value: "active", label: t("agents.filter.active"), count: counts.active, tone: "emerald" },
    { value: "online", label: t("agents.filter.online"), count: counts.online, tone: "emerald" },
    { value: "offline", label: t("agents.filter.offline"), count: counts.offline },
    { value: "disabled", label: t("agents.filter.disabled"), count: counts.disabled },
    { value: "rejected", label: t("agents.filter.rejected"), count: counts.rejected, tone: "red" },
  ];

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-6">
        <h1 className="mb-4 text-2xl font-semibold text-slate-100">{t("agents.title")}</h1>

        {isAdmin && selected.size > 0 && (
          <BulkActionBar
            count={selected.size}
            total={sorted.length}
            onSelectAll={() => setSelected(new Set(sorted.map((a) => a.id)))}
            onClear={() => setSelected(new Set())}
            selectAllLabel={t("common.selectAll")}
            clearLabel={t("common.clearSelection")}
          >
            <button
              type="button"
              onClick={bulkApprove}
              className="rounded border border-emerald-500 bg-emerald-600/20 px-2 py-0.5 text-xs font-medium text-emerald-100 hover:bg-emerald-600/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              {t("agents.bulkApprove")}
            </button>
            <BulkTagButton allTags={allTags} onApply={bulkAddTags} />
            <button
              type="button"
              onClick={() => bulkDisable(false)}
              className="rounded border border-amber-700 bg-amber-700/20 px-2 py-0.5 text-xs font-medium text-amber-100 hover:bg-amber-700/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              {t("agents.bulkDisable")}
            </button>
            <button
              type="button"
              onClick={() => bulkDisable(true)}
              className="rounded border border-slate-600 bg-slate-700/20 px-2 py-0.5 text-xs font-medium text-slate-100 hover:bg-slate-700/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              {t("agents.bulkEnable")}
            </button>
            <button
              type="button"
              onClick={bulkDelete}
              className="rounded border border-red-500 bg-red-600/20 px-2 py-0.5 text-xs font-medium text-red-100 hover:bg-red-600/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              {t("agents.bulkDelete")}
            </button>
          </BulkActionBar>
        )}

        {all.length > 0 && (
          <div className="mb-2">
            <SavedViews
              scope="agents"
              presets={[
                { name: t("agents.preset.pending"), query: "filter=pending" },
                { name: t("agents.preset.offline"), query: "filter=offline" },
              ]}
            />
          </div>
        )}

        {/* Toolbar: search + chips + sort */}
        {all.length > 0 && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={t("agents.searchPlaceholder")}
              ariaLabel={t("agents.searchAria")}
              className="sm:max-w-xs"
            />
            <FilterChips
              options={chipOptions}
              value={filters as AgentFilter[]}
              onChange={(v) => setFilters(v)}
              ariaLabel={t("agents.filterAria")}
            />
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-500">
              <div className="inline-flex overflow-hidden rounded border border-slate-700">
                {(["status", "latency"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setStripView(v)}
                    aria-pressed={stripView === v}
                    className={`px-2 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                      stripView === v
                        ? "bg-slate-100 text-slate-900"
                        : "text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    {t(`agents.strip.${v}`)}
                  </button>
                ))}
              </div>
              <span>{t("common.sort")}:</span>
              {(["status", "name", "last_seen"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSort(nextSort(sort, k, k === "last_seen" ? "desc" : "asc"))}
                  className={`rounded border px-1.5 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                    sort.key === k
                      ? "border-slate-300 text-slate-100"
                      : "border-slate-700 text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t(`agents.sort.${k}`)}
                  {sort.key === k && (
                    <span className="ml-0.5 text-[9px]">{sort.dir === "asc" ? "▲" : "▼"}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <section className="rounded-lg border border-slate-800 bg-slate-900">
          {agentsQuery.isLoading && <SkeletonList rows={4} />}
          {agentsQuery.isError && (
            <p role="alert" className="px-6 py-4 text-sm text-red-400">
              {agentsQuery.error instanceof Error
                ? agentsQuery.error.message
                : t("agents.failedToLoad")}
            </p>
          )}
          {agentsQuery.data && agentsQuery.data.length === 0 && (
            <p className="px-6 py-4 text-sm text-slate-500">
              {t("agents.empty")}{" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                docker compose -f deploy/docker-compose.agent.yml up
              </code>{" "}
              {t("agents.emptyAfter")}
            </p>
          )}
          {all.length > 0 && sorted.length === 0 && (
            <p className="px-6 py-6 text-center text-sm text-slate-500">
              {t("agents.noMatches")}{" "}
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setFilters([]);
                }}
                className="text-slate-300 underline-offset-2 hover:underline"
              >
                {t("common.clearFilters")}
              </button>
            </p>
          )}
          {sorted.length > 0 && (
            <ul className="divide-y divide-slate-800">
              {sorted.map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  isAdmin={isAdmin}
                  canCreate={!!canCreate}
                  allTags={allTags}
                  recent={recentByAgent.get(a.id) ?? { statuses: [], durations: [] }}
                  stripView={stripView === "latency" ? "latency" : "status"}
                  selected={selected.has(a.id)}
                  onToggleSelect={isAdmin ? () => toggleSelected(a.id) : undefined}
                  onQuickRun={() =>
                    setQuickRun({
                      routing: { mode: "agents", agentIds: [a.id] },
                    })
                  }
                  onChange={() => qc.invalidateQueries({ queryKey: ["agents"] })}
                />
              ))}
            </ul>
          )}
        </section>

      </main>

      <CreateTaskDialog
        open={!!quickRun}
        agents={agentsQuery.data ?? []}
        initial={quickRun ?? undefined}
        onClose={() => setQuickRun(null)}
      />
    </div>
  );
}

function AgentRow({
  agent,
  isAdmin,
  canCreate,
  allTags,
  recent,
  stripView,
  selected,
  onToggleSelect,
  onQuickRun,
  onChange,
}: {
  agent: Agent;
  isAdmin: boolean;
  canCreate: boolean;
  allTags: string[];
  recent: { statuses: string[]; durations: (number | null)[] };
  stripView: "status" | "latency";
  selected: boolean;
  onToggleSelect?: () => void;
  onQuickRun?: () => void;
  onChange: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);

  // Edit-mode local state. Initialised from `agent` on entry; we discard on cancel.
  const [displayName, setDisplayName] = useState(agent.display_name ?? "");
  const [description, setDescription] = useState(agent.description ?? "");
  const [tags, setTags] = useState<string[]>(agent.tags);
  const [latitude, setLatitude] = useState(
    agent.latitude !== null ? String(agent.latitude) : "",
  );
  const [longitude, setLongitude] = useState(
    agent.longitude !== null ? String(agent.longitude) : "",
  );
  const [city, setCity] = useState(agent.city ?? "");
  const [countryCode, setCountryCode] = useState(agent.country_code ?? "");

  // Approval-only state (pending agents).
  const [approveTags, setApproveTags] = useState<string[]>([]);

  function startEdit() {
    setDisplayName(agent.display_name ?? "");
    setDescription(agent.description ?? "");
    setTags(agent.tags);
    setLatitude(agent.latitude !== null ? String(agent.latitude) : "");
    setLongitude(agent.longitude !== null ? String(agent.longitude) : "");
    setCity(agent.city ?? "");
    setCountryCode(agent.country_code ?? "");
    setEditing(true);
  }

  function parseLatLon(s: string): number | null {
    const v = s.trim();
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // The optimistic helpers below all share the same pattern: cancel any
  // in-flight refetch so we don't get stomped, patch the cached agents list,
  // and remember the previous value so onError can roll back. onSettled
  // re-fetches authoritative state.
  const qc = useQueryClient();
  async function optimisticPatch(updater: (a: Agent) => Agent) {
    await qc.cancelQueries({ queryKey: ["agents"] });
    const prev = qc.getQueryData<Agent[]>(["agents"]);
    qc.setQueryData<Agent[]>(["agents"], (curr) =>
      (curr ?? []).map((x) => (x.id === agent.id ? updater(x) : x)),
    );
    return { prev };
  }
  async function optimisticRemove() {
    await qc.cancelQueries({ queryKey: ["agents"] });
    const prev = qc.getQueryData<Agent[]>(["agents"]);
    qc.setQueryData<Agent[]>(["agents"], (curr) =>
      (curr ?? []).filter((x) => x.id !== agent.id),
    );
    return { prev };
  }
  function rollback(ctx: { prev: Agent[] | undefined } | undefined) {
    if (ctx?.prev) qc.setQueryData(["agents"], ctx.prev);
  }

  const approve = useMutation({
    mutationFn: () => agentsApi.approveAgent(agent.id, approveTags),
    onMutate: () =>
      optimisticPatch((a) => ({ ...a, status: "active", tags: [...new Set([...a.tags, ...approveTags])] })),
    onSuccess: () => {
      toast.success(t("agents.approve"), agentLabel(agent));
      setApproveTags([]);
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      toast.error(t("agents.approve"), err instanceof Error ? err.message : String(err));
    },
    onSettled: onChange,
  });

  const reject = useMutation({
    mutationFn: () => agentsApi.rejectAgent(agent.id),
    onMutate: () => optimisticPatch((a) => ({ ...a, status: "rejected" })),
    onSuccess: () => toast.info(t("agents.reject"), agentLabel(agent)),
    onError: (err, _v, ctx) => {
      rollback(ctx);
      toast.error(t("agents.reject"), err instanceof Error ? err.message : String(err));
    },
    onSettled: onChange,
  });

  const save = useMutation({
    mutationFn: () =>
      agentsApi.updateAgent(agent.id, {
        display_name: displayName.trim() || null,
        description: description.trim() || null,
        tags,
        latitude: parseLatLon(latitude),
        longitude: parseLatLon(longitude),
        city: city.trim() || null,
        country_code: countryCode.trim().toUpperCase() || null,
      }),
    onMutate: () =>
      optimisticPatch((a) => ({
        ...a,
        display_name: displayName.trim() || null,
        description: description.trim() || null,
        tags,
        latitude: parseLatLon(latitude),
        longitude: parseLatLon(longitude),
        city: city.trim() || null,
        country_code: countryCode.trim().toUpperCase() || null,
      })),
    onSuccess: () => {
      toast.success(t("agents.saved"), agentLabel(agent));
      setEditing(false);
    },
    onError: (err, _v, ctx) => {
      rollback(ctx);
      toast.error(t("agents.saved"), err instanceof Error ? err.message : String(err));
    },
    onSettled: onChange,
  });

  const geoDetect = useMutation({
    mutationFn: () => agentsApi.geoDetectAgent(agent.id),
    onSuccess: (updated) => {
      // Apply to the edit form so the user sees what got filled in.
      setLatitude(updated.latitude !== null ? String(updated.latitude) : "");
      setLongitude(updated.longitude !== null ? String(updated.longitude) : "");
      setCity(updated.city ?? "");
      setCountryCode(updated.country_code ?? "");
      toast.success(
        t("agents.geoDetected"),
        [updated.city, updated.country_code].filter(Boolean).join(", "),
      );
      onChange();
    },
    onError: (err) =>
      toast.error(t("agents.geoDetect"), err instanceof Error ? err.message : String(err)),
  });

  const toggleStatus = useMutation({
    mutationFn: () =>
      agentsApi.updateAgent(agent.id, {
        status: agent.status === "active" ? "disabled" : "active",
      }),
    onMutate: () =>
      optimisticPatch((a) => ({
        ...a,
        status: a.status === "active" ? "disabled" : "active",
      })),
    onSuccess: (a) =>
      toast.info(a.status === "active" ? t("agents.enable") : t("agents.disable"), agentLabel(agent)),
    onError: (err, _v, ctx) => {
      rollback(ctx);
      toast.error(err instanceof Error ? err.message : String(err));
    },
    onSettled: onChange,
  });

  const remove = useMutation({
    mutationFn: () => agentsApi.deleteAgent(agent.id),
    onMutate: () => optimisticRemove(),
    onSuccess: () => toast.info(t("common.delete"), agentLabel(agent)),
    onError: (err, _v, ctx) => {
      rollback(ctx);
      toast.error(t("common.delete"), err instanceof Error ? err.message : String(err));
    },
    onSettled: onChange,
  });

  const label = agentLabel(agent);
  const hostnameIsOverridden = agent.display_name && agent.display_name.trim() !== agent.hostname;

  return (
    <li
      id={`agent-${agent.id}`}
      className={`px-6 py-4 scroll-mt-20 [&:target]:bg-slate-800/40 [&:target]:ring-1 [&:target]:ring-inset [&:target]:ring-emerald-500/30 ${
        selected ? "bg-emerald-950/15" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        {onToggleSelect && (
          <input
            type="checkbox"
            aria-label="select agent"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-slate-700 bg-slate-950 accent-emerald-500"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <PinButton scope="agents" id={agent.id} />
            <h3 className="font-mono text-sm text-slate-100">{label}</h3>
            <StatusBadge status={agent.status} />
            <OnlineBadge lastSeen={agent.last_seen} />
            {hostnameIsOverridden && (
              <span
                title={`${t("agents.hostnameSystem")}: ${agent.hostname}`}
                className="font-mono text-[10px] uppercase tracking-wide text-slate-600"
              >
                {t("agents.hostnameSystem")}: {agent.hostname}
              </span>
            )}
          </div>

          {agent.description && !editing && (
            <p className="mt-1 text-xs text-slate-400">{agent.description}</p>
          )}

          <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-400 sm:grid-cols-3">
            <Field label={t("field.id")} value={agent.id} mono />
            <Field label={t("field.ip")} value={agent.public_ip ?? "—"} mono />
            <Field label={t("field.version")} value={agent.version || "—"} mono />
            <Field
              label={t("field.lastSeen")}
              value={agent.last_seen ? new Date(agent.last_seen).toLocaleString() : t("common.never")}
            />
            <Field label={t("field.caps")} value={agent.capabilities.join(", ") || "—"} />
            <Field label={t("field.tags")} value={agent.tags.join(", ") || "—"} />
          </dl>

          {recent.statuses.length > 0 && (
            <RecentTaskStrip
              statuses={recent.statuses}
              durations={recent.durations}
              view={stripView}
            />
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {!isAdmin && (
            <span className="text-[10px] uppercase text-slate-600">{t("agents.adminOnly")}</span>
          )}
          {isAdmin && agent.status === "pending" && !editing && (
            <PendingActions
              agent={agent}
              tags={approveTags}
              onTagsChange={setApproveTags}
              allTags={allTags}
              onApprove={() => approve.mutate()}
              approvePending={approve.isPending}
              onReject={() => reject.mutate()}
              rejectPending={reject.isPending}
            />
          )}
          {canCreate && agent.status === "active" && !editing && onQuickRun && (
            <button
              type="button"
              onClick={onQuickRun}
              title={t("agents.quickRunHint")}
              className="rounded border border-blue-800 bg-blue-950/40 px-3 py-1 text-xs text-blue-200 hover:bg-blue-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              ↑ {t("agents.quickRun")}
            </button>
          )}
          {isAdmin && agent.status !== "pending" && !editing && (
            <>
              <button
                onClick={startEdit}
                className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              >
                {t("common.edit")}
              </button>
              {(agent.status === "active" || agent.status === "disabled") && (
                <button
                  onClick={() => toggleStatus.mutate()}
                  disabled={toggleStatus.isPending}
                  className={`rounded border px-3 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                    agent.status === "active"
                      ? "border-amber-900 text-amber-300 hover:bg-amber-950"
                      : "border-emerald-900 text-emerald-300 hover:bg-emerald-950"
                  } disabled:opacity-50`}
                >
                  {agent.status === "active" ? t("agents.disable") : t("agents.enable")}
                </button>
              )}
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: t("agents.confirmDelete", { name: label }),
                    danger: true,
                    confirmLabel: t("common.delete"),
                  });
                  if (ok) remove.mutate();
                }}
                disabled={remove.isPending}
                className="rounded border border-red-900 px-3 py-1 text-xs text-red-300 hover:bg-red-950 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              >
                {t("common.delete")}
              </button>
            </>
          )}
        </div>
      </div>

      {editing && (
        <EditPanel
          displayName={displayName}
          setDisplayName={setDisplayName}
          description={description}
          setDescription={setDescription}
          tags={tags}
          setTags={setTags}
          allTags={allTags}
          latitude={latitude}
          setLatitude={setLatitude}
          longitude={longitude}
          setLongitude={setLongitude}
          city={city}
          setCity={setCity}
          countryCode={countryCode}
          setCountryCode={setCountryCode}
          hasPublicIp={!!agent.public_ip}
          onGeoDetect={() => geoDetect.mutate()}
          geoDetecting={geoDetect.isPending}
          onCancel={() => setEditing(false)}
          onSave={() => save.mutate()}
          saving={save.isPending}
          hostnameHint={agent.hostname}
        />
      )}

      {(approve.error || reject.error || remove.error || save.error || toggleStatus.error) && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {String(
            approve.error ?? reject.error ?? remove.error ?? save.error ?? toggleStatus.error,
          )}
        </p>
      )}
    </li>
  );
}

function PendingActions({
  agent,
  tags,
  onTagsChange,
  allTags,
  onApprove,
  approvePending,
  onReject,
  rejectPending,
}: {
  agent: Agent;
  tags: string[];
  onTagsChange: (t: string[]) => void;
  allTags: string[];
  onApprove: () => void;
  approvePending: boolean;
  onReject: () => void;
  rejectPending: boolean;
}) {
  const { t } = useT();
  return (
    <div className="w-72 space-y-2">
      <div>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {t("agents.tags")}
        </span>
        <TagsEditor
          value={tags}
          onChange={onTagsChange}
          suggestions={allTags}
          placeholder={t("agents.addTag")}
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={onApprove}
          disabled={approvePending}
          className="flex-1 rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          {approvePending ? "…" : t("agents.approve")}
        </button>
        <button
          onClick={onReject}
          disabled={rejectPending}
          className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          {t("agents.reject")}
        </button>
      </div>
      <p className="text-[10px] text-slate-600">
        {agent.hostname}
      </p>
    </div>
  );
}

function EditPanel({
  displayName,
  setDisplayName,
  description,
  setDescription,
  tags,
  setTags,
  allTags,
  latitude,
  setLatitude,
  longitude,
  setLongitude,
  city,
  setCity,
  countryCode,
  setCountryCode,
  hasPublicIp,
  onGeoDetect,
  geoDetecting,
  onCancel,
  onSave,
  saving,
  hostnameHint,
}: {
  displayName: string;
  setDisplayName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  tags: string[];
  setTags: (t: string[]) => void;
  allTags: string[];
  latitude: string;
  setLatitude: (v: string) => void;
  longitude: string;
  setLongitude: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  countryCode: string;
  setCountryCode: (v: string) => void;
  hasPublicIp: boolean;
  onGeoDetect: () => void;
  geoDetecting: boolean;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  hostnameHint: string;
}) {
  const { t } = useT();
  return (
    <div className="mt-4 space-y-3 rounded border border-slate-800 bg-slate-950/60 p-4">
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-slate-500">
          {t("agents.displayName")}
        </span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t("agents.displayNamePlaceholder")}
          maxLength={255}
          className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        />
        <span className="mt-1 block text-[10px] text-slate-500">
          {t("agents.displayNameHint")} <span className="font-mono text-slate-600">({hostnameHint})</span>
        </span>
      </label>

      <label className="block">
        <span className="text-xs uppercase tracking-wide text-slate-500">
          {t("agents.description")}
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("agents.descriptionPlaceholder")}
          rows={2}
          maxLength={1024}
          className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        />
      </label>

      <div>
        <span className="text-xs uppercase tracking-wide text-slate-500">{t("agents.tags")}</span>
        <div className="mt-1">
          <TagsEditor value={tags} onChange={setTags} suggestions={allTags} />
        </div>
      </div>

      <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            {t("agents.location")}
          </span>
          <button
            type="button"
            onClick={onGeoDetect}
            disabled={!hasPublicIp || geoDetecting}
            title={!hasPublicIp ? t("agents.geoDetectDisabledHint") : undefined}
            className="rounded border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-300 hover:bg-slate-800 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            {geoDetecting ? "…" : `↻ ${t("agents.geoDetect")}`}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
          <label className="sm:col-span-3">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("agents.latitude")}
            </span>
            <input
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="50.11"
              inputMode="decimal"
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
          <label className="sm:col-span-3">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("agents.longitude")}
            </span>
            <input
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="8.68"
              inputMode="decimal"
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
          <label className="sm:col-span-4">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("agents.city")}
            </span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Frankfurt"
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("agents.countryCode")}
            </span>
            <input
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              placeholder="DE"
              maxLength={3}
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-xs uppercase text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
        </div>
        <p className="mt-2 text-[10px] text-slate-600">{t("agents.geoHint")}</p>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          {saving ? t("common.creating") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const styles: Record<AgentStatus, string> = {
    pending: "bg-amber-950 text-amber-300 border-amber-900",
    active: "bg-emerald-950 text-emerald-300 border-emerald-900",
    rejected: "bg-red-950 text-red-300 border-red-900",
    disabled: "bg-slate-800 text-slate-400 border-slate-700",
  };
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${styles[status]}`}>
      {status}
    </span>
  );
}

function OnlineBadge({ lastSeen }: { lastSeen: string | null }) {
  const { t } = useT();
  if (!lastSeen) return null;
  const ageSec = (Date.now() - new Date(lastSeen).getTime()) / 1000;
  const online = ageSec < 60;
  return (
    <span
      className={`flex items-center gap-1 text-[10px] uppercase tracking-wide ${
        online ? "text-emerald-400" : "text-slate-500"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          online ? "bg-emerald-400" : "bg-slate-600"
        }`}
      />
      {online ? t("agents.online") : t("agents.seenAgo", { sec: Math.floor(ageSec) })}
    </span>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-600">{label}</dt>
      <dd className={`truncate ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

// Tiny popover that wraps TagsEditor + an Apply button. Lives in the bulk
// action bar; opens on click, applies the picked tags to all selected agents
// via the bulk patch helper above.
function BulkTagButton({
  allTags,
  onApply,
}: {
  allTags: string[];
  onApply: (tags: string[]) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded border border-blue-700 bg-blue-700/20 px-2 py-0.5 text-xs font-medium text-blue-100 hover:bg-blue-700/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        {t("agents.bulkTag")}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("agents.bulkTag")}
          className="absolute right-0 z-30 mt-1 w-72 rounded border border-slate-700 bg-slate-900 p-3 shadow-lg"
        >
          <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
            {t("agents.bulkTagHint")}
          </p>
          <TagsEditor value={tags} onChange={setTags} suggestions={allTags} />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setTags([]);
                setOpen(false);
              }}
              className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              disabled={tags.length === 0}
              onClick={() => {
                onApply(tags);
                setTags([]);
                setOpen(false);
              }}
              className="rounded bg-blue-500 px-3 py-0.5 text-xs font-medium text-slate-50 hover:bg-blue-400 disabled:opacity-50"
            >
              {t("common.save")}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

// Mini-strip of the agent's last 20 task statuses (newest on the right).
// Two modes: "status" (coloured pill per task) and "latency" (line chart
// of duration_ms). Both render newest-on-the-right for natural reading.
function RecentTaskStrip({
  statuses,
  durations,
  view,
}: {
  statuses: string[];
  durations: (number | null)[];
  view: "status" | "latency";
}) {
  // Server returns newest-first; flip so the strip reads left-to-right.
  const orderedStatuses = useMemo(() => [...statuses].reverse(), [statuses]);
  const orderedDurations = useMemo(() => [...durations].reverse(), [durations]);

  if (view === "latency") {
    return (
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-600">latency</span>
        <LatencySpark
          durations={orderedDurations}
          statuses={orderedStatuses}
          width={120}
          height={20}
        />
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-slate-600">recent</span>
      <div className="flex h-3 items-center gap-[1px]">
        {orderedStatuses.map((s, i) => (
          <span
            key={i}
            title={s + (orderedDurations[i] != null ? ` · ${orderedDurations[i]}ms` : "")}
            className={`inline-block h-3 w-1 rounded-[1px] ${STATUS_DOT[s] ?? "bg-slate-700"}`}
          />
        ))}
      </div>
    </div>
  );
}

function LatencySpark({
  durations,
  statuses,
  width,
  height,
}: {
  durations: (number | null)[];
  statuses: string[];
  width: number;
  height: number;
}) {
  // Coerce to numbers; failed/timeout tasks plot at the top as a red dot.
  const known = durations.filter((d): d is number => d != null);
  if (known.length === 0) {
    return (
      <svg width={width} height={height} aria-label="no latency samples">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#334155" strokeDasharray="2 2" />
      </svg>
    );
  }
  const min = Math.min(...known);
  const max = Math.max(...known);
  const range = Math.max(1, max - min);
  const step = durations.length > 1 ? width / (durations.length - 1) : 0;

  const points = durations.map((d, i) => {
    const x = i * step;
    const y =
      d == null
        ? 1 // pin failed tasks to the top — visually obvious as outliers
        : height - ((d - min) / range) * (height - 2) - 1;
    return { x, y, d, status: statuses[i] };
  });

  const path = points
    .filter((p) => p.d != null)
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      aria-label={`latency ${min.toFixed(0)}–${max.toFixed(0)} ms`}
      className="overflow-visible"
    >
      <path d={path} fill="none" stroke="#34d399" strokeWidth={1.25} strokeLinejoin="round" />
      {points.map((p, i) =>
        p.d == null ? (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={1.5}
            fill={p.status === "failed" || p.status === "timeout" ? "#ef4444" : "#475569"}
          />
        ) : null,
      )}
      <text
        x={width}
        y={height - 1}
        textAnchor="end"
        style={{ fontSize: 8, fontFamily: "ui-monospace, monospace", fill: "#94a3b8" }}
      >
        {known[known.length - 1].toFixed(0)}ms
      </text>
    </svg>
  );
}

const STATUS_DOT: Record<string, string> = {
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  timeout: "bg-amber-500",
  cancelled: "bg-slate-600",
  running: "bg-blue-500",
  claimed: "bg-blue-400",
  queued: "bg-slate-700",
};
