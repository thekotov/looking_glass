import { useQuery } from "@tanstack/react-query";
import { memo, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from "react-simple-maps";
import { agentLabel, type Agent } from "../api/agents";
import * as targetsApi from "../api/targets";
import { isAgentOnline } from "../lib/agents";
import { useT } from "../i18n";

type Props = {
  agents: Agent[];
  height?: number;
};

type Mode = "status" | "latency";

// Vendored locally under public/ so the CSP doesn't have to whitelist a CDN
// and so the map keeps working offline. Source: world-atlas@2.0.2.
const WORLD_TOPOJSON = "/countries-110m.json";

type Placed = Agent & { lat: number; lon: number };
type Cluster = {
  key: string;
  lat: number;
  lon: number;
  agents: Placed[];
  online: number;
};

function isPlaced(a: Agent): a is Placed {
  return typeof a.latitude === "number" && typeof a.longitude === "number";
}

function clusterKey(lat: number, lon: number): string {
  return `${Math.round(lat * 10) / 10},${Math.round(lon * 10) / 10}`;
}

const CountriesLayer = memo(function CountriesLayer() {
  return (
    <Geographies geography={WORLD_TOPOJSON}>
      {({ geographies }) =>
        geographies.map((geo) => (
          <Geography
            key={geo.rsmKey}
            geography={geo}
            fill="#1e293b"
            stroke="#0f172a"
            strokeWidth={0.5}
            style={{
              default: { outline: "none" },
              hover: { fill: "#243042", outline: "none" },
              pressed: { outline: "none" },
            }}
          />
        ))
      }
    </Geographies>
  );
});

// Pure status colouring. Used in "status" mode.
function statusFill(cluster: Cluster): string {
  const allOnline = cluster.online === cluster.agents.length;
  const noneOnline = cluster.online === 0;
  return noneOnline ? "#64748b" : allOnline ? "#34d399" : "#fbbf24";
}

// Latency-bucket → colour. Buckets match what an operator cares about:
// <50ms (great), 50-150 (ok), 150-300 (slow), >300 (bad), no-data (grey).
function latencyFill(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "#475569";
  if (ms < 50) return "#34d399";
  if (ms < 150) return "#a3e635";
  if (ms < 300) return "#fbbf24";
  return "#ef4444";
}

export default function AgentsMap({ agents, height = 360 }: Props) {
  const navigate = useNavigate();
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<Mode>("status");
  const [overlayTarget, setOverlayTarget] = useState<string>("");

  const placed = useMemo<Placed[]>(
    () =>
      agents
        .filter(isPlaced)
        .map((a) => ({ ...a, lat: a.latitude as number, lon: a.longitude as number })),
    [agents],
  );

  // Cheap top-targets query — only fetched when overlay is enabled.
  const topTargetsQ = useQuery({
    queryKey: ["targets", "for-overlay", "7d"],
    queryFn: () => targetsApi.listTargets("7d", 50),
    enabled: mode === "latency",
    staleTime: 60_000,
  });

  // Per-agent latency to the chosen target. Re-fetched whenever target/mode change.
  const summaryQ = useQuery({
    queryKey: ["target-summary", overlayTarget, "24h", "ping"],
    queryFn: () => targetsApi.getTargetSummary(overlayTarget, { since: "24h", type: "ping" }),
    enabled: mode === "latency" && !!overlayTarget,
    refetchInterval: 30_000,
  });
  const latencyByAgent = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const row of summaryQ.data?.per_agent ?? []) {
      m.set(row.agent_id, row.rtt_avg_ms);
    }
    return m;
  }, [summaryQ.data]);

  const clusters = useMemo<Cluster[]>(() => {
    const byKey = new Map<string, Cluster>();
    for (const a of placed) {
      const key = clusterKey(a.lat, a.lon);
      let c = byKey.get(key);
      if (!c) {
        c = { key, lat: a.lat, lon: a.lon, agents: [], online: 0 };
        byKey.set(key, c);
      }
      c.agents.push(a);
      if (isAgentOnline(a.last_seen)) c.online += 1;
    }
    return Array.from(byKey.values());
  }, [placed]);

  const [hovered, setHovered] = useState<Cluster | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState<[number, number]>([0, 20]);

  function handleEnter(e: MouseEvent<SVGGElement>, c: Cluster) {
    setHovered(c);
    moveTip(e);
  }
  function moveTip(e: MouseEvent<SVGGElement>) {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top });
  }
  function handleLeave() {
    setHovered(null);
    setTip(null);
  }
  function handleClick(c: Cluster) {
    const id = c.agents[0]?.id;
    if (id) navigate(`/agents#agent-${id}`);
  }
  function reset() {
    setZoom(1);
    setCenter([0, 20]);
  }

  // Choose fill per cluster: in latency mode, use the cluster's *worst*
  // latency so a single slow agent in a city doesn't get hidden.
  function fillFor(c: Cluster): string {
    if (mode === "status" || !overlayTarget) return statusFill(c);
    let worst: number | null = null;
    let anyKnown = false;
    for (const a of c.agents) {
      const ms = latencyByAgent.get(a.id);
      if (ms === undefined) continue;
      anyKnown = true;
      if (ms === null) continue;
      if (worst === null || ms > worst) worst = ms;
    }
    if (!anyKnown) return "#334155";
    return latencyFill(worst);
  }

  return (
    <div className="relative" ref={containerRef}>
      {/* Mode toolbar */}
      <div className="absolute left-2 top-2 z-20 flex items-center gap-2">
        <div
          role="radiogroup"
          aria-label={t("map.modeLabel")}
          className="inline-flex overflow-hidden rounded border border-slate-700 bg-slate-950/80 backdrop-blur"
        >
          {(["status", "latency"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                mode === m ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:bg-slate-800"
              }`}
            >
              {t(`map.mode.${m}`)}
            </button>
          ))}
        </div>
        {mode === "latency" && (
          <select
            value={overlayTarget}
            onChange={(e) => setOverlayTarget(e.target.value)}
            aria-label={t("map.pickTarget")}
            className="rounded border border-slate-700 bg-slate-950/90 px-2 py-0.5 text-[10px] font-mono text-slate-100 backdrop-blur focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            <option value="">{t("map.pickTargetPlaceholder")}</option>
            {(topTargetsQ.data ?? []).map((target) => (
              <option key={target.target} value={target.target}>
                {target.target}
              </option>
            ))}
          </select>
        )}
      </div>

      <div style={{ height }}>
        <ComposableMap
          projectionConfig={{ scale: 145 }}
          style={{ width: "100%", height: "100%" }}
        >
          <ZoomableGroup
            zoom={zoom}
            center={center}
            minZoom={1}
            maxZoom={6}
            onMoveEnd={(pos) => {
              setZoom(pos.zoom);
              setCenter(pos.coordinates as [number, number]);
            }}
          >
            <CountriesLayer />
            {clusters.map((c) => {
              const fill = fillFor(c);
              const r = c.agents.length > 1 ? 5 : 3.5;
              return (
                <Marker
                  key={c.key}
                  coordinates={[c.lon, c.lat]}
                  onMouseEnter={(e) => handleEnter(e, c)}
                  onMouseMove={moveTip}
                  onMouseLeave={handleLeave}
                  onClick={() => handleClick(c)}
                  style={{
                    default: { cursor: "pointer" },
                    hover: { cursor: "pointer" },
                    pressed: { cursor: "pointer" },
                  }}
                >
                  <circle r={r + 3} fill={fill} fillOpacity={0.2} />
                  <circle r={r} fill={fill} stroke="#0f172a" strokeWidth={0.6} />
                  {c.agents.length > 1 && (
                    <text
                      textAnchor="middle"
                      y={-r - 4}
                      style={{
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 8,
                        fill: "#e2e8f0",
                        pointerEvents: "none",
                      }}
                    >
                      {c.agents.length}
                    </text>
                  )}
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>
      </div>

      {/* Tooltip */}
      {hovered && tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded border border-slate-700 bg-slate-950/95 px-3 py-2 shadow-lg"
          style={{ left: tip.x + 12, top: tip.y + 12 }}
          role="status"
        >
          {hovered.agents.length === 1 ? (
            <SingleAgent
              agent={hovered.agents[0]}
              latency={mode === "latency" ? latencyByAgent.get(hovered.agents[0].id) : undefined}
            />
          ) : (
            <ClusterSummary
              cluster={hovered}
              latencyByAgent={mode === "latency" ? latencyByAgent : null}
            />
          )}
        </div>
      )}

      {/* Zoom controls + legend */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-2">
        {mode === "status" ? <StatusLegend t={t} /> : <LatencyLegend t={t} />}
        <div className="pointer-events-auto flex gap-1">
          <ZoomButton onClick={() => setZoom((z) => Math.min(6, z * 1.5))} label="+" />
          <ZoomButton onClick={() => setZoom((z) => Math.max(1, z / 1.5))} label="−" />
          <ZoomButton onClick={reset} label="⤾" title={t("map.reset")} />
        </div>
      </div>

      {placed.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="rounded border border-slate-700 bg-slate-900/90 px-4 py-2 text-xs text-slate-400">
            {t("map.noCoords")}
          </p>
        </div>
      )}
    </div>
  );
}

function SingleAgent({
  agent,
  latency,
}: {
  agent: Placed;
  latency?: number | null;
}) {
  const online = isAgentOnline(agent.last_seen);
  return (
    <>
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            online ? "bg-emerald-400" : "bg-slate-500"
          }`}
        />
        <p className="font-mono text-xs text-slate-100">{agentLabel(agent)}</p>
      </div>
      <p className="mt-0.5 text-[10px] text-slate-400">
        {[agent.city, agent.country_code].filter(Boolean).join(", ") || "—"}
      </p>
      {agent.tags.length > 0 && (
        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
          {agent.tags.join(", ")}
        </p>
      )}
      {latency !== undefined && (
        <p className="mt-1 text-[11px] font-mono text-slate-100">
          {latency === null ? "no data" : `${latency.toFixed(1)} ms`}
        </p>
      )}
    </>
  );
}

function ClusterSummary({
  cluster,
  latencyByAgent,
}: {
  cluster: Cluster;
  latencyByAgent: Map<string, number | null> | null;
}) {
  const { t } = useT();
  const loc = [cluster.agents[0]?.city, cluster.agents[0]?.country_code]
    .filter(Boolean)
    .join(", ");
  return (
    <>
      <p className="text-xs text-slate-100">
        {cluster.agents.length} {t("map.agents")}
        <span className="ml-2 text-slate-400">
          {cluster.online}/{cluster.agents.length} {t("map.online")}
        </span>
      </p>
      {loc && <p className="mt-0.5 text-[10px] text-slate-400">{loc}</p>}
      <ul className="mt-1 space-y-0.5">
        {cluster.agents.slice(0, 6).map((a) => {
          const lat = latencyByAgent?.get(a.id);
          return (
            <li key={a.id} className="flex items-center gap-2 font-mono text-[10px]">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  isAgentOnline(a.last_seen) ? "bg-emerald-400" : "bg-slate-500"
                }`}
              />
              <span className="flex-1 text-slate-200">{agentLabel(a)}</span>
              {latencyByAgent && (
                <span className="text-slate-400">
                  {lat === undefined || lat === null ? "—" : `${lat.toFixed(0)}ms`}
                </span>
              )}
            </li>
          );
        })}
        {cluster.agents.length > 6 && (
          <li className="text-[10px] text-slate-500">+{cluster.agents.length - 6}…</li>
        )}
      </ul>
    </>
  );
}

function StatusLegend({ t }: { t: (k: string) => string }) {
  return (
    <div className="pointer-events-none flex items-center gap-3 rounded border border-slate-800 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-400">
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
        {t("map.online")}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
        {t("map.partial")}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full bg-slate-500" />
        {t("map.offline")}
      </span>
    </div>
  );
}

function LatencyLegend({ t }: { t: (k: string) => string }) {
  return (
    <div className="pointer-events-none flex items-center gap-2 rounded border border-slate-800 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-400">
      <span className="text-[9px] uppercase tracking-wide">{t("map.latencyLegend")}</span>
      <Swatch color="#34d399" label="<50" />
      <Swatch color="#a3e635" label="50–150" />
      <Swatch color="#fbbf24" label="150–300" />
      <Swatch color="#ef4444" label="≥300" />
      <Swatch color="#475569" label="—" />
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function ZoomButton({
  onClick,
  label,
  title,
}: {
  onClick: () => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="h-7 w-7 rounded border border-slate-700 bg-slate-950/80 text-sm text-slate-200 hover:border-slate-500 hover:bg-slate-900"
    >
      {label}
    </button>
  );
}
