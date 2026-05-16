import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "../i18n";
import { CommandPalette } from "./CommandPalette";

/**
 * Global keyboard layer:
 *   Cmd/Ctrl-K        — open command palette
 *   g a / g t / g d / g s / g r — go to Agents/Tasks/Dashboard/Schedules/Targets
 *   n                 — new task (only outside text inputs)
 *   /                 — focus first search input on the page
 *   ?                 — show shortcut help
 *
 * Tries to be a polite citizen: ignores key events while the user is typing
 * in inputs, textareas, or contentEditable.
 */
export function GlobalShortcuts() {
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Two-key chord state: "g_" means we just saw `g` and are awaiting the
  // second key. Cleared after 1.2s or any other key.
  useEffect(() => {
    let pendingG = false;
    let timer: number | null = null;
    function clearPending() {
      pendingG = false;
      if (timer) { window.clearTimeout(timer); timer = null; }
    }

    function isTyping(e: KeyboardEvent): boolean {
      const target = e.target as HTMLElement | null;
      if (!target) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    }

    function onKeyDown(e: KeyboardEvent) {
      const k = e.key;

      // Cmd/Ctrl-K always works, even inside inputs.
      if ((e.metaKey || e.ctrlKey) && (k === "k" || k === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }

      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) {
        clearPending();
        return;
      }

      // "?" — open help.
      if (k === "?") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }

      // "/" — focus the first search input on the page.
      if (k === "/") {
        const el = document.querySelector<HTMLInputElement>(
          'input[type="search"], input[role="searchbox"], input[name="search"]',
        );
        if (el) {
          e.preventDefault();
          el.focus();
          el.select();
        }
        return;
      }

      // Single-key actions.
      if (k === "n") {
        // Dispatch a custom event so the Tasks page can pick it up if open.
        // No-op elsewhere — keeps the shortcut layer route-agnostic.
        const evt = new CustomEvent("lg:new-task");
        window.dispatchEvent(evt);
        return;
      }

      // Chord "g X" navigation.
      if (k === "g") {
        e.preventDefault();
        pendingG = true;
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(clearPending, 1200);
        return;
      }
      if (pendingG) {
        e.preventDefault();
        clearPending();
        const dest = G_NAV[k];
        if (dest) navigate(dest);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearPending();
    };
  }, [navigate]);

  // Close palette/help on route change (clean state).
  useEffect(() => {
    setPaletteOpen(false);
    setHelpOpen(false);
  }, [location.pathname]);

  return (
    <>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNewTask={() => {
          setPaletteOpen(false);
          window.dispatchEvent(new CustomEvent("lg:new-task"));
          navigate("/tasks");
        }}
      />
      {helpOpen && <ShortcutHelp t={t} onClose={() => setHelpOpen(false)} />}
    </>
  );
}

const G_NAV: Record<string, string> = {
  a: "/agents",
  t: "/tasks",
  d: "/dashboard",
  s: "/schedules",
  r: "/targets",
  v: "/availability",
};

function ShortcutHelp({ t, onClose }: { t: (k: string) => string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 id="shortcut-help-title" className="text-sm font-semibold text-slate-100">
            {t("shortcuts.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("create.close")}
            className="text-slate-500 hover:text-slate-300"
          >
            ×
          </button>
        </header>
        <ul className="mt-3 space-y-1.5 text-xs text-slate-300">
          <Row k="⌘/Ctrl K" label={t("shortcuts.palette")} />
          <Row k="g d" label={t("shortcuts.goDashboard")} />
          <Row k="g a" label={t("shortcuts.goAgents")} />
          <Row k="g t" label={t("shortcuts.goTasks")} />
          <Row k="g s" label={t("shortcuts.goSchedules")} />
          <Row k="g r" label={t("shortcuts.goTargets")} />
          <Row k="n" label={t("shortcuts.newTask")} />
          <Row k="/" label={t("shortcuts.focusSearch")} />
          <Row k="?" label={t("shortcuts.help")} />
        </ul>
      </div>
    </div>
  );
}

function Row({ k, label }: { k: string; label: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <kbd className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
        {k}
      </kbd>
    </li>
  );
}
