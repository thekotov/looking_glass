import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as agentsApi from "../api/agents";
import { agentLabel } from "../api/agents";
import { useT } from "../i18n";
import { usePins } from "../lib/pins";

type Cmd = {
  id: string;
  label: string;
  hint?: string;
  group: "nav" | "action" | "agent" | "target";
  onSelect: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onNewTask: () => void;
};

/**
 * Spotlight-style fuzzy command palette. Opens on Cmd/Ctrl-K from anywhere.
 *   - Hardcoded nav and action commands
 *   - Live-pulled list of active agents (filterable)
 *
 * Match is substring-on-lowercase — enough for ~hundreds of items without a
 * fuzzy lib. If the list ever balloons, swap in fuse.js.
 */
export function CommandPalette({ open, onClose, onNewTask }: Props) {
  const { t } = useT();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [highlight, setHighlight] = useState(0);

  const agentsQ = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.listAgents,
    enabled: open,
    staleTime: 30_000,
  });
  const pinnedAgents = usePins("agents");
  const pinnedTargets = usePins("targets");
  const pinnedAgentsSet = useMemo(() => new Set(pinnedAgents), [pinnedAgents]);

  useEffect(() => {
    if (open) {
      setQ("");
      setHighlight(0);
      // Defer to next frame so the input exists in the DOM.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const allCmds = useMemo<Cmd[]>(() => {
    const nav: Cmd[] = [
      { id: "go:/dashboard", label: t("cmd.goDashboard"), hint: "g d", group: "nav", onSelect: () => navigate("/dashboard") },
      { id: "go:/agents", label: t("cmd.goAgents"), hint: "g a", group: "nav", onSelect: () => navigate("/agents") },
      { id: "go:/tasks", label: t("cmd.goTasks"), hint: "g t", group: "nav", onSelect: () => navigate("/tasks") },
      { id: "go:/schedules", label: t("cmd.goSchedules"), hint: "g s", group: "nav", onSelect: () => navigate("/schedules") },
      { id: "go:/targets", label: t("cmd.goTargets"), hint: "g r", group: "nav", onSelect: () => navigate("/targets") },
      { id: "go:/availability", label: t("cmd.goAvailability"), group: "nav", onSelect: () => navigate("/availability") },
    ];
    const actions: Cmd[] = [
      { id: "act:new-task", label: t("cmd.newTask"), hint: "n", group: "action", onSelect: onNewTask },
    ];
    const agentCmds: Cmd[] = (agentsQ.data ?? [])
      .filter((a) => a.status === "active")
      .map((a) => ({
        id: `agent:${a.id}`,
        label: (pinnedAgentsSet.has(a.id) ? "★ " : "") + agentLabel(a),
        hint: [a.city, a.country_code].filter(Boolean).join(", ") || a.id.slice(0, 8),
        group: "agent",
        onSelect: () => navigate(`/agents#agent-${a.id}`),
      }));
    // Pinned items sort first.
    agentCmds.sort((a, b) => {
      const aPin = a.label.startsWith("★ ") ? 0 : 1;
      const bPin = b.label.startsWith("★ ") ? 0 : 1;
      return aPin - bPin;
    });
    const targetCmds: Cmd[] = pinnedTargets.map((target) => ({
      id: `target:${target}`,
      label: `★ ${target}`,
      hint: t("cmd.openTarget"),
      group: "target",
      onSelect: () => navigate(`/targets/${encodeURIComponent(target)}`),
    }));
    return [...nav, ...actions, ...targetCmds, ...agentCmds];
  }, [agentsQ.data, pinnedAgentsSet, pinnedTargets, navigate, onNewTask, t]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return allCmds.slice(0, 20);
    return allCmds
      .filter(
        (c) =>
          c.label.toLowerCase().includes(term) ||
          c.hint?.toLowerCase().includes(term) ||
          c.id.toLowerCase().includes(term),
      )
      .slice(0, 30);
  }, [allCmds, q]);

  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered.length, highlight]);

  if (!open) return null;

  function pick(cmd: Cmd) {
    cmd.onSelect();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const c = filtered[highlight];
      if (c) pick(c);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/50 p-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("cmd.title")}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("cmd.placeholder")}
          className="block w-full border-b border-slate-800 bg-transparent px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          aria-autocomplete="list"
        />
        <ul role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-slate-500">
              {t("cmd.noMatch")}
            </li>
          )}
          {filtered.map((c, i) => {
            const active = i === highlight;
            return (
              <li
                key={c.id}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(c)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2 text-sm ${
                  active ? "bg-slate-800 text-slate-100" : "text-slate-300 hover:bg-slate-800/50"
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`text-[9px] uppercase tracking-wide ${GROUP_TONE[c.group]}`}>
                    {c.group}
                  </span>
                  <span className="truncate">{c.label}</span>
                </span>
                {c.hint && (
                  <span className="shrink-0 font-mono text-[10px] text-slate-500">{c.hint}</span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="border-t border-slate-800 px-4 py-2 text-[10px] text-slate-500">
          <span>↑↓ navigate · ↵ select · esc close</span>
        </div>
      </div>
    </div>
  );
}

const GROUP_TONE: Record<Cmd["group"], string> = {
  nav: "text-blue-400",
  action: "text-emerald-400",
  agent: "text-amber-400",
  target: "text-pink-400",
};
