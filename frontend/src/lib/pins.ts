// Pinned/watched items (agents, targets, …). Stored in localStorage,
// scoped by type so future kinds (schedules, public targets) can be added
// without changing the API. UI: ⭐ button on rows + "Pinned" section at
// the top of the list page.

import { useSyncExternalStore } from "react";

export type PinScope = "agents" | "targets";

const KEY_PREFIX = "lg.pins.v1.";
const listeners = new Map<PinScope, Set<() => void>>();

function load(scope: PinScope): string[] {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + scope);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function save(scope: PinScope, ids: string[]) {
  localStorage.setItem(KEY_PREFIX + scope, JSON.stringify(ids));
  for (const l of listeners.get(scope) ?? []) l();
}

export function getPins(scope: PinScope): string[] {
  return load(scope);
}
export function isPinned(scope: PinScope, id: string): boolean {
  return load(scope).includes(id);
}
export function togglePin(scope: PinScope, id: string) {
  const list = load(scope);
  if (list.includes(id)) save(scope, list.filter((x) => x !== id));
  else save(scope, [id, ...list]);
}

function subscribe(scope: PinScope, fn: () => void): () => void {
  let bucket = listeners.get(scope);
  if (!bucket) {
    bucket = new Set();
    listeners.set(scope, bucket);
  }
  bucket.add(fn);
  // Cross-tab updates.
  function onStorage(e: StorageEvent) {
    if (e.key === KEY_PREFIX + scope) fn();
  }
  window.addEventListener("storage", onStorage);
  return () => {
    bucket!.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

// Cache snapshot arrays so `useSyncExternalStore` doesn't loop on identity changes.
const snapshotCache = new Map<PinScope, string[]>();
function getSnapshot(scope: PinScope): string[] {
  const cached = snapshotCache.get(scope);
  const fresh = load(scope);
  if (
    cached &&
    cached.length === fresh.length &&
    cached.every((x, i) => x === fresh[i])
  ) {
    return cached;
  }
  snapshotCache.set(scope, fresh);
  return fresh;
}

/** Reactive accessor — re-renders the component when the pin list changes. */
export function usePins(scope: PinScope): string[] {
  return useSyncExternalStore(
    (fn) => subscribe(scope, fn),
    () => getSnapshot(scope),
    () => [],
  );
}
