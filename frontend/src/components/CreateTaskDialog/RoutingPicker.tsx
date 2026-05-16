import { useMemo } from "react";
import type { Agent } from "../../api/agents";
import { useT } from "../../i18n";

export type RoutingMode = "agents" | "tags";

type Props = {
  mode: RoutingMode;
  setMode: (m: RoutingMode) => void;
  activeAgents: Agent[];
  selectedAgentIds: string[];
  toggleAgent: (id: string, checked: boolean) => void;
  tagsInput: string;
  setTagsInput: (v: string) => void;
  agentsPerTag: number;
  setAgentsPerTag: (n: number) => void;
  taskType: string;
};

/**
 * Picks WHERE the task runs. Two mutually-exclusive modes:
 *   - `agents`: pick one or more specific agents (checkbox list)
 *   - `tags`:  pick by tag(s), with `agents_per_tag` to bound fan-out
 * The dialog owns the routing state and just wires it through here.
 */
export default function RoutingPicker({
  mode,
  setMode,
  activeAgents,
  selectedAgentIds,
  toggleAgent,
  tagsInput,
  setTagsInput,
  agentsPerTag,
  setAgentsPerTag,
  taskType,
}: Props) {
  const { t } = useT();

  const knownTags = useMemo(() => {
    const all = new Set<string>();
    for (const a of activeAgents) for (const tag of a.tags) all.add(tag);
    return Array.from(all).sort();
  }, [activeAgents]);

  const currentTags = useMemo(
    () => tagsInput.split(",").map((s) => s.trim()).filter(Boolean),
    [tagsInput],
  );

  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{t("create.runOn")}</div>
      <div className="mt-1 inline-flex overflow-hidden rounded border border-slate-700" role="tablist">
        <ModeTab label={t("create.pickAgents")} active={mode === "agents"} onClick={() => setMode("agents")} />
        <ModeTab label={t("create.byTags")} active={mode === "tags"} onClick={() => setMode("tags")} />
      </div>

      {mode === "agents" && (
        <div className="mt-2 space-y-1 rounded border border-slate-800 bg-slate-950 p-2 max-h-48 overflow-y-auto">
          {activeAgents.length === 0 && (
            <p className="text-xs text-amber-400">{t("create.noActiveAgents")}</p>
          )}
          {activeAgents.map((a) => {
            const supports = a.capabilities.length === 0 || a.capabilities.includes(taskType);
            const checked = selectedAgentIds.includes(a.id);
            return (
              <label
                key={a.id}
                className={`flex items-center gap-2 rounded px-2 py-1 ${
                  supports ? "hover:bg-slate-900" : "opacity-50"
                }`}
                title={
                  !supports ? `Agent supports: ${a.capabilities.join(", ") || "—"}` : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!supports}
                  onChange={(e) => toggleAgent(a.id, e.target.checked)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950"
                />
                <span
                  className="text-sm text-slate-200"
                  title={a.display_name ? `host: ${a.hostname}` : undefined}
                >
                  {a.display_name?.trim() || a.hostname}
                </span>
                {a.tags.length > 0 && (
                  <span className="text-[10px] uppercase text-slate-500">
                    {a.tags.join(",")}
                  </span>
                )}
                {!supports && (
                  <span className="text-[10px] uppercase text-red-400">⚠ {t("create.noCap")}</span>
                )}
              </label>
            );
          })}
        </div>
      )}

      {mode === "tags" && (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              {t("create.tagsLabel")}
            </span>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="eu, us, asia"
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
            {knownTags.length > 0 && (
              <div className="mt-1.5">
                <p className="text-[10px] uppercase tracking-wide text-slate-600">
                  {t("create.knownTags")}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {knownTags.map((tag) => {
                    const already = currentTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() =>
                          setTagsInput(
                            already
                              ? currentTags.filter((s) => s !== tag).join(", ")
                              : tagsInput
                              ? `${tagsInput}, ${tag}`
                              : tag,
                          )
                        }
                        className={`rounded border px-2 py-1 text-xs uppercase tracking-wide transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                          already
                            ? "border-emerald-700 bg-emerald-950/50 text-emerald-300"
                            : "border-slate-700 text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              {t("create.agentsPerTag")}
            </span>
            <input
              type="number"
              min={1}
              max={20}
              value={agentsPerTag}
              onChange={(e) => setAgentsPerTag(Number(e.target.value))}
              className="mt-1 block w-32 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function ModeTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
        active ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:bg-slate-800"
      }`}
    >
      {label}
    </button>
  );
}
