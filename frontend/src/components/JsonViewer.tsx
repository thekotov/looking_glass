import { useState } from "react";

type Props = {
  data: unknown;
  /** When set, only paths matching this substring (case-insensitive) are shown. */
  filter?: string;
  /** Auto-expand nodes up to this depth (root = 0). Default 2. */
  defaultDepth?: number;
};

/**
 * Collapsible JSON tree. Renders unknown blobs in a way that's easier on the
 * eyes than `<pre>{JSON.stringify(...)}</pre>` — colored types, click to
 * expand/collapse, in-place key/value search.
 *
 * Designed to stay tiny: no virtualization, no editing, no custom decoders.
 * If a future result type needs nicer rendering (e.g. coloring latency by
 * threshold), build a domain-specific view instead — keep this generic.
 */
export function JsonViewer({ data, filter, defaultDepth = 2 }: Props) {
  const [search, setSearch] = useState(filter ?? "");
  return (
    <div className="rounded bg-slate-950 px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter keys/values…"
          aria-label="Filter JSON"
          className="block w-full max-w-xs rounded border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-600 focus:border-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        />
        <button
          type="button"
          onClick={() =>
            navigator.clipboard?.writeText(JSON.stringify(data, null, 2)).catch(() => undefined)
          }
          className="rounded border border-slate-800 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400 hover:bg-slate-800 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          Copy JSON
        </button>
      </div>
      <div className="font-mono text-xs leading-relaxed">
        <Node value={data} path="" depth={0} maxDepth={defaultDepth} filter={search.toLowerCase()} />
      </div>
    </div>
  );
}

type NodeProps = {
  value: unknown;
  path: string;
  depth: number;
  maxDepth: number;
  filter: string;
};

function Node({ value, path, depth, maxDepth, filter }: NodeProps) {
  const initiallyOpen = depth < maxDepth;
  const [open, setOpen] = useState(initiallyOpen);

  if (value === null) return <Atom kind="null" text="null" />;
  if (typeof value === "string") return <Atom kind="string" text={`"${value}"`} />;
  if (typeof value === "number") return <Atom kind="number" text={String(value)} />;
  if (typeof value === "boolean") return <Atom kind="boolean" text={String(value)} />;

  if (Array.isArray(value)) {
    const visible = filterArray(value, filter, path);
    return (
      <Group
        open={open}
        onToggle={() => setOpen((v) => !v)}
        opener={`[${visible.length}${visible.length !== value.length ? `/${value.length}` : ""}]`}
        emptyChar="[]"
        items={visible.length}
      >
        {visible.map(({ idx, v }) => (
          <Row key={idx} index={`${idx}`}>
            <Node
              value={v}
              path={`${path}[${idx}]`}
              depth={depth + 1}
              maxDepth={maxDepth}
              filter={filter}
            />
          </Row>
        ))}
      </Group>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const visible = filterObject(entries, filter, path);
    return (
      <Group
        open={open}
        onToggle={() => setOpen((v) => !v)}
        opener={`{${visible.length}${visible.length !== entries.length ? `/${entries.length}` : ""}}`}
        emptyChar="{}"
        items={visible.length}
      >
        {visible.map(([k, v]) => (
          <Row key={k} keyName={k}>
            <Node
              value={v}
              path={path ? `${path}.${k}` : k}
              depth={depth + 1}
              maxDepth={maxDepth}
              filter={filter}
            />
          </Row>
        ))}
      </Group>
    );
  }

  return <Atom kind="string" text={String(value)} />;
}

function Atom({ kind, text }: { kind: "string" | "number" | "boolean" | "null"; text: string }) {
  const cls = {
    string: "text-emerald-300",
    number: "text-amber-300",
    boolean: "text-blue-300",
    null: "text-slate-500",
  }[kind];
  return <span className={cls}>{text}</span>;
}

function Group({
  open,
  onToggle,
  opener,
  emptyChar,
  items,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  opener: string;
  emptyChar: string;
  items: number;
  children: React.ReactNode;
}) {
  if (items === 0) {
    return <span className="text-slate-500">{emptyChar}</span>;
  }
  return (
    <span>
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-200 focus:outline-none focus-visible:text-slate-200"
        aria-expanded={open}
      >
        <span className={`text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span>{opener}</span>
      </button>
      {open && <ul className="border-l border-slate-800 pl-3">{children}</ul>}
    </span>
  );
}

function Row({
  index,
  keyName,
  children,
}: {
  index?: string;
  keyName?: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      {keyName !== undefined && (
        <>
          <span className="text-slate-400">{`"${keyName}"`}</span>
          <span className="text-slate-600">: </span>
        </>
      )}
      {index !== undefined && (
        <>
          <span className="text-slate-600">{`[${index}]`}</span>
          <span className="text-slate-600">: </span>
        </>
      )}
      {children}
    </li>
  );
}

// Filter helpers — a value matches if any of its keys/atomic values contains the
// search term. We keep the recursive structure so users can see *where* a match
// lives. Empty filter is short-circuited at the call site.
function valueMatches(value: unknown, term: string): boolean {
  if (!term) return true;
  if (value === null) return "null".includes(term);
  if (typeof value === "string") return value.toLowerCase().includes(term);
  if (typeof value === "number" || typeof value === "boolean")
    return String(value).toLowerCase().includes(term);
  if (Array.isArray(value)) return value.some((v) => valueMatches(v, term));
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.toLowerCase().includes(term)) return true;
      if (valueMatches(v, term)) return true;
    }
    return false;
  }
  return false;
}

function filterArray(arr: unknown[], term: string, _path: string): { idx: number; v: unknown }[] {
  if (!term) return arr.map((v, idx) => ({ idx, v }));
  const out: { idx: number; v: unknown }[] = [];
  arr.forEach((v, idx) => {
    if (valueMatches(v, term)) out.push({ idx, v });
  });
  return out;
}

function filterObject(
  entries: [string, unknown][],
  term: string,
  _path: string,
): [string, unknown][] {
  if (!term) return entries;
  return entries.filter(([k, v]) => k.toLowerCase().includes(term) || valueMatches(v, term));
}
