// Browser-Notifications wrapper. Surfaces opt-in state, dispatches
// notifications without crashing when permission is denied or the API is
// missing (Safari private mode, some embedded webviews).

const SETTINGS_KEY = "lg.notifications.v1";

export type NotifSettings = {
  /** Master switch. */
  enabled: boolean;
  /** Notify on tasks that finished with failed/timeout. */
  taskFailures: boolean;
  /** Notify when an agent goes offline (transition active→offline). */
  agentOffline: boolean;
  /** Notify when an agent comes back online after being offline. */
  agentRecovered: boolean;
};

const DEFAULTS: NotifSettings = {
  enabled: false,
  taskFailures: true,
  agentOffline: true,
  agentRecovered: false,
};

export function isSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function currentPermission(): NotificationPermission {
  if (!isSupported()) return "denied";
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!isSupported()) return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function loadSettings(): NotifSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: NotifSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

type FireOpts = {
  title: string;
  body?: string;
  /** Click handler — focuses the tab and may navigate. */
  onClick?: () => void;
  /** Dedup tag — newer messages with the same tag replace older ones. */
  tag?: string;
};

export function notify(opts: FireOpts): boolean {
  if (!isSupported()) return false;
  if (Notification.permission !== "granted") return false;
  // Suppress when the tab is foreground & visible — user can see what's
  // happening, no point doubling up with toasts.
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    return false;
  }
  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: "/favicon.ico",
    });
    n.onclick = () => {
      window.focus();
      opts.onClick?.();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
