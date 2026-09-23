import { useEffect, useState } from "react";

/** Must match --duration-exit in styles/foundation.css. */
export const OVERLAY_EXIT_MS = 140;

/**
 * Keeps a conditionally rendered overlay mounted long enough to play its exit
 * transition. Pass the value that drives rendering (null/false when closed);
 * render while `value` is non-null and set `data-state={closing ? "closed" :
 * "open"}` so CSS can transition out. Enter motion comes from @starting-style.
 */
export const usePresence = <T,>(current: T | null | false, exitMs: number) => {
  const [retained, setRetained] = useState<T | null>(current || null);

  // Adopt the latest open value during render so the overlay never shows
  // stale content for a frame.
  if (current && current !== retained) setRetained(current);

  useEffect(() => {
    if (current || retained === null) return;
    const timer = window.setTimeout(() => setRetained(null), exitMs);
    return () => window.clearTimeout(timer);
  }, [current, retained, exitMs]);

  return { value: current || retained, closing: !current && retained !== null };
};
