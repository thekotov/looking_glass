import type { ReactNode } from "react";

type Props = {
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  selectAllLabel?: string;
  clearLabel?: string;
  children: ReactNode;
};

/**
 * Floating bar shown above a list when ≥1 row is selected. Stays fixed at
 * the top of the viewport on long lists. Action buttons are slotted via
 * `children` so each page can wire its own bulk operations.
 */
export function BulkActionBar({
  count,
  total,
  onSelectAll,
  onClear,
  selectAllLabel = "Select all",
  clearLabel = "Clear",
  children,
}: Props) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-700/50 bg-emerald-950/70 px-3 py-2 text-sm shadow-lg backdrop-blur-sm"
    >
      <span className="font-medium text-emerald-200">{count} selected</span>
      {count < total && (
        <button
          type="button"
          onClick={onSelectAll}
          className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          {selectAllLabel} ({total})
        </button>
      )}
      <button
        type="button"
        onClick={onClear}
        className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        {clearLabel}
      </button>
      <span className="grow" />
      {children}
    </div>
  );
}
