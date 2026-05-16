import type { ComponentType, SVGProps } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../i18n";
import type { Lang } from "../i18n/translations";
import { useTheme } from "../theme";
import {
  IconAgents,
  IconAudit,
  IconAvailability,
  IconDashboard,
  IconManage,
  IconPublic,
  IconSchedules,
  IconTargets,
  IconTasks,
  IconUsers,
} from "./icons";
import { LiveIndicator } from "./LiveIndicator";
import NavDropdown, { type DropdownItem } from "./NavDropdown";
import { NotificationsButton } from "./NotificationsSettings";

type IconComp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export default function NavBar() {
  const { user, logout } = useAuth();
  const { t } = useT();
  const isAdmin = user?.role === "admin";

  return (
    <header className="border-b border-slate-800 bg-slate-900">
      {/*
        Two-column grid: left grows and wraps internally, right always
        sits in its own cell on the same row. Means the theme/lang/user
        controls never wrap to a second line, even when nav items push
        the brand+nav block to grow tall.
      */}
      <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto] items-center gap-x-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 sm:gap-x-6">
          <span className="shrink-0 font-semibold text-slate-100">Looking Glass</span>
          <nav className="flex flex-wrap gap-1 text-sm">
            <NavTab to="/dashboard" label={t("nav.dashboard")} icon={IconDashboard} />
            <NavTab to="/availability" label={t("nav.availability")} icon={IconAvailability} />
            <NavTab to="/targets" label={t("nav.targets")} icon={IconTargets} />
            <NavTab to="/schedules" label={t("nav.schedules")} icon={IconSchedules} />
            <NavTab to="/tasks" label={t("nav.tasks")} icon={IconTasks} />
            <NavDropdown
              label={t("nav.manage")}
              icon={IconManage}
              items={manageItems(t, isAdmin)}
            />
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm sm:gap-3">
          <LiveIndicator />
          <NotificationsButton />
          <ThemeToggle />
          <LangSwitcher />
          <span className="hidden text-slate-500 md:inline">
            {user?.username} <span className="text-slate-700">·</span>
            <RoleTag role={user?.role ?? "readonly"} />
          </span>
          <button
            onClick={logout}
            aria-label={t("common.signOut")}
            title={user?.username ? `${user.username} — ${t("common.signOut")}` : t("common.signOut")}
            className="rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            <span className="hidden sm:inline">{t("common.signOut")}</span>
            <span className="sm:hidden">⎋</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function manageItems(
  t: (k: string) => string,
  isAdmin: boolean,
): DropdownItem[] {
  const items: DropdownItem[] = [
    { to: "/agents", label: t("nav.agents"), icon: IconAgents },
  ];
  if (isAdmin) {
    items.push({ to: "/users", label: t("nav.users"), icon: IconUsers });
    items.push({ to: "/audit", label: t("nav.audit"), icon: IconAudit });
    items.push({
      to: "/admin/public-targets",
      label: t("nav.publicTargets"),
      icon: IconPublic,
    });
  }
  return items;
}

function LangSwitcher() {
  const { lang, setLang, t } = useT();
  const langs: Lang[] = ["ru", "en"];
  return (
    <div
      role="group"
      aria-label={t("lang.label")}
      className="inline-flex overflow-hidden rounded border border-slate-700"
    >
      {langs.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          aria-label={t(`lang.${l}`)}
          className={`px-2 py-0.5 text-[11px] uppercase transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
            lang === l
              ? "bg-slate-100 text-slate-900"
              : "text-slate-400 hover:bg-slate-800"
          }`}
          title={t(`lang.${l}`)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function NavTab({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon?: IconComp;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `inline-flex shrink-0 items-center gap-1.5 rounded px-3 py-1 transition ${
          isActive
            ? "bg-slate-800 text-slate-100"
            : "text-slate-400 hover:text-slate-100"
        }`
      }
    >
      {Icon && <Icon size={14} className="opacity-80" />}
      <span>{label}</span>
    </NavLink>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t("theme.toggle")}
      title={t("theme.toggle")}
      className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}

function RoleTag({ role }: { role: string }) {
  const tone =
    role === "admin"
      ? "text-red-300"
      : role === "operator"
      ? "text-blue-300"
      : "text-slate-300";
  return <span className={`ml-1 uppercase ${tone}`}>{role}</span>;
}
