// Stable, locale-aware date helpers. Keeps render output deterministic
// per-locale so two clients in the same locale always see the same string.

const ABSOLUTE_FMT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatAbsolute(input: string | number | Date | null | undefined): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  return ABSOLUTE_FMT.format(d);
}

const RTF_CACHE = new Map<string, Intl.RelativeTimeFormat>();
function rtf(locale?: string) {
  const key = locale ?? "default";
  let f = RTF_CACHE.get(key);
  if (!f) {
    f = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    RTF_CACHE.set(key, f);
  }
  return f;
}

type Step = { limit: number; div: number; unit: Intl.RelativeTimeFormatUnit };
const STEPS: Step[] = [
  { limit: 60, div: 1, unit: "second" },
  { limit: 60 * 60, div: 60, unit: "minute" },
  { limit: 60 * 60 * 24, div: 60 * 60, unit: "hour" },
  { limit: 60 * 60 * 24 * 7, div: 60 * 60 * 24, unit: "day" },
  { limit: 60 * 60 * 24 * 30, div: 60 * 60 * 24 * 7, unit: "week" },
  { limit: 60 * 60 * 24 * 365, div: 60 * 60 * 24 * 30, unit: "month" },
  { limit: Infinity, div: 60 * 60 * 24 * 365, unit: "year" },
];

export function formatRelative(
  input: string | number | Date | null | undefined,
  locale?: string,
): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return "—";
  const seconds = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const step = STEPS.find((s) => abs < s.limit) ?? STEPS[STEPS.length - 1];
  const value = Math.round(seconds / step.div);
  return rtf(locale).format(value, step.unit);
}
