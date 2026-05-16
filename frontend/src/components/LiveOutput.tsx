import { useEffect, useMemo, useRef, useState } from "react";
import { useTaskStream } from "../hooks/useTaskStream";
import { useNow } from "../hooks/useNow";
import { useT } from "../i18n";
import { useToast } from "./Toast";

type Props = {
  taskId: string;
  enabled: boolean;
};

type Filter = "all" | "stdout" | "stderr";

export default function LiveOutput({ taskId, enabled }: Props) {
  const stream = useTaskStream(taskId, enabled);
  const { t } = useT();
  const toast = useToast();
  const preRef = useRef<HTMLPreElement>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [followTail, setFollowTail] = useState(true);
  // Tick once per second while a reconnect countdown is active.
  const now = useNow(stream.reconnecting ? 1000 : 30_000);
  const reconnectInSec = stream.reconnecting
    ? Math.max(0, Math.ceil((stream.retryAt - now) / 1000))
    : 0;

  // Drop structured event chunks — they're rendered by LiveMTRTable/LiveTaskChart.
  const textLines = useMemo(
    () => stream.lines.filter((l) => l.stream !== "event"),
    [stream.lines],
  );

  const visibleLines = useMemo(() => {
    if (filter === "all") return textLines;
    return textLines.filter((l) => l.stream === filter);
  }, [textLines, filter]);

  // Auto-scroll only if the user wants to follow.
  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    if (followTail) el.scrollTop = el.scrollHeight;
  }, [visibleLines.length, followTail]);

  function onScroll() {
    const el = preRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
    if (atBottom && !followTail) setFollowTail(true);
    if (!atBottom && followTail) setFollowTail(false);
  }

  function copyAll() {
    const text = textLines.map((l) => l.text).join("\n");
    navigator.clipboard?.writeText(text).then(
      () => toast.success(t("task.copied")),
      () => undefined,
    );
  }

  // Hide the section entirely until we have something to show.
  if (textLines.length === 0 && !stream.connected && !stream.error && !stream.reconnecting) {
    return null;
  }

  // "lost" means: we've exhausted reconnects (error set, not currently retrying)
  // and the task isn't terminal — i.e. the user really lost connectivity.
  const streamLost = !!stream.error && !stream.reconnecting && !stream.done && enabled;

  return (
    <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xs uppercase tracking-wide text-slate-500">
            {t("live.output")}
          </h2>
          <FilterTabs filter={filter} onChange={setFilter} />
        </div>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide">
          <label className="flex items-center gap-1 text-slate-400">
            <input
              type="checkbox"
              checked={followTail}
              onChange={(e) => {
                setFollowTail(e.target.checked);
                if (e.target.checked) {
                  preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
                }
              }}
              className="h-3 w-3 rounded border-slate-700 bg-slate-950"
            />
            {t("live.followTail")}
          </label>
          <button
            type="button"
            onClick={copyAll}
            disabled={textLines.length === 0}
            className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:bg-slate-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            {t("live.copyOutput")}
          </button>
          {streamLost ? (
            <span className="flex items-center gap-1 text-red-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
              {t("live.streamLost")}
            </span>
          ) : stream.reconnecting ? (
            <span className="flex items-center gap-1 text-amber-300">
              <span className="inline-block h-1.5 w-1.5 motion-safe:animate-pulse rounded-full bg-amber-400" />
              {t("live.reconnectingIn", { sec: reconnectInSec })}
            </span>
          ) : !stream.done && stream.connected ? (
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="inline-block h-1.5 w-1.5 motion-safe:animate-pulse rounded-full bg-emerald-400" />
              {t("live.streaming")}
            </span>
          ) : stream.done ? (
            <span className="text-slate-500">{t("live.done")}</span>
          ) : null}
        </div>
      </header>
      {(streamLost || stream.reconnecting) && (
        <div
          role="alert"
          className={`flex items-center justify-between gap-3 border-b px-6 py-2 text-xs ${
            streamLost
              ? "border-red-900/60 bg-red-950/40 text-red-300"
              : "border-amber-900/60 bg-amber-950/30 text-amber-200"
          }`}
        >
          <span>
            {streamLost
              ? stream.error
              : t("live.reconnectingMsg", { sec: reconnectInSec, attempt: stream.attempts })}
          </span>
          <button
            type="button"
            onClick={stream.retryNow}
            className="rounded border border-current/40 px-2 py-0.5 text-[10px] uppercase tracking-wide hover:bg-current/10"
          >
            {t("live.retryNow")}
          </button>
        </div>
      )}
      <pre
        ref={preRef}
        onScroll={onScroll}
        className="max-h-96 overflow-y-auto px-6 py-4 font-mono text-xs leading-relaxed text-slate-300"
      >
        {visibleLines.map((l, i) => (
          <div key={i} className={l.stream === "stderr" ? "text-red-300" : undefined}>
            {l.text || " "}
          </div>
        ))}
      </pre>
    </section>
  );
}

function FilterTabs({ filter, onChange }: { filter: Filter; onChange: (f: Filter) => void }) {
  const { t } = useT();
  const opts: { v: Filter; label: string }[] = [
    { v: "all", label: t("live.filterAll") },
    { v: "stdout", label: t("live.filterStdout") },
    { v: "stderr", label: t("live.filterStderr") },
  ];
  return (
    <div role="tablist" className="inline-flex overflow-hidden rounded border border-slate-700">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="tab"
          aria-selected={filter === o.v}
          onClick={() => onChange(o.v)}
          className={`px-2 py-0.5 text-[10px] uppercase tracking-wide transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
            filter === o.v
              ? "bg-slate-800 text-slate-100"
              : "text-slate-400 hover:bg-slate-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
