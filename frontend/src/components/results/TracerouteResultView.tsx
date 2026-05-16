import { LatencyBar, Section } from "./common";

type TraceHop = {
  hop: number;
  ips: string[] | null;
  rtts_ms: number[] | null;
};

type TracerouteParsed = {
  target?: string;
  resolved_ip?: string;
  hops: TraceHop[];
};

// Older agent versions emit `null` instead of `[]` for empty hop fields; the
// helpers below treat them interchangeably so the renderer doesn't crash.
const ips = (h: TraceHop): string[] => h.ips ?? [];
const rtts = (h: TraceHop): number[] => h.rtts_ms ?? [];

export default function TracerouteResultView({ parsed }: { parsed: TracerouteParsed }) {
  const hops = parsed.hops ?? [];
  const maxRtt = hops.reduce(
    (m, h) => rtts(h).reduce((mm, r) => Math.max(mm, r), m),
    1,
  );

  return (
    <Section
      title={`Traceroute ${parsed.target ?? parsed.resolved_ip ?? ""}`}
      right={
        <span className="text-[10px] text-slate-500">{hops.length} hops</span>
      }
    >
      {hops.length === 0 ? (
        <p className="text-sm text-slate-500">No hops resolved.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="pb-2 pr-3 font-medium">Hop</th>
              <th className="pb-2 pr-3 font-medium">IP</th>
              <th className="pb-2 pr-3 font-medium">RTT</th>
              <th className="pb-2 pr-0 font-medium">Latency</th>
            </tr>
          </thead>
          <tbody>
            {hops.map((h) => {
              const hopIps = ips(h);
              const hopRtts = rtts(h);
              const noReply = hopIps.length === 0 && hopRtts.length === 0;
              const avgRtt =
                hopRtts.length > 0
                  ? hopRtts.reduce((a, b) => a + b, 0) / hopRtts.length
                  : 0;
              const tone =
                avgRtt < 50
                  ? "emerald"
                  : avgRtt < 150
                  ? "blue"
                  : avgRtt < 300
                  ? "amber"
                  : "red";
              return (
                <tr key={h.hop} className="border-t border-slate-800">
                  <td className="py-1.5 pr-3 font-mono text-slate-500">{h.hop}</td>
                  <td className="py-1.5 pr-3 font-mono text-slate-200">
                    {noReply ? (
                      <span className="text-slate-600">* * *</span>
                    ) : (
                      hopIps.join(", ")
                    )}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-slate-400">
                    {hopRtts.length > 0
                      ? hopRtts.map((r) => r.toFixed(2)).join(" / ") + " ms"
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-0 w-1/3">
                    {hopRtts.length > 0 && (
                      <LatencyBar value={avgRtt} max={maxRtt} tone={tone} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}
