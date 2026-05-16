export type ChipOption<T extends string> = {
  value: T;
  label: string;
  count?: number;
  tone?: "default" | "emerald" | "amber" | "red" | "blue";
};

type Props<T extends string> = {
  options: ChipOption<T>[];
  value: T[];
  /** When true, only one chip is active at a time; clicking the active chip clears it. */
  single?: boolean;
  onChange: (next: T[]) => void;
  ariaLabel?: string;
};

const TONE_CLS: Record<NonNullable<ChipOption<string>["tone"]>, string> = {
  default: "border-slate-700 text-slate-300",
  emerald: "border-emerald-900 text-emerald-300",
  amber: "border-amber-900 text-amber-300",
  red: "border-red-900 text-red-300",
  blue: "border-blue-900 text-blue-300",
};

const ACTIVE_TONE_CLS: Record<NonNullable<ChipOption<string>["tone"]>, string> = {
  default: "border-slate-100 bg-slate-100 text-slate-900",
  emerald: "border-emerald-400 bg-emerald-400 text-slate-900",
  amber: "border-amber-400 bg-amber-400 text-slate-900",
  red: "border-red-400 bg-red-400 text-slate-50",
  blue: "border-blue-400 bg-blue-400 text-slate-900",
};

export function FilterChips<T extends string>({
  options,
  value,
  single,
  onChange,
  ariaLabel,
}: Props<T>) {
  function toggle(v: T) {
    if (single) {
      onChange(value.includes(v) ? [] : [v]);
      return;
    }
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const active = value.includes(opt.value);
        const tone = opt.tone ?? "default";
        const cls = active ? ACTIVE_TONE_CLS[tone] : `bg-slate-900 hover:bg-slate-800 ${TONE_CLS[tone]}`;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] uppercase tracking-wide focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${cls}`}
          >
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={`rounded-sm px-1 text-[10px] ${
                  active ? "bg-slate-900/20" : "bg-slate-800/80 text-slate-400"
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
