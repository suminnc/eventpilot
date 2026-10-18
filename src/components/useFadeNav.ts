"use client";
import { useCallback, useRef, useState } from "react";

/**
 * Fade-out-then-switch navigation. Call `go(fn)` instead of changing view state directly:
 * the current view fades out, then `fn` runs and the new view fades in via `.page-in`.
 * Put `fadeClass` and `page-fade page-in` on a wrapper keyed by the current view.
 */
export function useFadeNav({ ms = 180, scrollTop = false }: { ms?: number; scrollTop?: boolean } = {}) {
  const [fading, setFading] = useState(false);
  const busy = useRef(false);

  const go = useCallback(
    (fn: () => void) => {
      if (busy.current) return;
      const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        fn();
        if (scrollTop) window.scrollTo({ top: 0 });
        return;
      }
      busy.current = true;
      setFading(true);
      window.setTimeout(() => {
        fn();
        if (scrollTop) window.scrollTo({ top: 0 });
        setFading(false);
        busy.current = false;
      }, ms);
    },
    [ms, scrollTop],
  );

  return { go, fading, fadeClass: fading ? "opacity-0" : "" };
}
