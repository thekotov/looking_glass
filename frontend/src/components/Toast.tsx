import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastTone = "success" | "error" | "info" | "warning";

type ToastAction = { label: string; onClick: () => void };

type Toast = {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  duration: number;
  action?: ToastAction;
};

type Ctx = {
  push: (t: Omit<Toast, "id" | "duration"> & { duration?: number }) => number;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<Ctx | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-emerald-800 bg-emerald-950/90 text-emerald-100",
  error: "border-red-800 bg-red-950/90 text-red-100",
  info: "border-slate-700 bg-slate-900/95 text-slate-100",
  warning: "border-amber-800 bg-amber-950/90 text-amber-100",
};

const TONE_DOT: Record<ToastTone, string> = {
  success: "bg-emerald-400",
  error: "bg-red-400",
  info: "bg-slate-400",
  warning: "bg-amber-400",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((arr) => arr.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<Ctx["push"]>(
    (t) => {
      const id = idRef.current++;
      const duration = t.duration ?? (t.tone === "error" ? 6000 : 3500);
      setToasts((arr) => [...arr, { id, duration, ...t }]);
      return id;
    },
    [],
  );

  const value = useMemo<Ctx>(
    () => ({
      push,
      dismiss,
      success: (title, description) => push({ tone: "success", title, description }),
      error: (title, description) => push({ tone: "error", title, description }),
      info: (title, description) => push({ tone: "info", title, description }),
      warning: (title, description) => push({ tone: "warning", title, description }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const id = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(id);
  }, [toast.duration, toast.id, onDismiss]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm transition ${TONE_STYLES[toast.tone]}`}
    >
      <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${TONE_DOT[toast.tone]}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-xs opacity-80">{toast.description}</p>
        )}
      </div>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
          className="-mt-0.5 self-center rounded border border-current/30 px-2 py-0.5 text-xs font-medium uppercase tracking-wide hover:bg-current/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-mr-1 -mt-1 rounded p-1 text-current/70 hover:text-current focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
