import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { columnCount, neighbour, tabStop } from "./layout";
import { cn } from "./cn";
import { DURATION, EASING } from "./tokens";

type MasonryTile = {
  index: number;
  width: number;
  height: number;
  active: boolean;
};

/** What a parent can ask of a wall: put focus on its first or last tile. */
export type MasonryHandle = { focus: (which: "first" | "last") => void };

type MasonryProps<T> = {
  items: readonly T[];
  getKey: (item: T) => string;
  /** width / height of the item's visual. */
  getAspect?: (item: T) => number;
  getLabel: (item: T) => string;
  /** Extra height under an item's visual (caption, chips), known up front. */
  getCaption?: (item: T) => number;
  /** The visual's height at a column width, for items without a fixed aspect (text). Overrides getAspect. */
  getHeight?: (item: T, width: number) => number;
  minColumnWidth?: number;
  maxColumns?: number;
  gap?: number;
  label: string;
  className?: string;
  /**
   * When `items` change but `glideKey` stays the same (the full answer
   * reordering the instant one for one search), items that change place
   * glide there (DURATION.small, ease-out), so a reordered result reads as
   * a move, not a swap. A resize, a new key or reduced motion never glides.
   */
  glideKey?: string;
  onOpen?: (index: number) => void;
  onPreview?: (index: number) => void;
  /**
   * ↑ or ↓ pressed on the top or bottom tile of its column: there is no
   * tile further that way here, so a neighbouring wall can take focus.
   * Return true when it did; otherwise the key keeps its default (scrolling).
   */
  onEdge?: (key: "ArrowUp" | "ArrowDown") => boolean;
  handle?: Ref<MasonryHandle>;
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
  getAspect = () => 1,
  getLabel,
  getCaption = () => 0,
  getHeight,
  minColumnWidth = 220,
  maxColumns = 6,
  gap = 12,
  label,
  className,
  glideKey,
  onOpen,
  onPreview,
  onEdge,
  handle,
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
    if (!item) return 0;
    const visual = getHeight
      ? getHeight(item, colWidth)
      : colWidth / getAspect(item);
    return Math.round(visual) + getCaption(item);
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

  useImperativeHandle(handle, () => ({
    focus: (which) => focusIndex(which === "first" ? 0 : items.length - 1),
  }));

  const rendered = colWidth > 0 ? virtualizer.getVirtualItems() : [];
  const current = tabStop(
    active,
    rendered.map((v) => v.index)
  );

  // Where each rendered item stood, for the glide (FLIP on the transform).
  // Positions can settle a render after `items` change (measuring), so a
  // change keeps the glide open briefly.
  const placed = useRef({
    items,
    glideKey,
    openUntil: 0,
    at: new Map<string, string>(),
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const before = placed.current;
    const now = performance.now();
    const same = glideKey !== undefined && before.glideKey === glideKey;
    const openUntil =
      same && before.items !== items ? now + 100 : before.openUntil;
    const glide =
      same &&
      now < openUntil &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const at = new Map<string, string>();
    for (const tile of el.querySelectorAll<HTMLElement>(
      ":scope > [data-key]"
    )) {
      const to = tile.style.transform;
      at.set(tile.dataset.key!, to);
      const from = before.at.get(tile.dataset.key!);
      if (glide && from && from !== to) {
        tile.animate([{ transform: from }, { transform: to }], {
          duration: DURATION.small,
          easing: `cubic-bezier(${EASING.out.join(",")})`,
        });
      }
    }
    placed.current = { items, glideKey, openUntil: same ? openUntil : 0, at };
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (current === undefined) return;
    const target = neighbour(virtualizer.measurementsCache, current, event.key);
    if (target !== undefined) {
      event.preventDefault();
      focusIndex(target);
    } else if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      onEdge?.(event.key)
    ) {
      event.preventDefault();
    } else if (event.key === "Enter") {
      onOpen?.(current);
    } else if (event.key === " ") {
      event.preventDefault();
      onPreview?.(current);
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
      {rendered.map((v) => {
        const item = items[v.index];
        if (!item) return null;
        return (
          <div
            key={v.key}
            role="listitem"
            data-index={v.index}
            tabIndex={v.index === current ? 0 : -1}
            aria-label={getLabel(item)}
            onFocus={() => setActive(v.index)}
            onClick={() => onOpen?.(v.index)}
            data-key={v.key}
            className="absolute top-0 left-0 rounded-tile outline-offset-2"
            style={{
              width: colWidth,
              height: v.size,
              transform: `translate(${v.lane * (colWidth + gap)}px, ${v.start - box.top}px)`,
            }}
          >
            {renderItem(item, {
              index: v.index,
              width: colWidth,
              height: v.size - getCaption(item),
              active: v.index === current,
            })}
          </div>
        );
      })}
    </div>
  );
}
