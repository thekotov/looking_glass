const STORAGE_KEY = "lg.recentTargets";
const MAX_ITEMS = 10;

export function getRecentTargets(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentTarget(target: string): void {
  const t = target.trim();
  if (!t) return;
  try {
    const cur = getRecentTargets().filter((x) => x !== t);
    cur.unshift(t);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cur.slice(0, MAX_ITEMS)));
  } catch {
    // ignore storage failures
  }
}
