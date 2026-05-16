import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import { NavLink, useLocation } from "react-router-dom";
import { IconChevronDown } from "./icons";

type IconComp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export type DropdownItem = {
  to: string;
  label: string;
  icon?: IconComp;
};

type Props = {
  label: string;
  icon?: IconComp;
  items: DropdownItem[];
};

/**
 * NavBar dropdown grouping. Behaviour:
 *   - click to toggle (no hover-open — too touchy on tablets)
 *   - close on outside click or Esc
 *   - close after picking an item
 *   - toggle button looks "active" when any of the items matches the route
 *
 * The dropdown renders into the same layout flow with absolute positioning,
 * so it doesn't push neighbouring nav items around when open.
 */
export default function NavDropdown({ label, icon: Icon, items }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const isActive = items.some(
    (i) => pathname === i.to || pathname.startsWith(`${i.to}/`),
  );

  useEffect(() => {
    if (!open) return;
    function onMouse(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded px-3 py-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
          isActive
            ? "bg-slate-800 text-slate-100"
            : "text-slate-400 hover:text-slate-100"
        }`}
      >
        {Icon && <Icon size={14} className="opacity-80" />}
        <span>{label}</span>
        <IconChevronDown
          size={12}
          className={`opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl"
        >
          {items.map(({ to, label, icon: ItemIcon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              role="menuitem"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 text-sm transition ${
                  isActive
                    ? "bg-slate-800 text-slate-100"
                    : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                }`
              }
            >
              {ItemIcon && <ItemIcon size={14} className="opacity-80" />}
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
