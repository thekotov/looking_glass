import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as agentsApi from "../api/agents";
import { agentLabel } from "../api/agents";
import * as availabilityApi from "../api/availability";
import type { AvailabilityPreset, CheckType } from "../api/availability";
import { ApiError } from "../api/client";
import AvailabilityPresets from "../components/AvailabilityPresets";
import NavBar from "../components/NavBar";
import { useToast } from "../components/Toast";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../i18n";

const STORAGE_KEY = "lg.availability.lastForm";

type StoredForm = {
  targetsText: string;
  icmp: boolean;
  tcp: boolean;
  tcpPort: number;
  timeoutSec: number;
  pingCount: number;
  selectedAgentIds: string[];
  allAgents: boolean;
};

function loadStored(): Partial<StoredForm> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Availability() {
  const { user } = useAuth();
  const { t } = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const canRun = user && (user.role === "operator" || user.role === "admin");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [presetName, setPresetName] = useState("");

  const agentsQ = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.listAgents,
  });
  const activeAgents = useMemo(
    () => (agentsQ.data ?? []).filter((a) => a.status === "active"),
    [agentsQ.data],
  );

  const stored = useMemo(() => loadStored(), []);
  const prefilled = searchParams.get("repeat") === "1";

  const [targetsText, setTargetsText] = useState<string>(
    prefilled && stored?.targetsText ? stored.targetsText : "1.1.1.1\n8.8.8.8\ncloudflare.com",
  );
  const [icmp, setIcmp] = useState<boolean>(prefilled ? stored?.icmp ?? true : true);
  const [tcp, setTcp] = useState<boolean>(prefilled ? stored?.tcp ?? true : true);
  const [tcpPort, setTcpPort] = useState<number>(prefilled ? stored?.tcpPort ?? 443 : 443);
  const [timeoutSec, setTimeoutSec] = useState<number>(
    prefilled ? stored?.timeoutSec ?? 5 : 5,
  );
  const [pingCount, setPingCount] = useState<number>(
    prefilled ? stored?.pingCount ?? 4 : 4,
  );
  const [allAgents, setAllAgents] = useState<boolean>(
    prefilled ? stored?.allAgents ?? true : true,
  );
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(
    prefilled ? stored?.selectedAgentIds ?? [] : [],
  );

  // Default agent selection: when "all" is on, mirror activeAgents.
  useEffect(() => {
    if (allAgents && activeAgents.length > 0) {
      setSelectedAgentIds(activeAgents.map((a) => a.id));
    }
  }, [allAgents, activeAgents]);

  const create = useMutation({
    mutationFn: () => {
      const targets = targetsText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const check_types: CheckType[] = [];
      if (icmp) check_types.push("icmp");
      if (tcp) check_types.push("tcp");
      return availabilityApi.createAvailabilityCheck({
        targets,
        check_types,
        tcp_port: tcpPort,
        timeout_sec: timeoutSec,
        ping_count: pingCount,
        agent_ids: allAgents ? undefined : selectedAgentIds,
      });
    },
    onSuccess: (resp) => {
      // Persist form for "repeat" use from matrix page.
      const toStore: StoredForm = {
        targetsText,
        icmp,
        tcp,
        tcpPort,
        timeoutSec,
        pingCount,
        selectedAgentIds,
        allAgents,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      } catch {
        // ignore storage failures
      }
      toast.success(t("create.toastCreatedMany", { n: resp.task_count }));
      navigate(`/availability/${resp.group_id}`, {
        state: { skipped: resp.skipped, taskCount: resp.task_count },
      });
    },
    onError: (err) =>
      toast.error(
        t("create.toastFailed"),
        err instanceof Error ? err.message : String(err),
      ),
  });

  function toggleAgent(id: string, checked: boolean) {
    setAllAgents(false);
    setSelectedAgentIds((prev) =>
      checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id),
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  function applyPreset(p: AvailabilityPreset) {
    setTargetsText(p.targets.join("\n"));
    setIcmp(p.check_icmp);
    setTcp(p.check_tcp);
    setTcpPort(p.tcp_port);
    setTimeoutSec(p.timeout_sec);
    setPingCount(p.ping_count);
    if (p.agent_ids.length === 0) {
      setAllAgents(true);
    } else {
      setAllAgents(false);
      setSelectedAgentIds(p.agent_ids);
    }
    setPresetName(p.name);
    toast.info(t("avail.presetApplied"), p.name);
  }

  const savePreset = useMutation({
    mutationFn: () => {
      const targets = targetsText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const name = presetName.trim() || defaultPresetName(targets);
      return availabilityApi.createPreset({
        name,
        targets,
        check_icmp: icmp,
        check_tcp: tcp,
        tcp_port: tcpPort,
        timeout_sec: timeoutSec,
        ping_count: pingCount,
        agent_ids: allAgents ? [] : selectedAgentIds,
      });
    },
    onSuccess: (p) => {
      toast.success(t("avail.presetSaved"), p.name);
      qc.invalidateQueries({ queryKey: ["availability-presets"] });
    },
    onError: (e) =>
      toast.error(t("avail.presetSaveFailed"), e instanceof Error ? e.message : String(e)),
  });

  const targetLines = targetsText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const checkTypeCount = (icmp ? 1 : 0) + (tcp ? 1 : 0);
  const agentCount = allAgents ? activeAgents.length : selectedAgentIds.length;
  const taskCount = targetLines.length * checkTypeCount * agentCount;

  const validationError =
    targetLines.length === 0
      ? t("availForm.errEmpty")
      : targetLines.length > 50
      ? t("availForm.errTooMany", { n: targetLines.length })
      : checkTypeCount === 0
      ? t("availForm.errNoChecks")
      : agentCount === 0
      ? t("availForm.errNoAgents")
      : taskCount > 400
      ? t("availForm.errBatchSize", { n: taskCount })
      : null;

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-100">{t("availForm.title")}</h1>
          <span className="text-xs text-slate-500">{t("availForm.hint")}</span>
        </div>

        {!canRun && (
          <p className="mb-4 rounded border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-300">
            {t("availForm.readonly")}
          </p>
        )}

        <div className="mb-4">
          <AvailabilityPresets canEdit={!!canRun} onApply={applyPreset} />
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-6"
        >
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              {t("availForm.targets")}
            </span>
            <textarea
              value={targetsText}
              onChange={(e) => setTargetsText(e.target.value)}
              rows={6}
              placeholder={"1.1.1.1\n8.8.8.8\nexample.com"}
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              required
            />
            <span className="mt-1 block text-[10px] text-slate-500">
              {t("availForm.targetsHint")}
            </span>
          </label>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={icmp}
                onChange={(e) => setIcmp(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950"
              />
              <span className="text-sm text-slate-200">ICMP (ping)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={tcp}
                onChange={(e) => setTcp(e.target.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-950"
              />
              <span className="text-sm text-slate-200">TCP</span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-500">
                {t("availForm.tcpPort")}
              </span>
              <input
                type="number"
                min={1}
                max={65535}
                value={tcpPort}
                onChange={(e) => setTcpPort(Number(e.target.value))}
                disabled={!tcp}
                className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 disabled:opacity-50 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-500">
                {t("availForm.timeout")}
              </span>
              <input
                type="number"
                min={1}
                max={30}
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(Number(e.target.value))}
                className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-slate-500">
                {t("availForm.pingCount")}
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={pingCount}
                onChange={(e) => setPingCount(Number(e.target.value))}
                disabled={!icmp}
                className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 disabled:opacity-50 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-500">
                {t("availForm.agents")}
              </span>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={allAgents}
                  onChange={(e) => setAllAgents(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950"
                />
                {t("availForm.allActive")}
              </label>
            </div>
            <div className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded border border-slate-800 bg-slate-950 p-2">
              {activeAgents.length === 0 && (
                <p className="text-xs text-amber-400">{t("availForm.noActiveAgents")}</p>
              )}
              {activeAgents.map((a) => {
                const checked = allAgents || selectedAgentIds.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-900"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleAgent(a.id, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-950"
                    />
                    <span className="text-sm text-slate-200" title={a.display_name ? `host: ${a.hostname}` : undefined}>
                      {agentLabel(a)}
                    </span>
                    {a.tags.length > 0 && (
                      <span className="text-[10px] uppercase text-slate-500">
                        {a.tags.join(",")}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-400">
            {t("availForm.willCreate", {
              n: taskCount,
              targets: targetLines.length,
              types: checkTypeCount,
              agents: agentCount,
            })}
          </div>

          {validationError && (
            <p role="alert" className="rounded bg-amber-950/50 px-3 py-2 text-sm text-amber-300">
              {validationError}
            </p>
          )}
          {create.error && (
            <p role="alert" className="rounded bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {create.error instanceof ApiError
                ? create.error.message
                : create.error instanceof Error
                ? create.error.message
                : String(create.error)}
            </p>
          )}

          <div className="flex flex-wrap items-end justify-between gap-3 border-t border-slate-800 pt-4">
            <label className="flex-1 min-w-[12rem]">
              <span className="text-[10px] uppercase tracking-wide text-slate-500">
                {t("avail.presetNameLabel")}
              </span>
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={t("avail.presetNamePlaceholder")}
                maxLength={128}
                className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => savePreset.mutate()}
                disabled={!canRun || !!validationError || savePreset.isPending}
                className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savePreset.isPending ? "…" : t("avail.savePreset")}
              </button>
              <button
                type="submit"
                disabled={!canRun || !!validationError || create.isPending}
                className="rounded bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {create.isPending ? t("availForm.submitting") : t("availForm.submit")}
              </button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}

function defaultPresetName(targets: string[]): string {
  const first = targets[0] ?? "untitled";
  const stamp = new Date().toLocaleString();
  return `${first} (${stamp})`;
}
