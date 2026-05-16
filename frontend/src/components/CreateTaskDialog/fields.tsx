// Small input primitives used by the per-task-type field groups.
// Kept tiny and prop-driven so the parent dialog stays the source of truth
// for the `opts` object — these components are dumb renderers.

export function NumField({
  label, k, def, min, max, set, num, tip,
}: {
  label: string; k: string; def: number; min: number; max: number;
  set: (k: string, v: unknown) => void; num: (k: string, def: number) => number;
  tip?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1 text-xs uppercase tracking-wide text-slate-500">
        {label}
        {tip && (
          <span
            tabIndex={0}
            title={tip}
            aria-label={tip}
            className="cursor-help rounded-full border border-slate-700 px-1 text-[9px] text-slate-500 hover:border-slate-500 hover:text-slate-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
          >
            ?
          </span>
        )}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={num(k, def)}
        onChange={(e) => set(k, Number(e.target.value))}
        className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      />
    </label>
  );
}

export function TextField({
  label, k, def, set, str,
}: {
  label: string; k: string; def: string;
  set: (k: string, v: unknown) => void; str: (k: string, def: string) => string;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <input
        value={str(k, def)}
        onChange={(e) => set(k, e.target.value)}
        className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      />
    </label>
  );
}

export function CheckField({
  label, k, def, set, bool,
}: {
  label: string; k: string; def: boolean;
  set: (k: string, v: unknown) => void; bool: (k: string, def: boolean) => boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={bool(k, def)}
        onChange={(e) => set(k, e.target.checked)}
        className="h-4 w-4 rounded border-slate-700 bg-slate-950"
      />
      <span className="text-sm text-slate-300">{label}</span>
    </label>
  );
}

export function SelectField({
  label, k, def, choices, set, str,
}: {
  label: string; k: string; def: string; choices: string[];
  set: (k: string, v: unknown) => void; str: (k: string, def: string) => string;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={str(k, def)}
        onChange={(e) => set(k, e.target.value)}
        className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      >
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PortListField({
  k, def, set, opts,
}: {
  k: string; def: number[];
  set: (k: string, v: unknown) => void; opts: Record<string, unknown>;
}) {
  const current = (opts[k] as number[] | undefined) ?? def;
  const text = current.join(",");
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-slate-500">
        ports (comma-separated, max 1024)
      </span>
      <input
        value={text}
        onChange={(e) => {
          const ports = e.target.value
            .split(/[,\s]+/)
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n > 0 && n <= 65535);
          set(k, ports);
        }}
        className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      />
    </label>
  );
}
