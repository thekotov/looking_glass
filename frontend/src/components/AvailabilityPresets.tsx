import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as availabilityApi from "../api/availability";
import type { AvailabilityPreset } from "../api/availability";
import { useConfirm } from "./ConfirmDialog";
import { SkeletonList } from "./Skeleton";
import { useToast } from "./Toast";
import { useT } from "../i18n";

type Props = {
  canEdit: boolean;
  /** Called when the user clicks "Apply" on a preset row — fills the form. */
  onApply?: (preset: AvailabilityPreset) => void;
};

/**
 * The saved-availability-presets section on /availability.
 *
 * Row actions:
 *   - Run: fires a fresh availability check using the preset's params and
 *          navigates straight to the resulting matrix.
 *   - Open: jumps to the most recent matrix (no new run).
 *   - Apply: pours the preset's params back into the form so the user can
 *            tweak before running.
 *   - Delete: removes the preset.
 */
export default function AvailabilityPresets({ canEdit, onApply }: Props) {
  const { t } = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ["availability-presets"],
    queryFn: availabilityApi.listPresets,
    refetchInterval: 15_000,
  });

  const run = useMutation({
    mutationFn: (id: string) => availabilityApi.runPreset(id),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ["availability-presets"] });
      toast.success(t("avail.presetRunSuccess"), `${resp.task_count} tasks`);
      navigate(`/availability/${resp.group_id}`, {
        state: { skipped: resp.skipped, taskCount: resp.task_count },
      });
    },
    onError: (e) =>
      toast.error(t("avail.presetRunFailed"), e instanceof Error ? e.message : String(e)),
  });

  const del = useMutation({
    mutationFn: (id: string) => availabilityApi.deletePreset(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["availability-presets"] });
      toast.info(t("avail.presetDeleted"));
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : String(e)),
  });

  async function onDelete(p: AvailabilityPreset) {
    const ok = await confirm({
      title: t("avail.presetConfirmDelete", { name: p.name }),
      danger: true,
      confirmLabel: t("common.delete"),
    });
    if (ok) del.mutate(p.id);
  }

  if (q.isLoading) {
    return (
      <section className="rounded-lg border border-slate-800 bg-slate-900">
        <SkeletonList rows={2} />
      </section>
    );
  }
  if (q.isError) {
    return (
      <p role="alert" className="rounded border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">
        {q.error instanceof Error ? q.error.message : t("common.failedToLoad")}
      </p>
    );
  }
  if (!q.data || q.data.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-4 py-3 text-xs text-slate-500">
        {t("avail.presetsEmptyHint")}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900">
      <header className="border-b border-slate-800 px-4 py-2 text-[10px] uppercase tracking-wide text-slate-500">
        {t("avail.savedPresets")} · {q.data.length}
      </header>
      <ul className="divide-y divide-slate-800">
        {q.data.map((p) => (
          <PresetRow
            key={p.id}
            preset={p}
            canEdit={canEdit}
            running={run.isPending}
            onRun={() => run.mutate(p.id)}
            onDelete={() => onDelete(p)}
            onApply={onApply ? () => onApply(p) : undefined}
          />
        ))}
      </ul>
    </section>
  );
}

function PresetRow({
  preset,
  canEdit,
  running,
  onRun,
  onDelete,
  onApply,
}: {
  preset: AvailabilityPreset;
  canEdit: boolean;
  running: boolean;
  onRun: () => void;
  onDelete: () => void;
  onApply?: () => void;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const summaryBits: string[] = [];
  summaryBits.push(t("avail.presetTargetsCount", { n: preset.targets.length }));
  const types: string[] = [];
  if (preset.check_icmp) types.push("ICMP");
  if (preset.check_tcp) types.push(`TCP:${preset.tcp_port}`);
  summaryBits.push(types.join(" + "));
  summaryBits.push(
    preset.agent_ids.length === 0
      ? t("avail.presetAllAgents")
      : t("avail.presetNAgents", { n: preset.agent_ids.length }),
  );

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className="inline-flex items-center gap-2 text-left"
          >
            <span
              className={`text-slate-500 transition-transform ${expanded ? "rotate-90" : ""}`}
              aria-hidden="true"
            >
              ▶
            </span>
            <span className="font-mono text-sm text-slate-100">{preset.name}</span>
          </button>
          <p className="mt-1 text-[11px] text-slate-500">{summaryBits.join(" · ")}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-600">
            {preset.last_run_at
              ? t("avail.presetLastRun", {
                  when: new Date(preset.last_run_at).toLocaleString(),
                })
              : t("avail.presetNeverRun")}
            {" · "}
            {t("avail.presetRunsTotal", { n: preset.runs_total })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {preset.last_run_group_id && (
            <Link
              to={`/availability/${preset.last_run_group_id}`}
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              {t("avail.presetOpen")}
            </Link>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={onRun}
              disabled={running}
              className="rounded bg-slate-100 px-3 py-1 text-xs font-medium text-slate-900 hover:bg-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              ↻ {t("avail.presetRun")}
            </button>
          )}
          {canEdit && onApply && (
            <button
              type="button"
              onClick={onApply}
              className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              {t("avail.presetApply")}
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={onDelete}
              aria-label={t("common.delete")}
              className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <ul className="mt-2 max-h-40 list-none overflow-y-auto rounded border border-slate-800 bg-slate-950/50 px-3 py-2 font-mono text-[11px] text-slate-300">
          {preset.targets.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
