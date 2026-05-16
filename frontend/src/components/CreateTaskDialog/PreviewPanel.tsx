import { useT } from "../../i18n";

type Props = {
  command: string;
  where: string;
  onCopy: () => void;
};

/**
 * Shows the (illustrative) shell-command preview and the routing summary.
 * The actual exec on the agent uses a whitelisted argv slice — this string
 * is purely a human-readable summary.
 */
export default function PreviewPanel({ command, where, onCopy }: Props) {
  const { t } = useT();
  return (
    <section
      className="rounded border border-slate-800 bg-slate-950/60 p-3"
      aria-label={t("create.preview")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {t("create.preview")}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="rounded border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          {t("common.copy")}
        </button>
      </div>
      <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-emerald-300">
        $ {command}
      </pre>
      <p className="mt-1 text-[11px] text-slate-400">{where}</p>
      <p className="mt-1 text-[10px] text-slate-600">{t("create.previewHint")}</p>
    </section>
  );
}
