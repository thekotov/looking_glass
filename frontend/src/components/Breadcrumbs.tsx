import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type Crumb = {
  /** Link target; omit for the current (last) crumb. */
  to?: string;
  label: ReactNode;
  /** Monospace styling for ids/targets/hostnames. */
  mono?: boolean;
};

/**
 * Inline breadcrumb trail: `Tasks › ping cloudflare.com › #abc123ef`.
 * Last crumb is rendered as plain text, intermediates as links.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex flex-wrap items-center gap-1 text-sm"
    >
      {items.map((c, i) => {
        const last = i === items.length - 1;
        const text = (
          <span className={c.mono ? "font-mono" : ""}>{c.label}</span>
        );
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-700">›</span>}
            {last || !c.to ? (
              <span className={last ? "text-slate-100" : "text-slate-400"}>{text}</span>
            ) : (
              <Link to={c.to} className="text-slate-500 hover:text-slate-200">
                {text}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
