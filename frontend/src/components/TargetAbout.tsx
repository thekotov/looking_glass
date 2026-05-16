import { useQuery } from "@tanstack/react-query";
import * as toolsApi from "../api/tools";
import { useT } from "../i18n";

type Props = {
  target: string;
};

/**
 * "About target" panel: rDNS, ASN, org, country, city, BGP AS-path — for the
 * trends page. Cached for 5 min by react-query; values rarely change for a
 * public host.
 */
export default function TargetAbout({ target }: Props) {
  const { t } = useT();
  const lookupQ = useQuery({
    queryKey: ["tools-lookup", target],
    queryFn: () => toolsApi.lookupTarget(target),
    staleTime: 5 * 60_000,
  });
  const aspathQ = useQuery({
    queryKey: ["tools-aspath", target],
    queryFn: () => toolsApi.getASPath(target),
    staleTime: 30 * 60_000,
  });

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900">
      <header className="border-b border-slate-800 px-6 py-3">
        <h2 className="text-xs uppercase tracking-wide text-slate-500">
          {t("targetAbout.title")}
        </h2>
      </header>
      <div className="px-6 py-4">
        {lookupQ.isLoading && (
          <p className="text-sm text-slate-500">{t("common.loading")}</p>
        )}
        {lookupQ.isError && (
          <p role="alert" className="text-sm text-red-400">
            {lookupQ.error instanceof Error ? lookupQ.error.message : t("common.failedToLoad")}
          </p>
        )}
        {lookupQ.data && <LookupGrid data={lookupQ.data} />}
      </div>
      <div className="border-t border-slate-800 px-6 py-4">
        <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
          {t("targetAbout.aspath")}
        </p>
        {aspathQ.isLoading && <p className="text-sm text-slate-500">{t("common.loading")}</p>}
        {aspathQ.data && <ASPathView data={aspathQ.data} />}
      </div>
    </section>
  );
}

function LookupGrid({ data }: { data: toolsApi.LookupResult }) {
  const { t } = useT();
  if (data.error && !data.resolved_ip) {
    return <p className="text-sm text-amber-300">⚠ {data.error}</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <Cell label={t("targetAbout.ip")} value={data.resolved_ip} mono />
      <Cell label={t("targetAbout.rdns")} value={data.rdns} mono />
      <Cell label={t("targetAbout.asn")} value={data.asn} mono />
      <Cell label={t("targetAbout.org")} value={data.org ?? data.asname} />
      <Cell label={t("targetAbout.isp")} value={data.isp} />
      <Cell
        label={t("targetAbout.location")}
        value={[data.city, data.region, data.country].filter(Boolean).join(", ") || null}
      />
      {data.error && (
        <p className="sm:col-span-2 lg:col-span-3 text-xs text-amber-300">⚠ {data.error}</p>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 ${mono ? "font-mono" : ""} ${value ? "text-slate-200" : "text-slate-600"}`}>
        {value ?? "—"}
      </p>
    </div>
  );
}

function ASPathView({ data }: { data: toolsApi.ASPathResult }) {
  if (data.error && data.consensus_path.length === 0) {
    return <p className="text-xs text-amber-300">⚠ {data.error}</p>;
  }
  return (
    <div className="space-y-2">
      {data.prefix && (
        <p className="text-[11px] text-slate-500">
          prefix: <span className="font-mono text-slate-300">{data.prefix}</span>
          {data.origin_asn && (
            <>
              {" · origin: "}
              <span className="font-mono text-slate-300">AS{data.origin_asn}</span>
            </>
          )}
        </p>
      )}
      {data.consensus_path.length > 0 && <AsChain asns={data.consensus_path} />}
      {data.paths.length > 1 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-slate-500 hover:text-slate-300">
            {data.paths.length} distinct paths seen
          </summary>
          <div className="mt-2 space-y-1.5">
            {data.paths.map((path, i) => (
              <AsChain key={i} asns={path} muted={i > 0} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function AsChain({ asns, muted = false }: { asns: number[]; muted?: boolean }) {
  if (asns.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {asns.map((asn, i) => (
        <span key={`${i}-${asn}`} className="flex items-center gap-1">
          <a
            href={`https://bgp.tools/as/${asn}`}
            target="_blank"
            rel="noreferrer"
            className={`rounded border px-1.5 py-0.5 font-mono text-[11px] tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
              muted
                ? "border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-300"
                : "border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800"
            }`}
          >
            AS{asn}
          </a>
          {i < asns.length - 1 && <span className="text-slate-600">→</span>}
        </span>
      ))}
    </div>
  );
}
