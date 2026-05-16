// Per-type live charts that read from the same WebSocket stream as LiveOutput.
//
// Each task type plugs a small parser that turns chunks into data points.
// We keep the parser local — no protocol changes needed for hping3 since it
// already emits 'rtt=X ms' lines verbatim from the agent's stdout.

import { useMemo } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTaskStream, type StreamKind } from "../hooks/useTaskStream";
import { useT } from "../i18n";

type Props = {
  taskId: string;
  taskType: string;
  enabled: boolean;
};

export default function LiveTaskChart({ taskId, taskType, enabled }: Props) {
  const stream = useTaskStream(taskId, enabled);
  const { t, lang } = useT();

  const points = useMemo(() => {
    if (taskType === "hping3") return parseHping3(stream.lines);
    return [];
  }, [stream.lines, taskType]);

  if (taskType !== "hping3") return null;
  if (points.length === 0 && !stream.connected) return null;

  return (
    <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <h2 className="text-xs uppercase tracking-wide text-slate-500">{t("live.rtt")}</h2>
        <span className="text-[10px] text-slate-500">
          {samplesLabel(t, lang, points.length)}
        </span>
      </header>
      <div className="h-48 w-full px-2 py-3">
        {points.length === 0 ? (
          <p className="px-4 text-sm text-slate-500">{t("live.waitFirstPacket")}</p>
        ) : (
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
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
              <Line
                type="monotone"
                dataKey="rtt"
                stroke="#34d399"
                strokeWidth={2}
                dot={{ r: 2, fill: "#34d399" }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function samplesLabel(
  t: (key: string, vars?: Record<string, string | number>) => string,
  lang: "ru" | "en",
  n: number,
): string {
  if (lang === "ru") {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return t("live.samplesOne", { n });
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20))
      return t("live.samplesFew", { n });
    return t("live.samplesMany", { n });
  }
  return n === 1 ? t("live.samplesOne", { n }) : t("live.samplesMany", { n });
}

const HPING3_RTT_RE = /(?:seq=(\d+).*?rtt=([0-9.]+)\s*ms)|(?:rtt=([0-9.]+)\s*ms.*?seq=(\d+))/;

function parseHping3(
  lines: { text: string; stream: StreamKind; seq: number }[],
): { seq: number; rtt: number }[] {
  const out: { seq: number; rtt: number }[] = [];
  for (const l of lines) {
    if (l.stream !== "stdout") continue;
    // Match either order of seq= / rtt= in the line.
    const m = HPING3_RTT_RE.exec(l.text);
    if (!m) continue;
    const seq = Number(m[1] ?? m[4]);
    const rtt = Number(m[2] ?? m[3]);
    if (Number.isFinite(seq) && Number.isFinite(rtt)) {
      out.push({ seq, rtt });
    }
  }
  return out;
}
