import { Card, Section, serviceName } from "./common";

type ScanEntry = {
  port: number;
  // tcp_scan calls it `open` (bool); syn_scan calls it `state` (string).
  open?: boolean;
  state?: "open" | "closed" | "filtered";
  rtt_ms?: number;
  error?: string;
};

type ScanParsed = {
  target?: string;
  resolved_ip?: string;
  total: number;
  open: number;
  entries: ScanEntry[];
};

export default function TCPScanResultView({
  parsed,
  variant,
}: {
  parsed: ScanParsed;
  variant: "tcp_scan" | "syn_scan";
}) {
  const entries = parsed.entries ?? [];
  const closed = entries.filter((e) => stateOf(e) === "closed").length;
  const filtered = entries.filter((e) => stateOf(e) === "filtered").length;

  return (
    <Section
      title={`${variant === "syn_scan" ? "SYN scan" : "TCP connect scan"} ${parsed.target ?? parsed.resolved_ip ?? ""}`}
      right={
        <span className="text-[10px] text-slate-500">
          {parsed.total} ports → {parsed.resolved_ip}
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        <Card label="Total" value={parsed.total} />
        <Card label="Open" value={parsed.open} tone="emerald" />
        <Card label="Closed" value={closed} tone="red" />
        <Card label="Filtered" value={filtered} tone="amber" />
      </div>

      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-1.5">
        {entries.map((e) => {
          const state = stateOf(e);
          const svc = serviceName(e.port);
          return (
            <div
              key={e.port}
              className={`rounded border px-2 py-1 text-center font-mono text-[11px] ${classFor(state)}`}
              title={
                e.rtt_ms !== undefined
                  ? `port ${e.port} (${state}) — rtt ${e.rtt_ms.toFixed(2)} ms${svc ? ` — ${svc}` : ""}`
                  : `port ${e.port} (${state})${svc ? ` — ${svc}` : ""}`
              }
            >
              <div className="font-semibold">{e.port}</div>
              {svc && (
                <div className="text-[9px] uppercase opacity-70">{svc}</div>
              )}
            </div>
          );
        })}
      </div>

      {entries.filter((e) => stateOf(e) === "open").length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
            Open ports detail
          </h3>
          <ul className="space-y-0.5 font-mono text-xs text-slate-300">
            {entries
              .filter((e) => stateOf(e) === "open")
              .map((e) => (
                <li key={e.port}>
                  <span className="text-emerald-400">●</span>{" "}
                  {e.port}/tcp
                  {serviceName(e.port) && (
                    <span className="text-slate-500"> — {serviceName(e.port)}</span>
                  )}
                  {e.rtt_ms !== undefined && (
                    <span className="text-slate-500"> ({e.rtt_ms.toFixed(2)} ms)</span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function stateOf(e: ScanEntry): "open" | "closed" | "filtered" {
  if (e.state) return e.state;
  return e.open ? "open" : "closed";
}

function classFor(state: "open" | "closed" | "filtered"): string {
  switch (state) {
    case "open":
      return "border-emerald-700 bg-emerald-950 text-emerald-300";
    case "closed":
      return "border-red-900 bg-red-950/50 text-red-300";
    case "filtered":
      return "border-amber-900 bg-amber-950/40 text-amber-300";
  }
}
