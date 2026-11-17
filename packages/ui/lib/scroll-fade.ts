import { useEffect, type RefObject } from "react";

/** Distance from the end that still counts as at the end, in px. */
const END_SLACK = 1;

/**
 * Marks a scrolling region with `data-fade="true"` while it has more to read
 * below (it overflows and is not at the end), and `"false"` otherwise;
 * styles.css fades the last 24px only then. Attribute-only: scrolling never
 * renders React. Pass a ref to the region.
 */
export function useScrollFade(region: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = region.current;
    if (!element) return;
    const update = () => {
      const more =
        element.scrollHeight - element.scrollTop - element.clientHeight >
        END_SLACK;
      element.setAttribute("data-fade", String(more));
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    // Content that grows or shrinks inside the region (not the region
    // itself) changes whether it overflows.
    const resize =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    resize?.observe(element);
    const watch = () => {
      for (const child of element.children) resize?.observe(child);
    };
    watch();
    const mutation =
      typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver(() => {
            watch();
            update();
          });
    mutation?.observe(element, { childList: true });
    return () => {
      element.removeEventListener("scroll", update);
      resize?.disconnect();
      mutation?.disconnect();
      element.removeAttribute("data-fade");
    };
  }, [region]);
}
