export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };

/** Helper to derive next state when the user clicks a header. */
export function nextSort<K extends string>(
  current: SortState<K>,
  key: K,
  defaultDir: SortDir = "desc",
): SortState<K> {
  if (current.key !== key) return { key, dir: defaultDir };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

type Props<K extends string> = {
  label: string;
  sortKey: K;
  current: SortState<K>;
  onSort: (s: SortState<K>) => void;
  className?: string;
  defaultDir?: SortDir;
};

export function SortableHeader<K extends string>({
  label,
  sortKey,
  current,
  onSort,
  className,
  defaultDir = "desc",
}: Props<K>) {
  const active = current.key === sortKey;
  const indicator = active ? (current.dir === "asc" ? "▲" : "▼") : "↕";
  return (
    <th className={className} aria-sort={active ? (current.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(nextSort(current, sortKey, defaultDir))}
        className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500 hover:text-slate-300 focus:outline-none focus-visible:text-slate-200"
      >
        <span>{label}</span>
        <span className={`text-[9px] ${active ? "text-slate-300" : "text-slate-700"}`}>
          {indicator}
        </span>
      </button>
    </th>
  );
}
