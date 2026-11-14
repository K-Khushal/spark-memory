import { useLayoutEffect, type RefObject } from "react";

/**
 * Keeps whatever a sticky bar covers out of the way of focus: the page's
 * `scroll-padding-top` follows the bar's height, so Tab, arrow keys and
 * anchors all scroll a focused control below it (WCAG 2.4.11). The bar is
 * `md:hidden`, so on a desktop its height, and the padding, is 0.
 */
export function useStickyInset(bar: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.scrollPaddingTop = `${el.offsetHeight}px`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("scroll-padding-top");
    };
  }, [bar]);
}
