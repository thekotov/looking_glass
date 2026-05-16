type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`motion-safe:animate-pulse rounded bg-slate-800/70 ${className}`}
    />
  );
}

type RowsProps = {
  rows?: number;
  cols?: number;
};

/** A block of fake table rows. Cell widths are randomised but stable per row. */
export function SkeletonRows({ rows = 5, cols = 6 }: RowsProps) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-slate-800">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-6 py-3">
          {Array.from({ length: cols }).map((_, c) => {
            const w = widthAt(r, c);
            return <Skeleton key={c} className={`h-3.5 ${w}`} />;
          })}
        </div>
      ))}
    </div>
  );
}

/** Card-style skeleton (heading + 2 body lines). */
export function SkeletonCard({ className = "" }: SkeletonProps) {
  return (
    <div className={`space-y-2 rounded-lg border border-slate-800 bg-slate-900 p-4 ${className}`}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

/** A list-row skeleton (mimics Agents/Users rows). */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <ul role="status" aria-label="Loading" className="divide-y divide-slate-800">
      {Array.from({ length: rows }).map((_, r) => (
        <li key={r} className="flex items-center justify-between px-6 py-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-7 w-20" />
        </li>
      ))}
    </ul>
  );
}

// Deterministic pseudo-random widths so skeletons don't twitch on re-renders.
const W = ["w-12", "w-16", "w-20", "w-24", "w-28", "w-32", "w-40", "w-48"] as const;
function widthAt(row: number, col: number): string {
  // Cheap hash. Stable across renders.
  const idx = (row * 7 + col * 11) % W.length;
  return W[idx];
}
