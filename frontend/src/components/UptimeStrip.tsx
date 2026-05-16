import { useMemo } from "react";
import type { UptimeDay } from "../api/publicStatus";

type Props = {
  days: UptimeDay[];
  /** How many days back to render (left = oldest, right = today). */
  totalDays?: number;
};

type Cell = {
  date: string; // ISO YYYY-MM-DD
  availability: number | null;
  samples: number;
};

/**
 * statuspage.io-style 90-day strip. Each cell = one day, coloured by
 * availability. Missing days appear as gray gaps.
 */
export default function UptimeStrip({ days, totalDays = 90 }: Props) {
  const cells = useMemo(() => buildCells(days, totalDays), [days, totalDays]);

  return (
    <div className="flex w-full items-stretch gap-px">
      {cells.map((c) => (
        <div
          key={c.date}
          title={cellTitle(c)}
          className={`h-7 flex-1 min-w-[3px] rounded-[2px] ${toneClass(c.availability)}`}
        />
      ))}
    </div>
  );
}

function buildCells(days: UptimeDay[], totalDays: number): Cell[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const out: Cell[] = [];
  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = byDate.get(key);
    out.push({
      date: key,
      availability: row ? row.availability_percent : null,
      samples: row ? row.samples : 0,
    });
  }
  return out;
}

function toneClass(avail: number | null): string {
  if (avail === null) return "bg-slate-800";
  if (avail >= 99) return "bg-emerald-500";
  if (avail >= 95) return "bg-emerald-700";
  if (avail >= 80) return "bg-amber-500";
  return "bg-red-500";
}

function cellTitle(c: Cell): string {
  if (c.availability === null) {
    return `${c.date} — no data`;
  }
  return `${c.date} — ${c.availability.toFixed(2)}% (${c.samples} samples)`;
}
