const TOKEN_KEY = "lg.access_token";
const REFRESH_KEY = "lg.refresh_token";

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// Subscribers notified when the auth state is invalidated (failed refresh).
// AuthProvider attaches to this to clear the cached user without prop-drilling.
type AuthListener = () => void;
const authListeners = new Set<AuthListener>();
export function onAuthInvalidated(l: AuthListener): () => void {
  authListeners.add(l);
  return () => authListeners.delete(l);
}
function emitAuthInvalidated() {
  clearTokens();
  for (const l of authListeners) l();
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function rawRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const message =
      (payload && typeof payload === "object" && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : null) || `HTTP ${res.status}`;
    throw new ApiError(res.status, payload, message);
  }
  return payload as T;
}

// Coalesce concurrent refresh attempts. If 20 requests all 401 at once,
// we only POST /auth/refresh once and every caller awaits the same promise.
let refreshInFlight: Promise<string | null> | null = null;
async function tryRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      type Pair = { access_token: string; refresh_token: string };
      const pair = await rawRequest<Pair>(
        "POST",
        "/api/auth/refresh",
        { refresh_token: refresh },
      );
      setTokens(pair.access_token, pair.refresh_token);
      return pair.access_token;
    } catch {
      emitAuthInvalidated();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await rawRequest<T>(method, path, body, getAccessToken());
  } catch (err) {
    // Only retry once, only on 401, only when we have a refresh token, and
    // never for /auth/* itself (login/refresh errors must surface as-is).
    if (
      err instanceof ApiError &&
      err.status === 401 &&
      !path.startsWith("/api/auth/")
    ) {
      const fresh = await tryRefresh();
      if (fresh) return rawRequest<T>(method, path, body, fresh);
    }
    throw err;
  }
}

export async function apiPublic<T>(method: string, path: string, body?: unknown): Promise<T> {
  return rawRequest<T>(method, path, body);
}
