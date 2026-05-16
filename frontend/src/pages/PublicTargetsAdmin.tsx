import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import * as publicApi from "../api/publicStatus";
import type { PublicTarget } from "../api/publicStatus";
import { useConfirm } from "../components/ConfirmDialog";
import NavBar from "../components/NavBar";
import { SkeletonList } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { useT } from "../i18n";

export default function PublicTargetsAdmin() {
  const { t } = useT();
  const toast = useToast();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["public-targets"],
    queryFn: publicApi.listPublicTargets,
  });

  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");
  const [sortOrder, setSortOrder] = useState(0);

  const add = useMutation({
    mutationFn: () =>
      publicApi.addPublicTarget({
        target: target.trim(),
        label: label.trim() || null,
        sort_order: sortOrder,
      }),
    onSuccess: () => {
      toast.success(t("publicAdmin.added"), target);
      setTarget("");
      setLabel("");
      setSortOrder(0);
      qc.invalidateQueries({ queryKey: ["public-targets"] });
    },
    onError: (err) =>
      toast.error(t("publicAdmin.add"), err instanceof Error ? err.message : String(err)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-4xl px-6 py-6">
        <h1 className="mb-1 text-2xl font-semibold text-slate-100">{t("publicAdmin.title")}</h1>
        <p className="mb-4 text-xs text-slate-500">{t("publicAdmin.subtitle")}</p>

        <form
          onSubmit={onSubmit}
          className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-slate-800 bg-slate-900 p-4 sm:grid-cols-12"
        >
          <label className="sm:col-span-5">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("publicAdmin.target")}
            </span>
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="cloudflare.com"
              required
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
          <label className="sm:col-span-5">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("publicAdmin.label")}
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("publicAdmin.labelPlaceholder")}
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("publicAdmin.sort")}
            </span>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
          <div className="sm:col-span-12 flex items-end justify-end">
            <button
              type="submit"
              disabled={add.isPending || !target.trim()}
              className="rounded bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              {add.isPending ? t("common.creating") : t("publicAdmin.add")}
            </button>
          </div>
        </form>

        <section className="rounded-lg border border-slate-800 bg-slate-900">
          {q.isLoading && <SkeletonList rows={3} />}
          {q.isError && (
            <p role="alert" className="px-6 py-4 text-sm text-red-400">
              {q.error instanceof Error ? q.error.message : t("common.failedToLoad")}
            </p>
          )}
          {q.data && q.data.length === 0 && (
            <p className="px-6 py-6 text-sm text-slate-500">{t("publicAdmin.empty")}</p>
          )}
          {q.data && q.data.length > 0 && (
            <ul className="divide-y divide-slate-800">
              {q.data.map((pt) => (
                <PublicTargetRow
                  key={pt.id}
                  pt={pt}
                  onChange={() => qc.invalidateQueries({ queryKey: ["public-targets"] })}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function PublicTargetRow({
  pt,
  onChange,
}: {
  pt: PublicTarget;
  onChange: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(pt.label ?? "");
  const [sortOrder, setSortOrder] = useState(pt.sort_order);

  const save = useMutation({
    mutationFn: () =>
      publicApi.updatePublicTarget(pt.id, {
        label: label.trim() || null,
        sort_order: sortOrder,
      }),
    onSuccess: () => {
      toast.success(t("publicAdmin.saved"), pt.target);
      setEditing(false);
      onChange();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const remove = useMutation({
    mutationFn: () => publicApi.deletePublicTarget(pt.id),
    onSuccess: () => {
      toast.info(t("publicAdmin.removed"), pt.target);
      onChange();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const badgeUrl = `${window.location.origin}/api/public/badge.svg?target=${encodeURIComponent(pt.target)}&style=combined`;

  return (
    <li className="px-6 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm text-slate-100">{pt.target}</p>
          {pt.label && <p className="text-xs text-slate-400">{pt.label}</p>}
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-600">
            sort: {pt.sort_order} · {new Date(pt.created_at).toLocaleDateString()}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <img src={badgeUrl} alt="status badge" className="h-5" />
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(badgeUrl).then(
                  () => toast.success(t("publicAdmin.badgeCopied")),
                  () => undefined,
                );
              }}
              className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              {t("publicAdmin.copyBadgeUrl")}
            </button>
            <button
              type="button"
              onClick={() => {
                const md = `[![${pt.label ?? pt.target}](${badgeUrl})](${window.location.origin}/status)`;
                navigator.clipboard?.writeText(md).then(
                  () => toast.success(t("publicAdmin.badgeCopied")),
                  () => undefined,
                );
              }}
              className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              {t("publicAdmin.copyMd")}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          {!editing ? (
            <>
              <button
                onClick={() => setEditing(true)}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              >
                {t("common.edit")}
              </button>
              <button
                onClick={async () => {
                  const ok = await confirm({
                    title: t("publicAdmin.confirmDelete", { name: pt.target }),
                    danger: true,
                    confirmLabel: t("common.delete"),
                  });
                  if (ok) remove.mutate();
                }}
                disabled={remove.isPending}
                className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              >
                {t("common.delete")}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(false)}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-900 hover:bg-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                {save.isPending ? "…" : t("common.save")}
              </button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-12">
          <label className="sm:col-span-8">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("publicAdmin.label")}
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("publicAdmin.labelPlaceholder")}
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
          <label className="sm:col-span-4">
            <span className="text-[10px] uppercase tracking-wide text-slate-500">
              {t("publicAdmin.sort")}
            </span>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
        </div>
      )}
    </li>
  );
}
