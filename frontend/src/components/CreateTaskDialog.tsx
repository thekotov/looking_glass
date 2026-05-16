import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { Agent } from "../api/agents";
import { agentLabel } from "../api/agents";
import * as tasksApi from "../api/tasks";
import { useT } from "../i18n";
import { previewCommand } from "../lib/commandPreview";
import { getRecentTargets, pushRecentTarget } from "../lib/recentTargets";
import {
  deleteTemplate,
  loadTemplates,
  saveTemplate,
  type SavedTemplate,
} from "../lib/taskTemplates";
import { validateTargetFor } from "../lib/targetValidator";
import PreviewPanel from "./CreateTaskDialog/PreviewPanel";
import RoutingPicker, { type RoutingMode } from "./CreateTaskDialog/RoutingPicker";
import TypeFields, { type TaskType } from "./CreateTaskDialog/TypeFields";
import { useToast } from "./Toast";

export type CreateTaskInitial = {
  type?: TaskType;
  target?: string;
  options?: Record<string, unknown>;
  routing?:
    | { mode: "agents"; agentIds: string[] }
    | { mode: "tags"; tags: string[]; agentsPerTag: number };
};

type Props = {
  open: boolean;
  agents: Agent[];
  defaultAgentId?: string;
  /** Prefill values for re-run / templates. When `open` flips true, the form
   * resets to these values. */
  initial?: CreateTaskInitial;
  onClose: () => void;
};

const TASK_TYPES: TaskType[] = [
  "ping",
  "traceroute",
  "mtr",
  "mtr_tcp",
  "tcp_connect",
  "tcp_scan",
  "syn_scan",
  "hping3",
  "dns",
  "http_check",
  "tls_check",
];

const TARGET_HINT: Record<TaskType, string> = {
  ping: "hostname or public IPv4/IPv6",
  traceroute: "hostname or public IPv4/IPv6",
  mtr: "hostname or public IPv4/IPv6",
  mtr_tcp: "hostname or public IPv4/IPv6",
  tcp_connect: "hostname or public IPv4/IPv6",
  tcp_scan: "hostname or public IPv4/IPv6",
  syn_scan: "hostname or public IPv4 (Linux agent only)",
  hping3: "hostname or public IPv4/IPv6",
  dns: "domain to resolve (e.g. cloudflare.com)",
  http_check: "URL (https://...) or hostname",
  tls_check: "hostname (sent as SNI)",
};

// i18n keys for each type's one-line description. Resolved via the t()
// hook so we don't have to keep two hardcoded copies in sync.
const TYPE_DESC_KEY: Record<TaskType, string> = {
  ping: "create.descPing",
  traceroute: "create.descTraceroute",
  mtr: "create.descMtr",
  mtr_tcp: "create.descMtrTcp",
  tcp_connect: "create.descTcpConnect",
  tcp_scan: "create.descTcpScan",
  syn_scan: "create.descSynScan",
  hping3: "create.descHping3",
  dns: "create.descDns",
  http_check: "create.descHttpCheck",
  tls_check: "create.descTlsCheck",
};

export default function CreateTaskDialog({ open, agents, defaultAgentId, initial, onClose }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { t } = useT();
  const toast = useToast();
  const activeAgents = useMemo(() => agents.filter((a) => a.status === "active"), [agents]);

  const [type, setType] = useState<TaskType>("ping");
  const [target, setTarget] = useState("1.1.1.1");
  const [opts, setOpts] = useState<Record<string, unknown>>({});
  const [mode, setMode] = useState<RoutingMode>("agents");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(
    defaultAgentId ? [defaultAgentId] : activeAgents[0] ? [activeAgents[0].id] : [],
  );
  const [tagsInput, setTagsInput] = useState("");
  const [agentsPerTag, setAgentsPerTag] = useState(1);
  const [touchedTarget, setTouchedTarget] = useState(false);
  const [recents] = useState<string[]>(() => getRecentTargets());

  // When the dialog (re-)opens with `initial`, hydrate the form. Re-run from
  // a completed task lands here, as does picking a saved template.
  useEffect(() => {
    if (!open || !initial) return;
    if (initial.type) setType(initial.type);
    if (initial.target !== undefined) setTarget(initial.target);
    if (initial.options) setOpts(initial.options);
    if (initial.routing) {
      setMode(initial.routing.mode);
      if (initial.routing.mode === "agents") {
        setSelectedAgentIds(initial.routing.agentIds);
        setTagsInput("");
      } else {
        setTagsInput(initial.routing.tags.join(", "));
        setAgentsPerTag(initial.routing.agentsPerTag);
      }
    }
  }, [open, initial]);

  const targetValidation = useMemo(
    () => validateTargetFor(type, target),
    [type, target],
  );
  const targetError =
    !targetValidation.ok && touchedTarget && target.length > 0
      ? targetValidation.reason
      : null;

  const tagsList = useMemo(
    () => tagsInput.split(",").map((s) => s.trim()).filter(Boolean),
    [tagsInput],
  );

  // Saved templates state — re-read on open so changes from other tabs land.
  const [templates, setTemplates] = useState<SavedTemplate[]>(() => loadTemplates());
  useEffect(() => {
    if (open) setTemplates(loadTemplates());
  }, [open]);

  function applyTemplate(tpl: SavedTemplate) {
    const d = tpl.data;
    if (d.type) setType(d.type);
    if (d.target !== undefined) setTarget(d.target);
    if (d.options) setOpts(d.options);
    if (d.routing) {
      setMode(d.routing.mode);
      if (d.routing.mode === "agents") setSelectedAgentIds(d.routing.agentIds);
      else {
        setTagsInput(d.routing.tags.join(", "));
        setAgentsPerTag(d.routing.agentsPerTag);
      }
    }
  }

  function onSaveTemplate() {
    const name = window.prompt(t("create.templateNamePrompt"));
    if (!name?.trim()) return;
    const routing: CreateTaskInitial["routing"] =
      mode === "agents"
        ? { mode: "agents", agentIds: selectedAgentIds }
        : { mode: "tags", tags: tagsList, agentsPerTag };
    saveTemplate(name.trim(), { type, target, options: opts, routing });
    setTemplates(loadTemplates());
    toast.success(t("create.templateSaved"), name.trim());
  }

  function onDeleteTemplate(tpl: SavedTemplate) {
    deleteTemplate(tpl.id);
    setTemplates(loadTemplates());
  }

  const selectedAgentLabels = useMemo(
    () =>
      selectedAgentIds
        .map((id) => {
          const a = activeAgents.find((a) => a.id === id);
          return a ? agentLabel(a) : id.slice(0, 8);
        })
        .slice(0, 3),
    [selectedAgentIds, activeAgents],
  );

  const create = useMutation({
    mutationFn: async () => {
      const base = { type, target, options: opts };
      if (mode === "agents") {
        if (selectedAgentIds.length === 1) {
          return tasksApi.createTask({ ...base, agent_id: selectedAgentIds[0] });
        }
        return tasksApi.createTask({ ...base, agent_ids: selectedAgentIds });
      }
      return tasksApi.createTask({ ...base, tags: tagsList, agents_per_tag: agentsPerTag });
    },
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      pushRecentTarget(target);
      if (resp.tasks.length === 1) {
        toast.success(t("create.toastCreated"));
        navigate(`/tasks/${resp.tasks[0].id}`);
      } else {
        toast.success(t("create.toastCreatedMany", { n: resp.tasks.length }));
        navigate(`/groups/${resp.group_id}`);
      }
      onClose();
    },
    onError: (err) => {
      toast.error(
        t("create.toastFailed"),
        err instanceof Error ? err.message : String(err),
      );
    },
  });

  // Reset internal state on (re)open.
  useEffect(() => {
    if (open) setTouchedTarget(false);
  }, [open]);

  if (!open) return null;

  function onChangeType(t: TaskType) {
    setType(t);
    setOpts({});
    if (t === "dns" && (!target || /^\d/.test(target))) setTarget("cloudflare.com");
    if (t === "http_check" && !target.startsWith("http")) setTarget("https://cloudflare.com");
  }

  function toggleAgent(id: string, checked: boolean) {
    setSelectedAgentIds((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouchedTarget(true);
    if (!targetValidation.ok) return;
    create.mutate();
  }

  function copyPreview() {
    const cmd = previewCommand(type, target, opts);
    navigator.clipboard?.writeText(cmd).then(
      () => toast.success(t("create.previewCopied")),
      () => undefined,
    );
  }

  const canSubmit =
    targetValidation.ok &&
    (mode === "agents" ? selectedAgentIds.length > 0 : tagsList.length > 0);

  const command = previewCommand(type, target, opts);
  const where =
    mode === "agents"
      ? selectedAgentIds.length > 0
        ? t("create.runOnAgents", {
            agents:
              selectedAgentLabels.join(", ") +
              (selectedAgentIds.length > 3 ? ` +${selectedAgentIds.length - 3}` : ""),
          })
        : t("create.noAgentsSelected")
      : tagsList.length > 0
      ? t("create.runOnTags", { tags: tagsList.join(", "), n: agentsPerTag })
      : t("create.noTagsSelected");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-task-title"
    >
      <form
        onSubmit={onSubmit}
        className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <header className="flex items-center justify-between">
          <h2 id="create-task-title" className="text-lg font-semibold text-slate-100">
            {t("create.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded text-slate-500 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            aria-label={t("create.close")}
          >
            ×
          </button>
        </header>

        {templates.length > 0 && (
          <div className="-mt-1 flex flex-wrap items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("create.templates")}:
            </span>
            {templates.slice(0, 8).map((tpl) => (
              <span key={tpl.id} className="inline-flex items-center">
                <button
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  title={`${tpl.data.type ?? ""} ${tpl.data.target ?? ""}`}
                  className="rounded-l border border-slate-700 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                >
                  {tpl.name}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteTemplate(tpl)}
                  aria-label={t("common.delete")}
                  title={t("common.delete")}
                  className="rounded-r border border-l-0 border-slate-700 px-1 py-0.5 text-[11px] text-slate-500 hover:bg-slate-800 hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div>
          <span className="text-xs uppercase tracking-wide text-slate-500">{t("create.type")}</span>
          <div
            role="radiogroup"
            aria-label={t("create.type")}
            className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2"
          >
            {TASK_TYPES.map((tt) => {
              const active = type === tt;
              return (
                <button
                  key={tt}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChangeType(tt)}
                  className={`flex items-baseline gap-2 rounded border px-3 py-1.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                    active
                      ? "border-slate-100 bg-slate-100 text-slate-900"
                      : "border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  <span className="shrink-0 font-mono text-sm">{tt}</span>
                  <span
                    className={`min-w-0 truncate text-[10px] leading-tight ${
                      active ? "text-slate-600" : "text-slate-500"
                    }`}
                    title={t(TYPE_DESC_KEY[tt])}
                  >
                    {t(TYPE_DESC_KEY[tt])}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <TargetField
          target={target}
          setTarget={setTarget}
          onBlur={() => setTouchedTarget(true)}
          placeholder={TARGET_HINT[type]}
          error={targetError}
          recents={recents}
        />

        <RoutingPicker
          mode={mode}
          setMode={setMode}
          activeAgents={activeAgents}
          selectedAgentIds={selectedAgentIds}
          toggleAgent={toggleAgent}
          tagsInput={tagsInput}
          setTagsInput={setTagsInput}
          agentsPerTag={agentsPerTag}
          setAgentsPerTag={setAgentsPerTag}
          taskType={type}
        />

        <div className="border-t border-slate-800 pt-3">
          <TypeFields type={type} opts={opts} setOpts={setOpts} />
        </div>

        <PreviewPanel command={command} where={where} onCopy={copyPreview} />

        {create.error && (
          <p role="alert" className="rounded bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {create.error instanceof Error ? create.error.message : String(create.error)}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onSaveTemplate}
            disabled={!canSubmit}
            className="mr-auto rounded border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:bg-slate-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            title={t("create.saveTemplateHint")}
          >
            ★ {t("create.saveTemplate")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={create.isPending || !canSubmit}
            className="rounded bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {create.isPending ? t("common.creating") : t("common.create")}
          </button>
        </div>
      </form>
    </div>
  );
}

function TargetField({
  target,
  setTarget,
  onBlur,
  placeholder,
  error,
  recents,
}: {
  target: string;
  setTarget: (v: string) => void;
  onBlur: () => void;
  placeholder: string;
  error: string | null;
  recents: string[];
}) {
  const { t } = useT();
  return (
    <div>
      <label className="block">
        <span className="text-xs uppercase tracking-wide text-slate-500">
          {t("create.target")}
        </span>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          list="lg-recent-targets"
          aria-invalid={!!error}
          aria-describedby={error ? "target-error" : undefined}
          className={`mt-1 block w-full rounded border bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:outline-none focus-visible:ring-2 ${
            error
              ? "border-red-700 focus-visible:ring-red-500"
              : "border-slate-700 focus:border-slate-500 focus-visible:ring-slate-500"
          }`}
          required
        />
      </label>
      {recents.length > 0 && (
        <datalist id="lg-recent-targets">
          {recents.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      )}
      {error && (
        <p id="target-error" role="alert" className="mt-1 text-xs text-red-400">
          {t("create.targetInvalid", { reason: error })}
        </p>
      )}
      {recents.length > 0 && !error && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide text-slate-600">
            {t("create.recent")}:
          </span>
          {recents.slice(0, 5).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setTarget(r)}
              className="rounded border border-slate-700 px-2 py-0.5 text-[11px] font-mono text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
