import { getAccessToken } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../i18n";

type Props = {
  // Path under /api — e.g. "/api/tasks/<id>/export" (without the .json/.csv suffix).
  basePath: string;
  filenameStem: string;
};

export default function ExportButtons({ basePath, filenameStem }: Props) {
  const { t } = useT();
  const { user } = useAuth();
  // Server requires operator+ for exports (audited). Hide for readonly so
  // they don't get a confusing 403 alert.
  const canExport = user && (user.role === "operator" || user.role === "admin");
  if (!canExport) return null;
  return (
    <div className="flex gap-2">
      <ExportLink basePath={basePath} ext="json" label={t("export.json")} filenameStem={filenameStem} />
      <ExportLink basePath={basePath} ext="csv" label={t("export.csv")} filenameStem={filenameStem} />
    </div>
  );
}

function ExportLink({
  basePath,
  ext,
  label,
  filenameStem,
}: {
  basePath: string;
  ext: "json" | "csv";
  label: string;
  filenameStem: string;
}) {
  const { t } = useT();
  async function onClick() {
    const token = getAccessToken();
    const res = await fetch(`${basePath}.${ext}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      alert(t("export.failed", { code: res.status }));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenameStem}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
    >
      {label}
    </button>
  );
}
