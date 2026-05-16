import { useEffect, useState } from "react";
import { useT } from "../i18n";
import {
  currentPermission,
  isSupported,
  loadSettings,
  requestPermission,
  saveSettings,
  type NotifSettings,
} from "../lib/notifications";
import { useToast } from "./Toast";

/**
 * Small popover-style panel for browser-notification preferences. Mounted
 * inside the NavBar; clicking the bell icon toggles it.
 */
export function NotificationsButton() {
  const { t } = useT();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<NotifSettings>(() => loadSettings());
  const [perm, setPerm] = useState<NotificationPermission>(() => currentPermission());

  useEffect(() => {
    if (!open) return;
    setPerm(currentPermission());
  }, [open]);

  function patch(p: Partial<NotifSettings>) {
    const next = { ...settings, ...p };
    setSettings(next);
    saveSettings(next);
  }

  async function onEnable() {
    if (!isSupported()) {
      toast.error(t("notif.unsupported"));
      return;
    }
    const result = await requestPermission();
    setPerm(result);
    if (result === "granted") {
      patch({ enabled: true });
      toast.success(t("notif.granted"));
    } else if (result === "denied") {
      toast.warning(t("notif.denied"));
    }
  }

  const enabled = settings.enabled && perm === "granted";
  const dotTone = !isSupported() || perm === "denied"
    ? "bg-slate-700"
    : enabled
    ? "bg-emerald-400"
    : "bg-slate-500";

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("notif.title")}
        title={t("notif.title")}
        className="relative rounded border border-slate-700 px-2 py-1 text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      >
        🔔
        <span
          aria-hidden
          className={`absolute -right-0.5 -top-0.5 inline-block h-1.5 w-1.5 rounded-full ${dotTone}`}
        />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("notif.title")}
          className="absolute right-0 z-40 mt-1 w-72 rounded border border-slate-700 bg-slate-900 p-3 shadow-lg"
        >
          <h3 className="text-sm font-medium text-slate-100">{t("notif.title")}</h3>
          <p className="mt-1 text-[10px] text-slate-500">{t("notif.subtitle")}</p>

          {!isSupported() ? (
            <p className="mt-3 rounded bg-slate-950 px-2 py-1 text-xs text-amber-300">
              {t("notif.unsupported")}
            </p>
          ) : perm === "denied" ? (
            <p className="mt-3 rounded bg-slate-950 px-2 py-1 text-xs text-amber-300">
              {t("notif.deniedHint")}
            </p>
          ) : perm === "default" ? (
            <button
              type="button"
              onClick={onEnable}
              className="mt-3 w-full rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            >
              {t("notif.enable")}
            </button>
          ) : (
            <div className="mt-3 space-y-1">
              <Toggle
                label={t("notif.master")}
                checked={settings.enabled}
                onChange={(v) => patch({ enabled: v })}
              />
              <div className={settings.enabled ? "" : "opacity-50 pointer-events-none"}>
                <Toggle
                  label={t("notif.taskFailures")}
                  checked={settings.taskFailures}
                  onChange={(v) => patch({ taskFailures: v })}
                />
                <Toggle
                  label={t("notif.agentOffline")}
                  checked={settings.agentOffline}
                  onChange={(v) => patch({ agentOffline: v })}
                />
                <Toggle
                  label={t("notif.agentRecovered")}
                  checked={settings.agentRecovered}
                  onChange={(v) => patch({ agentRecovered: v })}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded px-1 py-1 hover:bg-slate-800/60">
      <span className="text-xs text-slate-200">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-950 accent-emerald-500"
      />
    </label>
  );
}
