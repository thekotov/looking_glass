import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import * as agentsApi from "../api/agents";
import { agentLabel, type Agent } from "../api/agents";
import { getStats } from "../api/stats";
import { isAgentOnline } from "../lib/agents";
import { loadSettings, notify } from "../lib/notifications";

/**
 * Polls /api/stats and /api/agents in the background and fires Notifications
 * for failed tasks + agent online/offline transitions. The hook is mounted
 * once at App level when the user is signed in.
 *
 * Lives outside any individual page so notifications keep flowing whether
 * the user is on /dashboard or /tasks. React-Query dedupes the fetches
 * with the existing per-page queries.
 */
export function useTaskNotifications(enabled: boolean) {
  const settings = loadSettings();

  const statsQ = useQuery({
    queryKey: ["stats", 24],
    queryFn: () => getStats(24),
    enabled: enabled && settings.enabled && settings.taskFailures,
    refetchInterval: 15_000,
  });

  const agentsQ = useQuery({
    queryKey: ["agents"],
    queryFn: agentsApi.listAgents,
    enabled: enabled && settings.enabled && (settings.agentOffline || settings.agentRecovered),
    refetchInterval: 15_000,
  });

  // Track last-seen failure id so we only notify once per new failure.
  const seenFailureIds = useRef<Set<string>>(new Set());
  // Track agent online state to detect transitions, not steady states.
  const lastAgentStates = useRef<Map<string, boolean>>(new Map());
  // Initialise refs on first data without firing notifications for the
  // historical state we just loaded.
  const initialised = useRef({ failures: false, agents: false });

  useEffect(() => {
    if (!settings.enabled || !settings.taskFailures || !statsQ.data) return;
    const fresh = statsQ.data.tasks.recent_failures;
    if (!initialised.current.failures) {
      for (const f of fresh) seenFailureIds.current.add(f.id);
      initialised.current.failures = true;
      return;
    }
    for (const f of fresh) {
      if (seenFailureIds.current.has(f.id)) continue;
      seenFailureIds.current.add(f.id);
      notify({
        title: `Task ${f.status}: ${f.type} ${f.target}`,
        body: f.error ?? undefined,
        tag: `task:${f.id}`,
        onClick: () => {
          window.location.assign(`/tasks/${f.id}`);
        },
      });
    }
  }, [statsQ.data, settings.enabled, settings.taskFailures]);

  useEffect(() => {
    if (!settings.enabled || !agentsQ.data) return;
    if (!settings.agentOffline && !settings.agentRecovered) return;
    if (!initialised.current.agents) {
      for (const a of agentsQ.data) {
        lastAgentStates.current.set(a.id, isAgentOnline(a.last_seen));
      }
      initialised.current.agents = true;
      return;
    }
    for (const a of agentsQ.data) {
      if (a.status !== "active") continue;
      const wasOnline = lastAgentStates.current.get(a.id);
      const nowOnline = isAgentOnline(a.last_seen);
      lastAgentStates.current.set(a.id, nowOnline);
      if (wasOnline === undefined) continue;
      if (wasOnline && !nowOnline && settings.agentOffline) {
        fireAgentNotif(a, "offline");
      } else if (!wasOnline && nowOnline && settings.agentRecovered) {
        fireAgentNotif(a, "recovered");
      }
    }
  }, [agentsQ.data, settings.enabled, settings.agentOffline, settings.agentRecovered]);
}

function fireAgentNotif(a: Agent, kind: "offline" | "recovered") {
  notify({
    title: kind === "offline" ? `Agent offline: ${agentLabel(a)}` : `Agent back: ${agentLabel(a)}`,
    body: [a.city, a.country_code].filter(Boolean).join(", ") || undefined,
    tag: `agent:${a.id}:${kind}`,
    onClick: () => {
      window.location.assign(`/agents#agent-${a.id}`);
    },
  });
}
