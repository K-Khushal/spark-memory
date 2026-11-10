import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { columnCount } from "./layout";
import { cn } from "./cn";

export type MasonryTile = {
  index: number;
  width: number;
  height: number;
  active: boolean;
};

type MasonryProps<T> = {
  items: readonly T[];
  getKey: (item: T) => string;
  /** width / height of the item's visual. */
  getAspect: (item: T) => number;
  getLabel: (item: T) => string;
  /** Fixed extra height under each visual (caption, chips). */
  caption?: number;
  minColumnWidth?: number;
  maxColumns?: number;
  gap?: number;
  label: string;
  className?: string;
  onOpen?: (index: number) => void;
  onPreview?: (index: number) => void;
  renderItem: (item: T, tile: MasonryTile) => ReactNode;
};

/**
 * A window-scrolled, virtualised masonry of Memories. Heights come from the
 * known aspect ratio (no measuring, so no reflow jumps). Keyboard: arrows move
 * spatially, Enter opens, Space previews.
 */
export function Masonry<T>({
  items,
  getKey,
  getAspect,
  getLabel,
  caption = 0,
  minColumnWidth = 220,
  maxColumns = 6,
  gap = 12,
  label,
  className,
  onOpen,
  onPreview,
  renderItem,
}: MasonryProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, top: 0 });
  const [active, setActive] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setBox({
        width: el.clientWidth,
        top: el.getBoundingClientRect().top + window.scrollY,
      });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const lanes = columnCount(box.width, {
    minWidth: minColumnWidth,
    gap,
    max: maxColumns,
  });
  const colWidth = Math.max(0, (box.width - gap * (lanes - 1)) / lanes);
  const sizeOf = (i: number) => {
    const item = items[i];
    return item ? Math.round(colWidth / getAspect(item)) + caption : 0;
  };

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    lanes,
    gap,
    overscan: 3,
    estimateSize: sizeOf,
    scrollMargin: box.top,
    getItemKey: (i) => (items[i] ? getKey(items[i]) : i),
  });

  useEffect(() => virtualizer.measure(), [virtualizer, colWidth, lanes, items]);

  const focusIndex = (index: number) => {
    setActive(index);
    virtualizer.scrollToIndex(index, { align: "auto" });
    requestAnimationFrame(() =>
      ref.current
        ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
        ?.focus({ preventScroll: true })
    );
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const all = virtualizer.measurementsCache;
    const here = all[active];
    if (!here) return;
    const centre = here.start + here.size / 2;
    // Nearest item in the same lane above/below, or in the next lane over.
    const inLane = (lane: number) => all.filter((m) => m.lane === lane);
    const closest = (lane: number) =>
      inLane(lane).reduce<(typeof all)[number] | undefined>(
        (best, m) =>
          !best ||
          Math.abs(m.start + m.size / 2 - centre) <
            Math.abs(best.start + best.size / 2 - centre)
            ? m
            : best,
        undefined
      );
    const sameLane = inLane(here.lane);
    const pos = sameLane.indexOf(here);
    const target = {
      ArrowDown: sameLane[pos + 1],
      ArrowUp: sameLane[pos - 1],
      ArrowRight: here.lane < lanes - 1 ? closest(here.lane + 1) : undefined,
      ArrowLeft: here.lane > 0 ? closest(here.lane - 1) : undefined,
    }[event.key];
    if (target) {
      event.preventDefault();
      focusIndex(target.index);
    } else if (event.key === "Enter") {
      onOpen?.(active);
    } else if (event.key === " ") {
      event.preventDefault();
      onPreview?.(active);
    }
  };

  return (
    <div
      ref={ref}
      role="list"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("relative w-full", className)}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {colWidth > 0 &&
        virtualizer.getVirtualItems().map((v) => {
          const item = items[v.index];
          if (!item) return null;
          return (
            <div
              key={v.key}
              role="listitem"
              data-index={v.index}
              tabIndex={v.index === active ? 0 : -1}
              aria-label={getLabel(item)}
              onFocus={() => setActive(v.index)}
              onClick={() => onOpen?.(v.index)}
              className="absolute top-0 left-0 rounded-tile outline-offset-4"
              style={{
                width: colWidth,
                height: v.size,
                transform: `translate(${v.lane * (colWidth + gap)}px, ${v.start - box.top}px)`,
              }}
            >
              {renderItem(item, {
                index: v.index,
                width: colWidth,
                height: v.size - caption,
                active: v.index === active,
              })}
            </div>
          );
        })}
    </div>
  );
}
