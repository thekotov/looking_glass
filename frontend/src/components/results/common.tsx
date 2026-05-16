// Shared bits used by per-type result views.

import type { ReactNode } from "react";

export function Card({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "emerald" | "amber" | "red" | "slate" | "blue";
  hint?: string;
}) {
  const colors = {
    emerald: "text-emerald-400",
    amber: "text-amber-400",
    red: "text-red-400",
    blue: "text-blue-400",
    slate: "text-slate-100",
  } as const;
  return (
    <div className="rounded border border-slate-800 bg-slate-950 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${colors[tone ?? "slate"]}`}>{value}</p>
      {hint && <p className="text-[10px] text-slate-600">{hint}</p>}
    </div>
  );
}

export function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900">
      <header className="flex items-center justify-between border-b border-slate-800 px-6 py-3">
        <h2 className="text-xs uppercase tracking-wide text-slate-500">{title}</h2>
        {right}
      </header>
      <div className="px-6 py-4">{children}</div>
    </section>
  );
}

export function LatencyBar({
  value,
  max,
  tone = "blue",
}: {
  value: number;
  max: number;
  tone?: "blue" | "emerald" | "amber" | "red";
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const colors = {
    blue: "bg-blue-600",
    emerald: "bg-emerald-600",
    amber: "bg-amber-600",
    red: "bg-red-600",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800">
      <div className={`h-full ${colors[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Service name lookup for common ports (used by TCP scan grids).
const PORT_NAMES: Record<number, string> = {
  20: "ftp-data",
  21: "ftp",
  22: "ssh",
  23: "telnet",
  25: "smtp",
  53: "dns",
  80: "http",
  110: "pop3",
  123: "ntp",
  143: "imap",
  161: "snmp",
  389: "ldap",
  443: "https",
  445: "smb",
  465: "smtps",
  587: "submission",
  636: "ldaps",
  993: "imaps",
  995: "pop3s",
  1433: "mssql",
  1521: "oracle",
  3306: "mysql",
  3389: "rdp",
  5432: "postgres",
  5672: "amqp",
  5900: "vnc",
  6379: "redis",
  8080: "http-alt",
  8443: "https-alt",
  9000: "minio",
  9090: "prom",
  9092: "kafka",
  9200: "elastic",
  9300: "elastic",
  11211: "memcached",
  27017: "mongo",
};

export function serviceName(port: number): string | null {
  return PORT_NAMES[port] ?? null;
}
