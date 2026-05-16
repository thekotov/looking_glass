import { LatencyBar, Section } from "./common";

// mtr --json shape:
// {
//   "report": {
//     "mtr": {...},
//     "hubs": [
//       {"count": 1, "host": "ip-or-?", "Loss%": 0, "Snt": 10, "Last": 5.1,
//        "Avg": 4.8, "Best": 4.2, "Wrst": 9.3, "StDev": 1.0},
//       ...
//     ]
//   },
//   "target": "...",
//   "resolved_ip": "..."
// }
type Hub = {
  count?: number;
  host?: string;
  "Loss%"?: number;
  Snt?: number;
  Last?: number;
  Avg?: number;
  Best?: number;
  Wrst?: number;
  StDev?: number;
};

type MTRParsed = {
  target?: string;
  resolved_ip?: string;
  report?: { hubs?: Hub[] };
  hubs?: Hub[]; // when emitted by our live aggregator
};

export default function MTRResultView({ parsed }: { parsed: MTRParsed }) {
  const hubs: Hub[] = parsed.report?.hubs ?? parsed.hubs ?? [];
  const maxAvg = hubs.reduce((m, h) => Math.max(m, h.Avg ?? 0), 1);
  const maxLoss = hubs.reduce((m, h) => Math.max(m, h["Loss%"] ?? 0), 1);

  return (
    <Section
      title={`MTR ${parsed.target ?? parsed.resolved_ip ?? ""}`}
      right={
        <span className="text-[10px] text-slate-500">{hubs.length} hops</span>
      }
    >
      {hubs.length === 0 ? (
        <p className="text-sm text-slate-500">No hops captured.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2 pr-3 font-medium">#</th>
              <th className="pb-2 pr-3 font-medium">Host</th>
              <th className="pb-2 pr-3 font-medium">Loss%</th>
              <th className="pb-2 pr-3 font-medium">Snt</th>
              <th className="pb-2 pr-3 font-medium">Best</th>
              <th className="pb-2 pr-3 font-medium">Avg</th>
              <th className="pb-2 pr-3 font-medium">Worst</th>
              <th className="pb-2 pr-3 font-medium">StDev</th>
              <th className="pb-2 pr-0 font-medium">Avg latency</th>
            </tr>
          </thead>
          <tbody>
            {hubs.map((h, i) => {
              const lossPct = h["Loss%"] ?? 0;
              const lossTone =
                lossPct === 0
                  ? "emerald"
                  : lossPct < 25
                  ? "amber"
                  : "red";
              const avg = h.Avg ?? 0;
              const latTone =
                avg < 50
                  ? "emerald"
                  : avg < 150
                  ? "blue"
                  : avg < 300
                  ? "amber"
                  : "red";
              return (
                <tr key={i} className="border-t border-slate-800">
                  <td className="py-1.5 pr-3 font-mono text-slate-500">
                    {h.count ?? i + 1}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-slate-200">
                    {h.host === "???" || !h.host ? (
                      <span className="text-slate-600">* * *</span>
                    ) : (
                      h.host
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span
                      className={`rounded border px-1 py-0.5 font-mono text-[10px] ${
                        lossTone === "emerald"
                          ? "border-emerald-900 bg-emerald-950 text-emerald-300"
                          : lossTone === "amber"
                          ? "border-amber-900 bg-amber-950 text-amber-300"
                          : "border-red-900 bg-red-950 text-red-300"
                      }`}
                    >
                      {lossPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-slate-400">
                    {h.Snt ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-slate-400">
                    {fmtMs(h.Best)}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-slate-300">
                    {fmtMs(h.Avg)}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-slate-400">
                    {fmtMs(h.Wrst)}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-slate-500">
                    {fmtMs(h.StDev)}
                  </td>
                  <td className="py-1.5 pr-0 w-1/4">
                    {avg > 0 && <LatencyBar value={avg} max={maxAvg} tone={latTone} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {maxLoss > 0 && (
        <p className="mt-3 text-[10px] text-slate-500">
          Worst loss in path:{" "}
          <span className="text-amber-400">{maxLoss.toFixed(1)}%</span>
        </p>
      )}
    </Section>
  );
}

function fmtMs(v: number | undefined): string {
  if (v === undefined || v === null) return "—";
  return v.toFixed(2);
}
