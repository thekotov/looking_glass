// Global WebSocket-status registry. Every reconnecting WS hook registers
// itself with a slot and updates its status; consumers (LiveIndicator)
// subscribe and aggregate. Keeps things decoupled — the indicator doesn't
// need to know which streams exist.

export type WSStatus = "connecting" | "open" | "reconnecting" | "closed" | "error";

type Slot = {
  id: number;
  label: string;
  status: WSStatus;
};

const slots = new Map<number, Slot>();
const listeners = new Set<() => void>();
let nextId = 1;

function notify() {
  for (const l of listeners) l();
}

export function registerWS(label: string): number {
  const id = nextId++;
  slots.set(id, { id, label, status: "connecting" });
  notify();
  return id;
}
export function updateWS(id: number, status: WSStatus) {
  const slot = slots.get(id);
  if (!slot || slot.status === status) return;
  slot.status = status;
  notify();
}
export function unregisterWS(id: number) {
  if (slots.delete(id)) notify();
}
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type WSAggregate = {
  total: number;
  open: number;
  connecting: number;
  reconnecting: number;
  errored: number;
};

export function snapshot(): WSAggregate {
  let open = 0;
  let connecting = 0;
  let reconnecting = 0;
  let errored = 0;
  for (const s of slots.values()) {
    if (s.status === "open") open++;
    else if (s.status === "connecting") connecting++;
    else if (s.status === "reconnecting") reconnecting++;
    else if (s.status === "error") errored++;
  }
  return { total: slots.size, open, connecting, reconnecting, errored };
}
