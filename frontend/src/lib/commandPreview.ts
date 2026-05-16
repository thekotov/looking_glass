/**
 * Render a CLI-shaped preview of the task the user is about to submit.
 *
 * This is NOT the actual command line executed on the agent — the agent
 * uses strict whitelisted argv slices. The string here is purely a
 * human-readable summary that makes "what am I about to send?" obvious.
 */

type Opts = Record<string, unknown>;

const num = (o: Opts, k: string, def: number): number =>
  typeof o[k] === "number" ? (o[k] as number) : def;
const str = (o: Opts, k: string, def: string): string =>
  typeof o[k] === "string" && (o[k] as string).length > 0 ? (o[k] as string) : def;
const bool = (o: Opts, k: string, def: boolean): boolean =>
  typeof o[k] === "boolean" ? (o[k] as boolean) : def;
const arr = <T>(o: Opts, k: string, def: T[]): T[] =>
  Array.isArray(o[k]) ? (o[k] as T[]) : def;

export function previewCommand(
  taskType: string,
  target: string,
  opts: Opts,
): string {
  const t = target.trim() || "<target>";
  switch (taskType) {
    case "ping": {
      const count = num(opts, "count", 5);
      const timeout = num(opts, "timeout_sec", 5);
      const interval = num(opts, "interval_ms", 1000);
      const v6 = bool(opts, "ipv6", false);
      const bin = v6 ? "ping6" : "ping";
      return `${bin} -c ${count} -i ${(interval / 1000).toFixed(2)} -W ${timeout} ${t}`;
    }
    case "traceroute": {
      const maxHops = num(opts, "max_hops", 30);
      const timeout = num(opts, "timeout_sec", 3);
      const queries = num(opts, "queries_per_hop", 1);
      const v6 = bool(opts, "ipv6", false);
      const bin = v6 ? "traceroute -6" : "traceroute";
      return `${bin} -m ${maxHops} -w ${timeout} -q ${queries} ${t}`;
    }
    case "mtr": {
      const cycles = num(opts, "cycles", 10);
      const maxHops = num(opts, "max_hops", 30);
      const v6 = bool(opts, "ipv6", false);
      return `mtr --report --raw${v6 ? " -6" : ""} -c ${cycles} -m ${maxHops} ${t}`;
    }
    case "mtr_tcp": {
      const cycles = num(opts, "cycles", 10);
      const maxHops = num(opts, "max_hops", 30);
      const port = num(opts, "port", 443);
      const v6 = bool(opts, "ipv6", false);
      return `mtr --tcp -P ${port} --report --raw${v6 ? " -6" : ""} -c ${cycles} -m ${maxHops} ${t}`;
    }
    case "tcp_connect": {
      const port = num(opts, "port", 443);
      const timeout = num(opts, "timeout_sec", 5);
      const banner = bool(opts, "banner_grab", false);
      let s = `tcp-connect ${t}:${port} timeout=${timeout}s`;
      if (banner) s += " banner=on";
      return s;
    }
    case "tcp_scan": {
      const ports = arr<number>(opts, "ports", [80, 443, 22]);
      const timeout = num(opts, "timeout_sec", 3);
      const conc = num(opts, "concurrency", 32);
      return `tcp-scan ${t} ports=${ports.join(",")} timeout=${timeout}s concurrency=${conc}`;
    }
    case "syn_scan": {
      const ports = arr<number>(opts, "ports", [22, 80, 443]);
      const timeout = num(opts, "timeout_sec", 5);
      return `hping3 --syn -c 1 --fast ${t} -p ${ports.join(",")} timeout=${timeout}s`;
    }
    case "hping3": {
      const mode = str(opts, "mode", "tcp_syn");
      const port = num(opts, "port", 80);
      const count = num(opts, "count", 5);
      const interval = num(opts, "interval_ms", 200);
      return `hping3 --${flagForMode(mode)} -c ${count} -i u${interval * 1000} -p ${port} ${t}`;
    }
    case "dns": {
      const record = str(opts, "record_type", "A");
      const resolver = str(opts, "resolver", "");
      const timeout = num(opts, "timeout_sec", 5);
      const at = resolver ? ` @${resolver}` : "";
      return `dig${at} ${record} ${t} +time=${timeout}`;
    }
    case "http_check": {
      const method = str(opts, "method", "GET");
      const follow = bool(opts, "follow_redirects", false);
      const timeout = num(opts, "timeout_sec", 10);
      const url = t.includes("://") ? t : `https://${t}`;
      return `curl -X ${method}${follow ? " -L" : ""} --max-time ${timeout} ${url}`;
    }
    case "tls_check": {
      const port = num(opts, "port", 443);
      const sni = str(opts, "sni", t);
      const timeout = num(opts, "timeout_sec", 10);
      return `openssl s_client -connect ${t}:${port} -servername ${sni} -timeout ${timeout}`;
    }
    default:
      return `${taskType} ${t}`;
  }
}

function flagForMode(m: string): string {
  switch (m) {
    case "tcp_syn":
      return "syn";
    case "tcp_ack":
      return "ack";
    case "tcp_fin":
      return "fin";
    case "udp":
      return "udp";
    case "icmp":
      return "icmp";
    default:
      return m;
  }
}

/** Estimate expected duration in seconds for the task — used in TaskDetail. */
export function estimateDurationSec(taskType: string, opts: Opts): number | null {
  switch (taskType) {
    case "ping": {
      const count = num(opts, "count", 5);
      const interval = num(opts, "interval_ms", 1000);
      return Math.max(1, Math.round((count * interval) / 1000));
    }
    case "mtr":
    case "mtr_tcp": {
      const cycles = num(opts, "cycles", 10);
      return cycles; // ~1s per cycle
    }
    case "traceroute": {
      const maxHops = num(opts, "max_hops", 30);
      const timeout = num(opts, "timeout_sec", 3);
      return Math.max(2, Math.round((maxHops * timeout) / 10));
    }
    case "hping3": {
      const count = num(opts, "count", 5);
      const interval = num(opts, "interval_ms", 200);
      return Math.max(1, Math.round((count * interval) / 1000));
    }
    case "tcp_connect":
      return num(opts, "timeout_sec", 5);
    case "tcp_scan": {
      const ports = arr<number>(opts, "ports", []).length || 5;
      const timeout = num(opts, "timeout_sec", 3);
      const conc = num(opts, "concurrency", 32);
      return Math.max(2, Math.ceil((ports / Math.max(1, conc)) * timeout));
    }
    default:
      return null;
  }
}
