import { useState, type KeyboardEvent } from "react";
import { useT } from "../i18n";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Optional list of tags that already exist across other agents — shown as suggestion chips. */
  suggestions?: string[];
  disabled?: boolean;
};

/** Chip-style tag editor. Adds tag on Enter, comma, or blur. Backspace on empty input removes the last chip. */
export default function TagsEditor({
  value,
  onChange,
  placeholder,
  suggestions = [],
  disabled = false,
}: Props) {
  const { t } = useT();
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const clean = raw.trim().toLowerCase();
    if (!clean) return;
    if (clean.length > 32) return;
    if (value.includes(clean)) return;
    onChange([...value, clean]);
  }

  function remove(tag: string) {
    onChange(value.filter((x) => x !== tag));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (draft) {
        add(draft);
        setDraft("");
      }
      return;
    }
    if (e.key === "Backspace" && !draft && value.length > 0) {
      e.preventDefault();
      remove(value[value.length - 1]);
    }
  }

  const availableSuggestions = suggestions.filter((s) => !value.includes(s));

  return (
    <div className={disabled ? "opacity-60" : undefined}>
      <div className="flex flex-wrap items-center gap-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-slate-200"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove ${tag}`}
                className="text-slate-500 hover:text-slate-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => {
            if (draft) {
              add(draft);
              setDraft("");
            }
          }}
          disabled={disabled}
          placeholder={value.length === 0 ? placeholder ?? t("agents.addTag") : undefined}
          className="min-w-[6rem] flex-1 bg-transparent px-1 py-0.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none"
        />
      </div>
      {availableSuggestions.length > 0 && !disabled && (
        <div className="mt-1 flex flex-wrap gap-1">
          {availableSuggestions.slice(0, 12).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded border border-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500 hover:border-slate-600 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
