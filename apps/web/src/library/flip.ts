import { useLayoutEffect, useRef, type RefObject } from "react";
import { DURATION, EASING } from "@spark/ui/tokens";

/**
 * Rows marked `data-flip="<stable key>"` inside `container` glide from
 * where they were to where they are when `order` changes within the same
 * `group` (the full answer reordering the instant one for the same query),
 * never on a new group (a keystroke). All rows move together, no stagger
 * (a keyboard surface); new rows simply appear. None under reduced motion.
 * Positions are `offsetTop`, so list scroll and running glides do not count.
 */
export function useFlip(
  container: RefObject<HTMLElement | null>,
  order: string,
  group: string
) {
  const last = useRef({ group, tops: new Map<string, number>() });
  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const tops = new Map<string, number>();
    const glide =
      last.current.group === group &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const row of root.querySelectorAll<HTMLElement>("[data-flip]")) {
      const key = row.dataset.flip!;
      tops.set(key, row.offsetTop);
      const was = last.current.tops.get(key);
      if (!glide || was === undefined || was === row.offsetTop) continue;
      row.animate(
        [
          { transform: `translateY(${was - row.offsetTop}px)` },
          { transform: "none" },
        ],
        {
          duration: DURATION.small,
          easing: `cubic-bezier(${EASING.out.join(",")})`,
        }
      );
    }
    last.current = { group, tops };
  }, [container, order, group]);
}
