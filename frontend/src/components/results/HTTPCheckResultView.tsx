type Timing = {
  dns_ms?: number;
  tcp_connect_ms?: number;
  tls_handshake_ms?: number;
  ttfb_ms?: number;
  total_ms?: number;
  connection_reused?: boolean;
};

type Parsed = {
  url?: string;
  final_url?: string;
  method?: string;
  status_code?: number;
  status?: string;
  body_size_bytes?: number;
  duration_ms?: number;
  timing?: Timing;
  tls?: {
    version?: string;
    cipher_suite?: string;
    server_name?: string;
  };
};

type Props = { parsed: Parsed };

/**
 * Renders the curl-style waterfall for an HTTP request:
 *   DNS  ▆▆▆░░░░░░░
 *   TCP  ░░▆▆░░░░░░
 *   TLS  ░░░░▆▆▆░░░
 *   Wait ░░░░░░░▆▆░
 *   Body ░░░░░░░░░▆
 *
 * Phases are stacked so the user sees where the time actually went.
 */
export default function HTTPCheckResultView({ parsed }: Props) {
  const t = parsed.timing;
  if (!t) {
    return (
      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900">
        <h2 className="border-b border-slate-800 px-6 py-3 text-xs uppercase tracking-wide text-slate-500">
          HTTP result
        </h2>
        <Summary parsed={parsed} />
      </section>
    );
  }

  // Convert cumulative timestamps to phase widths. TTFB is "got first byte",
  // measured from start — so server-think time is `ttfb - (dns + connect + tls)`.
  const dns = t.dns_ms ?? 0;
  const tcp = t.tcp_connect_ms ?? 0;
  const tls = t.tls_handshake_ms ?? 0;
  const handshakeTotal = dns + tcp + tls;
  const ttfb = t.ttfb_ms ?? 0;
  const wait = Math.max(0, ttfb - handshakeTotal);
  const total = t.total_ms ?? ttfb;
  const body = Math.max(0, total - ttfb);
  const reused = t.connection_reused === true;

  const phases: { label: string; ms: number; offset: number; color: string }[] = [];
  let cursor = 0;
  function add(label: string, ms: number, color: string) {
    if (ms <= 0) {
      // Still show a zero-line entry for clarity (e.g. plain http → no TLS).
      phases.push({ label, ms: 0, offset: cursor, color });
      return;
    }
    phases.push({ label, ms, offset: cursor, color });
    cursor += ms;
  }
  add("DNS", dns, "bg-violet-500");
  add("TCP", tcp, "bg-blue-500");
  add("TLS", tls, "bg-emerald-500");
  add("Wait (TTFB)", wait, "bg-amber-500");
  add("Body", body, "bg-pink-500");

  return (
    <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-6 py-3">
        <h2 className="text-xs uppercase tracking-wide text-slate-500">
          HTTP timing
        </h2>
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          total {fmt(total)} ms{reused && " · reused conn"}
        </span>
      </header>
      <div className="px-6 py-4">
        <Waterfall phases={phases} total={Math.max(total, 1)} />
      </div>
      <Summary parsed={parsed} />
    </section>
  );
}

function Waterfall({
  phases,
  total,
}: {
  phases: { label: string; ms: number; offset: number; color: string }[];
  total: number;
}) {
  return (
    <div className="space-y-1.5">
      {phases.map((p) => {
        const widthPct = (p.ms / total) * 100;
        const offsetPct = (p.offset / total) * 100;
        return (
          <div
            key={p.label}
            className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-xs"
          >
            <span className="font-mono text-slate-400">{p.label}</span>
            <div className="relative h-3 rounded bg-slate-800">
              {p.ms > 0 && (
                <div
                  className={`absolute h-full rounded ${p.color}`}
                  style={{ left: `${offsetPct}%`, width: `${Math.max(widthPct, 0.5)}%` }}
                />
              )}
            </div>
            <span className="text-right font-mono tabular-nums text-slate-300">
              {p.ms > 0 ? `${fmt(p.ms)} ms` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Summary({ parsed }: { parsed: Parsed }) {
  const code = parsed.status_code ?? 0;
  const codeTone =
    code >= 500 ? "text-red-300" :
    code >= 400 ? "text-amber-300" :
    code >= 300 ? "text-blue-300" :
    code >= 200 ? "text-emerald-300" :
    "text-slate-400";
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-slate-800 px-6 py-4 text-xs sm:grid-cols-4">
      <Stat label="Status" value={
        <span className={`font-mono ${codeTone}`}>
          {code || "—"} {parsed.status ?? ""}
        </span>
      } />
      <Stat label="Method" value={<span className="font-mono">{parsed.method ?? "—"}</span>} />
      <Stat label="Body" value={
        <span className="tabular-nums">
          {parsed.body_size_bytes !== undefined ? `${parsed.body_size_bytes} B` : "—"}
        </span>
      } />
      <Stat label="TLS" value={
        parsed.tls ? (
          <span className="font-mono">{parsed.tls.version}</span>
        ) : (
          <span className="text-slate-500">—</span>
        )
      } />
      {parsed.final_url && parsed.final_url !== parsed.url && (
        <div className="col-span-2 sm:col-span-4">
          <dt className="text-[10px] uppercase tracking-wide text-slate-500">Final URL</dt>
          <dd className="mt-0.5 break-all font-mono text-slate-300">{parsed.final_url}</dd>
        </div>
      )}
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-200">{value}</dd>
    </div>
  );
}

function fmt(n: number): string {
  return n < 10 ? n.toFixed(2) : n.toFixed(1);
}
