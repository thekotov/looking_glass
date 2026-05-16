import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as targetsApi from "../api/targets";
import NavBar from "../components/NavBar";
import { PinButton } from "../components/PinButton";
import { SkeletonRows } from "../components/Skeleton";
import { useT } from "../i18n";
import { usePins } from "../lib/pins";

const WINDOWS: { v: string; label: string }[] = [
  { v: "24h", label: "24h" },
  { v: "7d", label: "7d" },
  { v: "30d", label: "30d" },
];

export default function Targets() {
  const { t } = useT();
  const [since, setSince] = useState("7d");
  const [filter, setFilter] = useState("");

  const q = useQuery({
    queryKey: ["targets", since],
    queryFn: () => targetsApi.listTargets(since),
    refetchInterval: 30_000,
  });

  const pinned = usePins("targets");
  const pinSet = useMemo(() => new Set(pinned), [pinned]);

  const items = useMemo(() => {
    const data = q.data ?? [];
    const needle = filter.trim().toLowerCase();
    const matched = !needle ? data : data.filter((t) => t.target.toLowerCase().includes(needle));
    // Pinned-first ordering preserves the original task_count/recency ordering
    // *within* each group.
    return [...matched].sort((a, b) => {
      const ap = pinSet.has(a.target) ? 0 : 1;
      const bp = pinSet.has(b.target) ? 0 : 1;
      return ap - bp;
    });
  }, [q.data, filter, pinSet]);

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-slate-100">{t("targets.title")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("targets.search")}
              aria-label={t("targets.search")}
              className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
            <div className="inline-flex overflow-hidden rounded border border-slate-700">
              {WINDOWS.map((w) => (
                <button
                  key={w.v}
                  type="button"
                  onClick={() => setSince(w.v)}
                  className={`px-3 py-1.5 text-xs uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                    since === w.v
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="mb-3 text-xs text-slate-500">{t("targets.hint")}</p>

        <section className="rounded-lg border border-slate-800 bg-slate-900">
          {q.isLoading && <SkeletonRows rows={5} cols={5} />}
          {q.isError && (
            <p role="alert" className="px-6 py-4 text-sm text-red-400">
              {q.error instanceof Error ? q.error.message : t("common.failedToLoad")}
            </p>
          )}
          {q.data && items.length === 0 && (
            <p className="px-6 py-4 text-sm text-slate-500">{t("targets.empty")}</p>
          )}
          {q.data && items.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 font-medium">{t("targets.thTarget")}</th>
                  <th className="px-6 py-3 font-medium">{t("targets.thTypes")}</th>
                  <th className="px-6 py-3 font-medium">{t("targets.thAgents")}</th>
                  <th className="px-6 py-3 font-medium">{t("targets.thTasks")}</th>
                  <th className="px-6 py-3 font-medium">{t("targets.thLastSeen")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {items.map((row) => (
                  <tr key={row.target} className="hover:bg-slate-900/50">
                    <td className="px-6 py-3 font-mono text-sm">
                      <span className="inline-flex items-center gap-2">
                        <PinButton scope="targets" id={row.target} />
                        <Link
                          to={`/targets/${encodeURIComponent(row.target)}`}
                          className="text-slate-100 underline-offset-2 hover:underline"
                        >
                          {row.target}
                        </Link>
                      </span>
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-slate-400">
                      {row.types.join(", ")}
                    </td>
                    <td className="px-6 py-3 text-slate-300">{row.distinct_agents}</td>
                    <td className="px-6 py-3 text-slate-300 tabular-nums">{row.task_count}</td>
                    <td className="px-6 py-3 text-xs text-slate-400">
                      {new Date(row.last_seen).toLocaleString()}
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
