import { useEffect } from "react";

/**
 * Set `document.title` for the page. Pass `null`/`undefined` to skip
 * (useful while data is loading). Restores the previous title on unmount
 * so back-navigation doesn't flash with a stale title.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} — Looking Glass`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
