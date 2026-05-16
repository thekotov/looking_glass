import { useEffect, useRef, useState } from "react";
import { getAccessToken } from "../api/client";
import { registerWS, unregisterWS, updateWS } from "../lib/wsRegistry";

export type StreamKind = "stdout" | "stderr" | "event";

export type StreamEvent =
  | { event: "chunk"; seq: number; stream: StreamKind; text: string }
  | { event: "done"; status: string };

export type LiveState = {
  lines: { stream: StreamKind; text: string; seq: number }[];
  done: boolean;
  status: string | null;
  /** WS connection is currently open. */
  connected: boolean;
  /** We're waiting before the next reconnect attempt. */
  reconnecting: boolean;
  /** Wall-clock time the next reconnect will fire (ms epoch). 0 if none scheduled. */
  retryAt: number;
  /** How many reconnect attempts have happened. */
  attempts: number;
  /** Last surfaced error string, if any. */
  error: string | null;
  /** Fire a reconnect immediately. No-op if already connected. */
  retryNow: () => void;
};

const MAX_BACKOFF_MS = 30_000;
const MIN_BACKOFF_MS = 500;
const GIVE_UP_AFTER = 12;

/**
 * Streams chunks from /ws/tasks/{id}/live. Auto-reconnects with exponential
 * backoff (capped at 30s, 12 attempts). De-duplicates messages by `seq` so
 * a reconnect after a brief disconnect doesn't double up.
 *
 * Registers with `wsRegistry` so the global LiveIndicator can surface
 * connection health without coupling to specific tasks.
 */
export function useTaskStream(taskId: string | undefined, enabled: boolean): LiveState {
  const [state, setState] = useState<Omit<LiveState, "retryNow">>({
    lines: [],
    done: false,
    status: null,
    connected: false,
    reconnecting: false,
    retryAt: 0,
    attempts: 0,
    error: null,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const slotRef = useRef<number | null>(null);
  // Track the highest seen sequence number so a reconnect doesn't add
  // duplicate lines we already have buffered locally.
  const lastSeqRef = useRef<number>(-1);
  // Track whether the cleanup is "user-initiated" (taskId/enabled flip) vs
  // an unexpected close that should trigger reconnect logic.
  const intentionalCloseRef = useRef<boolean>(false);
  const attemptsRef = useRef(0);

  // Bump trigger to ask the effect to (re)open the WS without re-running on
  // every state change.
  const [openTrigger, setOpenTrigger] = useState(0);

  useEffect(() => {
    if (!taskId || !enabled) return;

    const token = getAccessToken();
    if (!token) return;

    const slot = registerWS(`task:${taskId.slice(0, 8)}`);
    slotRef.current = slot;
    updateWS(slot, "connecting");

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws/tasks/${taskId}/live?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    intentionalCloseRef.current = false;

    ws.onopen = () => {
      attemptsRef.current = 0;
      setState((s) => ({
        ...s,
        connected: true,
        reconnecting: false,
        retryAt: 0,
        error: null,
      }));
      updateWS(slot, "open");
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as StreamEvent;
        setState((s) => {
          if (msg.event === "chunk") {
            if (msg.seq <= lastSeqRef.current) return s; // dedupe
            lastSeqRef.current = msg.seq;
            return {
              ...s,
              lines: [...s.lines, { stream: msg.stream, text: msg.text, seq: msg.seq }],
            };
          }
          if (msg.event === "done") {
            intentionalCloseRef.current = true;
            return { ...s, done: true, status: msg.status, reconnecting: false, retryAt: 0 };
          }
          return s;
        });
      } catch {
        // ignore malformed
      }
    };

    ws.onerror = () => {
      updateWS(slot, "error");
      setState((s) => ({ ...s, error: "websocket error" }));
    };

    ws.onclose = () => {
      // Stop here if the close was intentional (component unmounted, task
      // reached terminal state, or `enabled` flipped).
      if (intentionalCloseRef.current) {
        setState((s) => ({ ...s, connected: false, reconnecting: false }));
        updateWS(slot, "closed");
        return;
      }
      const attempt = attemptsRef.current + 1;
      attemptsRef.current = attempt;
      if (attempt > GIVE_UP_AFTER) {
        setState((s) => ({
          ...s,
          connected: false,
          reconnecting: false,
          retryAt: 0,
          error: "stream lost — gave up reconnecting",
          attempts: attempt,
        }));
        updateWS(slot, "error");
        return;
      }
      // Exponential backoff: 500ms → 1s → 2s → … capped at 30s.
      const delay = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** (attempt - 1));
      const retryAt = Date.now() + delay;
      setState((s) => ({
        ...s,
        connected: false,
        reconnecting: true,
        retryAt,
        attempts: attempt,
      }));
      updateWS(slot, "reconnecting");
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        setOpenTrigger((x) => x + 1);
      }, delay);
    };

    return () => {
      intentionalCloseRef.current = true;
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
      if (slotRef.current !== null) {
        unregisterWS(slotRef.current);
        slotRef.current = null;
      }
    };
  }, [taskId, enabled, openTrigger]);

  // Reset transient state when the taskId or enabled flag changes (new stream).
  useEffect(() => {
    lastSeqRef.current = -1;
    attemptsRef.current = 0;
    setState({
      lines: [],
      done: false,
      status: null,
      connected: false,
      reconnecting: false,
      retryAt: 0,
      attempts: 0,
      error: null,
    });
  }, [taskId, enabled]);

  function retryNow() {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    attemptsRef.current = 0;
    setOpenTrigger((x) => x + 1);
  }

  return { ...state, retryNow };
}
