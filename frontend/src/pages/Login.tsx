import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../i18n";

export default function Login() {
  const { login } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <h1 className="text-xl font-semibold text-slate-100">{t("login.title")}</h1>
        <p className="text-sm text-slate-400">{t("login.subtitle")}</p>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-500">{t("login.username")}</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            required
          />
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-500">{t("login.password")}</span>
          <div className="relative mt-1">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="block w-full rounded border border-slate-700 bg-slate-950 py-2 pl-3 pr-12 text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
              aria-pressed={showPassword}
              tabIndex={-1}
              className="absolute inset-y-0 right-2 my-1 rounded px-2 text-[10px] uppercase tracking-wide text-slate-500 hover:bg-slate-800 hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              {showPassword ? t("login.hide") : t("login.show")}
            </button>
          </div>
        </label>

        {error && (
          <p className="rounded bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded bg-slate-100 px-4 py-2 font-medium text-slate-900 transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting && (
            <span className="inline-block h-3 w-3 motion-safe:animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          )}
          {submitting ? t("common.signingIn") : t("common.signIn")}
        </button>
      </form>
    </main>
  );
}
