type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
};

export function SearchInput({ value, onChange, placeholder, ariaLabel, className }: Props) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-slate-500"
      >
        ⌕
      </span>
      <input
        type="search"
        aria-label={ariaLabel ?? "Search"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="block w-full rounded border border-slate-700 bg-slate-950 py-1.5 pl-7 pr-7 text-sm text-slate-100 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange("")}
          className="absolute inset-y-0 right-2 flex items-center text-slate-500 hover:text-slate-200 focus:outline-none focus-visible:text-slate-200"
        >
          ✕
        </button>
      )}
    </div>
  );
}
