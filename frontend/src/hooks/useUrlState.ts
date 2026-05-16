import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Get/set a single query-string parameter. Setting `null`/`""` removes the
 * key from the URL so the address stays clean. History is replaced (not
 * pushed) so the back button still navigates between *pages*, not between
 * every keystroke in a filter input.
 *
 * Example:
 *   const [q, setQ] = useUrlState("q", "");
 *   const [sort, setSort] = useUrlState("sort", "name");
 */
export function useUrlState(key: string, defaultValue: string): [string, (v: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = raw === null ? defaultValue : raw;

  const setValue = useCallback(
    (next: string | null) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next === null || next === "" || next === defaultValue) out.delete(key);
          else out.set(key, next);
          return out;
        },
        { replace: true },
      );
    },
    [key, defaultValue, setParams],
  );

  return [value, setValue];
}

/** Multi-value version: backed by comma-separated values in the URL. */
export function useUrlStateMulti(
  key: string,
): [string[], (v: string[]) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = raw ? raw.split(",").filter(Boolean) : [];

  const setValue = useCallback(
    (next: string[]) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next.length === 0) out.delete(key);
          else out.set(key, next.join(","));
          return out;
        },
        { replace: true },
      );
    },
    [key, setParams],
  );

  return [value, setValue];
}
