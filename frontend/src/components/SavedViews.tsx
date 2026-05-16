import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useToast } from "./Toast";
import { useT } from "../i18n";

type Props = {
  /** Scope key — views are namespaced per page (e.g. "tasks", "agents"). */
  scope: string;
  /** Optional starter views shown when the user has none of their own. */
  presets?: { name: string; query: string }[];
};

type View = { id: string; name: string; query: string };

const STORAGE_PREFIX = "lg.views.v1.";

function load(scope: string): View[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + scope);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function save(scope: string, views: View[]) {
  localStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(views.slice(0, 30)));
}

/**
 * Small "save current filters" toolbar. Reads the current URL search params
 * and exposes the option to snapshot them under a name in localStorage. Each
 * saved view is a chip that re-applies the params on click.
 *
 * Per-scope so /tasks and /agents don't share each other's pins.
 */
export function SavedViews({ scope, presets = [] }: Props) {
  const { t } = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [views, setViews] = useState<View[]>(() => load(scope));

  // Resync if another tab edited the same scope.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_PREFIX + scope) setViews(load(scope));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [scope]);

  function onSave() {
    const name = window.prompt(t("views.namePrompt"));
    if (!name?.trim()) return;
    const query = location.search.replace(/^\?/, "");
    if (!query) {
      toast.warning(t("views.empty"));
      return;
    }
    const list = load(scope);
    const existing = list.findIndex((v) => v.name === name);
    const entry: View = {
      id: existing >= 0 ? list[existing].id : `v_${Date.now().toString(36)}`,
      name: name.trim(),
      query,
    };
    if (existing >= 0) list[existing] = entry;
    else list.unshift(entry);
    save(scope, list);
    setViews(list);
    toast.success(t("views.saved"), name);
  }

  function apply(query: string) {
    navigate({ pathname: location.pathname, search: query });
  }

  function remove(id: string) {
    const next = views.filter((v) => v.id !== id);
    save(scope, next);
    setViews(next);
  }

  const all: { name: string; query: string; userOwned: boolean; id?: string }[] = [
    ...views.map((v) => ({ ...v, userOwned: true })),
    ...presets
      .filter((p) => !views.some((v) => v.name === p.name))
      .map((p) => ({ ...p, userOwned: false as const })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-slate-500">
        {t("views.label")}:
      </span>
      {all.map((v) => {
        const active = ("?" + v.query) === location.search;
        return (
          <span key={(v as View).id ?? v.name} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => apply(v.query)}
              title={v.query}
              className={`rounded-l border px-2 py-0.5 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                active
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                  : "border-slate-700 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {v.userOwned ? "★" : "·"} {v.name}
            </button>
            {v.userOwned && (
              <button
                type="button"
                onClick={() => remove((v as View).id)}
                aria-label={t("common.delete")}
                title={t("common.delete")}
                className="rounded-r border border-l-0 border-slate-700 px-1 py-0.5 text-[11px] text-slate-500 hover:bg-slate-800 hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              >
                ×
              </button>
            )}
          </span>
        );
      })}
      <button
        type="button"
        onClick={onSave}
        title={t("views.saveHint")}
        className="rounded border border-dashed border-slate-700 px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      >
        + {t("views.save")}
      </button>
    </div>
  );
}
