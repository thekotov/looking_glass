import { isPinned, togglePin, usePins, type PinScope } from "../lib/pins";

type Props = {
  scope: PinScope;
  id: string;
  size?: "sm" | "md";
};

/**
 * Tiny ⭐ toggle. Pinned items bubble to the top of the relevant page list
 * and surface in Cmd+K. State is global localStorage so /agents and the
 * map agree about what's pinned.
 */
export function PinButton({ scope, id, size = "sm" }: Props) {
  // Subscribe so the click on this button re-renders us immediately. We
  // also call isPinned() against the snapshot so unrelated rerenders don't
  // care about other items.
  usePins(scope);
  const pinned = isPinned(scope, id);
  const dim = size === "sm" ? "text-sm" : "text-base";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        togglePin(scope, id);
      }}
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin" : "Pin"}
      title={pinned ? "Unpin" : "Pin"}
      className={`shrink-0 rounded px-1 leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${dim} ${
        pinned ? "text-amber-300" : "text-slate-600 hover:text-amber-300"
      }`}
    >
      {pinned ? "★" : "☆"}
    </button>
  );
}
