// Live hop table built incrementally from mtr_hop / mtr_probe / mtr_dns events
// streamed by the agent. The agent runs `mtr --raw` and forwards each event
// as a stream="event" chunk with a JSON payload (see agent/internal/tasks/mtr.go).

import { useMemo } from "react";
import { useTaskStream, type StreamKind } from "../hooks/useTaskStream";
import { useT } from "../i18n";
import { LatencyBar } from "./results/common";

type Props = {
  taskId: string;
  taskType: string;
  enabled: boolean;
};

type MTREvent =
  | { type: "mtr_hop"; hop: number; ip: string }
  | { type: "mtr_probe"; hop: number; rtt_ms: number }
  | { type: "mtr_dns"; hop: number; host: string };

type HopRow = {
  hop: number;
  ip: string;
  dns: string;
  rtts: number[];
};

export default function LiveMTRTable({ taskId, taskType, enabled }: Props) {
  const { t } = useT();
  const active = taskType === "mtr" || taskType === "mtr_tcp";
  const stream = useTaskStream(taskId, enabled && active);

  const hops = useMemo(() => buildHops(stream.lines), [stream.lines]);

  if (!active) return null;
  if (hops.length === 0 && !stream.connected) return null;

  const maxAvg = hops.reduce(
    (m, h) => Math.max(m, h.rtts.length > 0 ? avg(h.rtts) : 0),
    1,
  );

  return (
    <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <h2 className="text-xs uppercase tracking-wide text-slate-500">{t("live.hops")}</h2>
        <span className="text-[10px] text-slate-500">
          {t("live.hopsCount", { n: hops.length, state: stream.done ? t("live.done") : t("live.running") })}
        </span>
      </header>
      <div className="px-6 py-3">
        {hops.length === 0 ? (
          <p className="text-sm text-slate-500">{t("live.waitFirstProbe")}</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="pb-1 pr-3 font-medium">#</th>
                <th className="pb-1 pr-3 font-medium">{t("live.thHost")}</th>
                <th className="pb-1 pr-3 font-medium">{t("live.thProbes")}</th>
                <th className="pb-1 pr-3 font-medium">{t("live.thBest")}</th>
                <th className="pb-1 pr-3 font-medium">{t("live.thAvg")}</th>
                <th className="pb-1 pr-3 font-medium">{t("live.thWorst")}</th>
                <th className="pb-1 pr-0 font-medium">{t("live.thLatency")}</th>
              </tr>
            </thead>
            <tbody>
              {hops.map((h) => {
                const a = h.rtts.length > 0 ? avg(h.rtts) : 0;
                const tone =
                  a < 50 ? "emerald" : a < 150 ? "blue" : a < 300 ? "amber" : "red";
                return (
                  <tr key={h.hop} className="border-t border-slate-800">
                    <td className="py-1 pr-3 font-mono text-slate-500">{h.hop + 1}</td>
                    <td className="py-1 pr-3 font-mono text-slate-200">
                      {h.dns || h.ip || (
                        <span className="text-slate-600">{t("live.discovering")}</span>
                      )}
                    </td>
                    <td className="py-1 pr-3 font-mono text-slate-400">{h.rtts.length}</td>
                    <td className="py-1 pr-3 font-mono text-slate-400">
                      {h.rtts.length > 0 ? Math.min(...h.rtts).toFixed(2) : "—"}
                    </td>
                    <td className="py-1 pr-3 font-mono text-slate-300">
                      {h.rtts.length > 0 ? a.toFixed(2) : "—"}
                    </td>
                    <td className="py-1 pr-3 font-mono text-slate-400">
                      {h.rtts.length > 0 ? Math.max(...h.rtts).toFixed(2) : "—"}
                    </td>
                    <td className="py-1 pr-0 w-1/3">
                      {a > 0 && <LatencyBar value={a} max={maxAvg} tone={tone} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function buildHops(
  lines: { text: string; stream: StreamKind; seq: number }[],
): HopRow[] {
  const map = new Map<number, HopRow>();
  for (const l of lines) {
    if (l.stream !== "event") continue;
    let ev: MTREvent;
    try {
      ev = JSON.parse(l.text) as MTREvent;
    } catch {
      continue;
    }
    let row = map.get(ev.hop);
    if (!row) {
      row = { hop: ev.hop, ip: "", dns: "", rtts: [] };
      map.set(ev.hop, row);
    }
    switch (ev.type) {
      case "mtr_hop":
        row.ip = ev.ip;
        break;
      case "mtr_dns":
        row.dns = ev.host;
        break;
      case "mtr_probe":
        row.rtts.push(ev.rtt_ms);
        break;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.hop - b.hop);
}
