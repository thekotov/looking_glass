import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, Section } from "./common";

type Reply = { seq: number; rtt_ms: number; ttl: number };

type PingParsed = {
  target?: string;
  resolved_ip?: string;
  transmitted: number;
  received: number;
  loss_percent: number;
  rtt_min_ms: number;
  rtt_avg_ms: number;
  rtt_max_ms: number;
  replies: Reply[];
};

export default function PingResultView({ parsed }: { parsed: PingParsed }) {
  const loss = parsed.loss_percent ?? 0;
  const lossTone = loss === 0 ? "emerald" : loss < 25 ? "amber" : "red";
  const data = parsed.replies.map((r) => ({ seq: r.seq, rtt: r.rtt_ms }));

  return (
    <Section
      title={`Ping ${parsed.target ?? parsed.resolved_ip ?? ""}`}
      right={
        <span className="text-[10px] text-slate-500">{parsed.resolved_ip}</span>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card
          label="Loss"
          value={`${loss.toFixed(1)}%`}
          tone={lossTone}
          hint={`${parsed.received}/${parsed.transmitted} received`}
        />
        <Card label="Min" value={`${parsed.rtt_min_ms.toFixed(2)} ms`} />
        <Card label="Avg" value={`${parsed.rtt_avg_ms.toFixed(2)} ms`} tone="blue" />
        <Card label="Max" value={`${parsed.rtt_max_ms.toFixed(2)} ms`} />
        <Card
          label="Jitter"
          value={`${(parsed.rtt_max_ms - parsed.rtt_min_ms).toFixed(2)} ms`}
          hint="max − min"
        />
      </div>

      {data.length > 0 && (
        <div className="mt-4 h-48 w-full">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pingFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="seq"
                tick={{ fill: "#64748b", fontSize: 10 }}
                axisLine={{ stroke: "#334155" }}
                tickLine={{ stroke: "#334155" }}
              />
              <YAxis
                tick={{ fill: "#64748b", fontSize: 10 }}
                axisLine={{ stroke: "#334155" }}
                tickLine={{ stroke: "#334155" }}
                width={40}
                unit=" ms"
              />
              <Tooltip
                contentStyle={{
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 4,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#94a3b8" }}
                formatter={(v: number) => [`${v.toFixed(2)} ms`, "RTT"]}
                labelFormatter={(l: number) => `seq ${l}`}
              />
              <Area
                type="monotone"
                dataKey="rtt"
                stroke="#60a5fa"
                strokeWidth={2}
                fill="url(#pingFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Section>
  );
}
