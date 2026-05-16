import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { User } from "../api/auth";
import type { Role } from "../api/users";
import * as usersApi from "../api/users";
import { useConfirm } from "../components/ConfirmDialog";
import NavBar from "../components/NavBar";
import { SkeletonList } from "../components/Skeleton";
import { useToast } from "../components/Toast";
import { useAuth } from "../hooks/useAuth";
import { useT } from "../i18n";

const ROLES: Role[] = ["readonly", "operator", "admin"];

export default function Users() {
  const { user: me } = useAuth();
  const { t } = useT();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const q = useQuery({
    queryKey: ["users"],
    queryFn: usersApi.listUsers,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["users"] });

  return (
    <div className="min-h-screen bg-slate-950">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-100">{t("users.title")}</h1>
          <button
            onClick={() => setCreateOpen(true)}
            className="rounded bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-white"
          >
            {t("users.newUser")}
          </button>
        </div>

        <section className="rounded-lg border border-slate-800 bg-slate-900">
          {q.isLoading && <SkeletonList rows={3} />}
          {q.isError && (
            <p role="alert" className="px-6 py-4 text-sm text-red-400">
              {q.error instanceof Error ? q.error.message : t("common.failedToLoad")}
            </p>
          )}
          {q.data && (
            <ul className="divide-y divide-slate-800">
              {q.data.map((u) => (
                <UserRow key={u.id} user={u} me={me?.id} onChange={invalidate} />
              ))}
            </ul>
          )}
        </section>
      </main>

      {createOpen && (
        <CreateUserDialog onClose={() => setCreateOpen(false)} onCreated={invalidate} />
      )}
    </div>
  );
}

function UserRow({
  user,
  me,
  onChange,
}: {
  user: User;
  me: string | undefined;
  onChange: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<Role>(user.role as Role);
  const [pwd, setPwd] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const patch: { role?: Role; password?: string } = {};
      if (role !== user.role) patch.role = role;
      if (pwd) patch.password = pwd;
      if (Object.keys(patch).length === 0) return Promise.resolve(user);
      return usersApi.updateUser(user.id, patch);
    },
    onSuccess: () => {
      setEditing(false);
      setPwd("");
      onChange();
      toast.success(t("common.save"), user.username);
    },
    onError: (err) =>
      toast.error(t("common.save"), err instanceof Error ? err.message : String(err)),
  });

  const remove = useMutation({
    mutationFn: () => usersApi.deleteUser(user.id),
    onSuccess: () => {
      toast.info(t("common.delete"), user.username);
      onChange();
    },
    onError: (err) =>
      toast.error(t("common.delete"), err instanceof Error ? err.message : String(err)),
  });

  const isSelf = user.id === me;

  return (
    <li className="px-6 py-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-slate-100">{user.username}</span>
            {isSelf && (
              <span className="text-[10px] uppercase tracking-wide text-slate-500">{t("common.you")}</span>
            )}
            <RoleBadge role={user.role as Role} />
          </div>
          <p className="text-xs text-slate-500">
            {t("users.createdAt", { date: new Date(user.created_at).toLocaleString() })}
          </p>
        </div>
        <div className="flex gap-2">
          {!editing ? (
            <>
              <button
                onClick={() => setEditing(true)}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                {t("common.edit")}
              </button>
              {!isSelf && (
                <button
                  onClick={async () => {
                    const ok = await confirm({
                      title: t("users.confirmDelete", { name: user.username }),
                      danger: true,
                      confirmLabel: t("common.delete"),
                    });
                    if (ok) remove.mutate();
                  }}
                  className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950"
                >
                  {t("common.delete")}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(false)}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-900 hover:bg-white disabled:opacity-50"
              >
                {t("common.save")}
              </button>
            </>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">{t("users.role")}</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              {t("users.newPassword")}
            </span>
            <input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            />
          </label>
          {save.error && (
            <p className="col-span-2 text-xs text-red-400">
              {save.error instanceof Error ? save.error.message : String(save.error)}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("readonly");

  const m = useMutation({
    mutationFn: () => usersApi.createUser({ username, password, role }),
    onSuccess: () => {
      onCreated();
      onClose();
      toast.success(t("users.newUser"), username);
    },
    onError: (err) =>
      toast.error(t("users.newUser"), err instanceof Error ? err.message : String(err)),
  });

  const strength = passwordStrength(password);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    m.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-6"
      >
        <h2 className="text-lg font-semibold text-slate-100">{t("users.dialogNew")}</h2>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-500">{t("login.username")}</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            {t("users.passwordHint")}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            aria-describedby="password-strength"
            className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          />
          <PasswordStrengthBar score={strength.score} label={strength.label} tone={strength.tone} />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-500">{t("users.role")}</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="mt-1 block w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {m.error && (
          <p className="rounded bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {m.error instanceof Error ? m.error.message : String(m.error)}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={m.isPending}
            className="rounded bg-slate-100 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white disabled:opacity-50"
          >
            {m.isPending ? t("common.creating") : t("common.create")}
          </button>
        </div>
      </form>
    </div>
  );
}

type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  tone: "red" | "amber" | "blue" | "emerald";
};

function passwordStrength(pwd: string): PasswordStrength {
  if (pwd.length === 0) return { score: 0, label: "—", tone: "red" };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd)) score++;
  const clamped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const labels = ["very weak", "weak", "fair", "good", "strong"] as const;
  const tones = ["red", "red", "amber", "blue", "emerald"] as const;
  return { score: clamped, label: labels[clamped], tone: tones[clamped] };
}

function PasswordStrengthBar({
  score,
  label,
  tone,
}: {
  score: number;
  label: string;
  tone: "red" | "amber" | "blue" | "emerald";
}) {
  const colorBg: Record<typeof tone, string> = {
    red: "bg-red-500",
    amber: "bg-amber-500",
    blue: "bg-blue-500",
    emerald: "bg-emerald-500",
  };
  const colorText: Record<typeof tone, string> = {
    red: "text-red-300",
    amber: "text-amber-300",
    blue: "text-blue-300",
    emerald: "text-emerald-300",
  };
  return (
    <div id="password-strength" className="mt-1.5">
      <div className="flex h-1 gap-0.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-full flex-1 rounded ${i < score ? colorBg[tone] : "bg-slate-800"}`}
          />
        ))}
      </div>
      <p className={`mt-1 text-[10px] uppercase tracking-wide ${colorText[tone]}`}>{label}</p>
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const styles: Record<Role, string> = {
    admin: "bg-red-950 text-red-300 border-red-900",
    operator: "bg-blue-950 text-blue-300 border-blue-900",
    readonly: "bg-slate-800 text-slate-300 border-slate-700",
  };
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${styles[role]}`}
    >
      {role}
    </span>
  );
}
