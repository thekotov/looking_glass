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
import { useT } from "../i18n";

type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PendingConfirm = ConfirmOptions & {
  resolve: (ok: boolean) => void;
};

type Ctx = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<Ctx | null>(null);

/**
 * Drop-in replacement for `window.confirm()` that renders in-app instead of a
 * browser dialog. Use:
 *
 *   const ok = await confirm({ title: "Delete X?", danger: true });
 *   if (ok) doDelete();
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  const value = useMemo<Ctx>(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmModal
          options={pending}
          onAnswer={(ok) => {
            pending.resolve(ok);
            setPending(null);
          }}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmModal({
  options,
  onAnswer,
}: {
  options: ConfirmOptions;
  onAnswer: (ok: boolean) => void;
}) {
  const { t } = useT();
  const confirmBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmBtn.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onAnswer(false);
      if (e.key === "Enter") onAnswer(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);

  const confirmTone = options.danger
    ? "bg-red-700 text-white hover:bg-red-600"
    : "bg-slate-100 text-slate-900 hover:bg-white";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onAnswer(false);
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <h2 id="confirm-title" className="text-base font-semibold text-slate-100">
          {options.title}
        </h2>
        {options.body && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">{options.body}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            {options.cancelLabel ?? t("common.cancel")}
          </button>
          <button
            ref={confirmBtn}
            type="button"
            onClick={() => onAnswer(true)}
            className={`rounded px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${confirmTone}`}
          >
            {options.confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmDialogProvider>");
  return ctx.confirm;
}
