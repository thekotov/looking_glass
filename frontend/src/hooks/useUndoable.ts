import { useCallback } from "react";
import { useToast } from "../components/Toast";

type Opts = {
  /** Optimistic UI change: do this before the toast appears. */
  preview: () => void;
  /** Server side commit. Fires after the grace period if user didn't undo. */
  commit: () => Promise<unknown>;
  /** Roll the UI back to what it was before `preview`. Called on Undo or commit failure. */
  revert: () => void;
  /** Toast title shown immediately. */
  title: string;
  description?: string;
  /** Title shown if `commit` throws. */
  errorTitle?: string;
  /** Grace window in ms. Default 6 s — matches Gmail/Linear. */
  graceMs?: number;
  /** Toast button label. Default "Undo". */
  undoLabel?: string;
};

/**
 * Gmail-style soft-action: render the optimistic UI change instantly, show a
 * dismissable toast with an Undo button, and only fire the real server call
 * after the grace window expires. If `commit` fails the UI rolls back too.
 *
 * Returns a function so callers can wire it to onClick handlers without
 * caring about timer plumbing.
 */
export function useUndoable() {
  const toast = useToast();
  return useCallback(
    (o: Opts) => {
      const grace = o.graceMs ?? 6000;
      o.preview();
      let cancelled = false;
      const timer = window.setTimeout(async () => {
        if (cancelled) return;
        try {
          await o.commit();
        } catch (err) {
          o.revert();
          toast.error(
            o.errorTitle ?? "Action failed",
            err instanceof Error ? err.message : String(err),
          );
        }
      }, grace);
      toast.push({
        tone: "info",
        title: o.title,
        description: o.description,
        duration: grace,
        action: {
          label: o.undoLabel ?? "Undo",
          onClick: () => {
            cancelled = true;
            window.clearTimeout(timer);
            o.revert();
          },
        },
      });
    },
    [toast],
  );
}
