import { useLayoutEffect, useRef, type RefObject } from "react";
import { DURATION, EASING } from "@spark/ui/tokens";

const reduced = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Rows marked `data-flip="<stable key>"` inside `container` glide from
 * where they were to where they are whenever `order` changes (FLIP): a
 * reordered list reads as one move. All rows move together, no stagger
 * (a keyboard surface); new rows simply appear. None under reduced motion.
 */
export function useFlip(
  container: RefObject<HTMLElement | null>,
  order: string
) {
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const now = new Map<string, number>();
    const still = reduced();
    for (const row of root.querySelectorAll<HTMLElement>("[data-flip]")) {
      const key = row.dataset.flip!;
      const top = row.getBoundingClientRect().top;
      now.set(key, top);
      const was = last.current.get(key);
      if (still || was === undefined || Math.abs(was - top) < 1) continue;
      row.animate(
        [{ transform: `translateY(${was - top}px)` }, { transform: "none" }],
        {
          duration: DURATION.small,
          easing: `cubic-bezier(${EASING.out.join(",")})`,
        }
      );
    }
    last.current = now;
  }, [container, order]);
}
