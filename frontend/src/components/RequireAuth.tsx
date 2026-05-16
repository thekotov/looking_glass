import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../i18n";

type Role = "readonly" | "operator" | "admin";
const ROLE_LEVELS: Record<Role, number> = { readonly: 0, operator: 1, admin: 2 };

export default function RequireAuth({
  children,
  requireRole,
}: {
  children: ReactNode;
  requireRole?: Role;
}) {
  const { user, loading } = useAuth();
  const { t } = useT();
  const location = useLocation();

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950">
        <p className="text-slate-500">{t("common.loading")}</p>
      </main>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (requireRole) {
    const have = ROLE_LEVELS[(user.role as Role) ?? "readonly"] ?? 0;
    const need = ROLE_LEVELS[requireRole];
    if (have < need) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-950">
          <div className="rounded-lg border border-slate-800 bg-slate-900 px-8 py-6 text-center">
            <p className="text-lg text-slate-100">{t("auth.forbidden")}</p>
            <p className="mt-2 text-sm text-slate-400">
              {t("auth.requiresRole", { role: requireRole, your: user.role })}
            </p>
          </div>
        </main>
      );
    }
  }

  return <>{children}</>;
}
