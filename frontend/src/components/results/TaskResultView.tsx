// Dispatch: render the right per-type view for a task's parsed_json.
// Falls back to a generic JSON pre-block for types without a custom view yet.

import HTTPCheckResultView from "./HTTPCheckResultView";
import MTRResultView from "./MTRResultView";
import PingResultView from "./PingResultView";
import TCPScanResultView from "./TCPScanResultView";
import TracerouteResultView from "./TracerouteResultView";

type Props = {
  type: string;
  parsed: Record<string, unknown> | null;
};

export default function TaskResultView({ type, parsed }: Props) {
  if (!parsed) return null;

  // We trust the agent's parsed_json shape per type. The components do their
  // own defensive access — if a field is missing they degrade gracefully.
  switch (type) {
    case "ping":
      return <PingResultView parsed={parsed as never} />;
    case "traceroute":
      return <TracerouteResultView parsed={parsed as never} />;
    case "mtr":
    case "mtr_tcp":
      return <MTRResultView parsed={parsed as never} />;
    case "tcp_scan":
      return <TCPScanResultView parsed={parsed as never} variant="tcp_scan" />;
    case "syn_scan":
      return <TCPScanResultView parsed={parsed as never} variant="syn_scan" />;
    case "http_check":
      return <HTTPCheckResultView parsed={parsed as never} />;
    default:
      return (
        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900">
          <h2 className="border-b border-slate-800 px-6 py-3 text-xs uppercase tracking-wide text-slate-500">
            Parsed result
          </h2>
          <pre className="overflow-x-auto px-6 py-4 font-mono text-xs text-slate-300">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        </section>
      );
  }
}
