import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TargetSeries } from "../api/targets";

type Props = {
  series: TargetSeries;
  height?: number;
};

// Stable distinct colours for up to ~12 lines. Picked for dark bg readability.
const PALETTE = [
  "#34d399", // emerald
  "#60a5fa", // blue
  "#fbbf24", // amber
  "#f87171", // red
  "#a78bfa", // violet
  "#f472b6", // pink
  "#22d3ee", // cyan
  "#84cc16", // lime
  "#fb923c", // orange
  "#c084fc", // purple
  "#2dd4bf", // teal
  "#fde047", // yellow
];

function colourFor(idx: number): string {
  return PALETTE[idx % PALETTE.length];
}

/**
 * Renders a multi-line time series with one line per agent. Y axis is RTT (ms).
 * Missing buckets show up as gaps because we leave the value undefined for
 * those (rows-on-demand → not every (bucket, agent) pair has a sample).
 */
export default function LatencyTrendChart({ series, height = 280 }: Props) {
  const data = useMemo(() => buildWideRows(series), [series]);

  if (series.agents.length === 0 || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-500">
        No samples in this window.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={fmtTick}
            stroke="#64748b"
            tick={{ fontSize: 10 }}
            scale="time"
          />
          <YAxis
            stroke="#64748b"
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => `${v}`}
            label={{ value: "ms", angle: -90, position: "insideLeft", fill: "#64748b", fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 6,
              fontSize: 11,
            }}
            labelFormatter={(v) => new Date(v as number).toLocaleString()}
            formatter={(value: unknown, key: string) =>
              value === undefined || value === null
                ? ["—", key]
                : [`${(value as number).toFixed(1)} ms`, key]
            }
          />
          {series.agents.map((a, idx) => (
            <Line
              key={a.agent_id}
              type="monotone"
              dataKey={a.agent_label}
              stroke={colourFor(idx)}
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-3 px-2">
        {series.agents.map((a, idx) => (
          <span key={a.agent_id} className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <span
              className="inline-block h-2 w-3 rounded"
              style={{ backgroundColor: colourFor(idx) }}
            />
            <span className="font-mono">{a.agent_label}</span>
            {a.agent_tags.length > 0 && (
              <span className="text-[9px] uppercase tracking-wide text-slate-600">
                {a.agent_tags.join(",")}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

type Row = { ts: number } & Record<string, number | undefined | null>;

function buildWideRows(series: TargetSeries): Row[] {
  // Group points by bucket_start; each bucket becomes one chart row with
  // per-agent columns.
  const byBucket = new Map<number, Row>();
  const labelByAgent = new Map(series.agents.map((a) => [a.agent_id, a.agent_label]));
  for (const p of series.points) {
    const ts = new Date(p.bucket_start).getTime();
    let row = byBucket.get(ts);
    if (!row) {
      row = { ts };
      byBucket.set(ts, row);
    }
    const lbl = labelByAgent.get(p.agent_id) ?? p.agent_id.slice(0, 8);
    row[lbl] = p.rtt_avg_ms;
  }
  return [...byBucket.values()].sort((a, b) => a.ts - b.ts);
}

function fmtTick(v: number): string {
  const d = new Date(v);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
