// Saved task templates live in localStorage. They store a partial of the
// CreateTaskDialog form so picking one re-hydrates the dialog. We don't
// version the format yet — corrupt entries are dropped on read.

import type { CreateTaskInitial } from "../components/CreateTaskDialog";

const KEY = "lg.taskTemplates.v1";
const MAX = 30;

export type SavedTemplate = {
  id: string;
  name: string;
  createdAt: number;
  data: CreateTaskInitial;
};

export function loadTemplates(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x) =>
        x &&
        typeof x.id === "string" &&
        typeof x.name === "string" &&
        typeof x.createdAt === "number" &&
        x.data,
    );
  } catch {
    return [];
  }
}

function save(list: SavedTemplate[]) {
  // Capped so a runaway loop can't fill the quota.
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
}

export function saveTemplate(name: string, data: CreateTaskInitial): SavedTemplate {
  const list = loadTemplates();
  // Replace by name if exists, otherwise prepend so newest comes first.
  const existing = list.findIndex((t) => t.name === name);
  const entry: SavedTemplate = {
    id: existing >= 0 ? list[existing].id : `tmpl_${Date.now().toString(36)}`,
    name,
    createdAt: Date.now(),
    data,
  };
  if (existing >= 0) list[existing] = entry;
  else list.unshift(entry);
  save(list);
  return entry;
}

export function deleteTemplate(id: string) {
  save(loadTemplates().filter((t) => t.id !== id));
}
