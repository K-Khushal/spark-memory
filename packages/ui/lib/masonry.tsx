import { CheckIcon } from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
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

const FOCUS_KEY = "masonry:focus-key";

/**
 * Where each item last stood on the page, across walls, for one `glideKey`:
 * an item that moves from one wall to another (a Direct Match that becomes
 * Related) is a new tile in the second wall, so it glides from where the
 * first one drew it. Cleared whenever the key changes.
 */
const travel: {
  glideKey?: string;
  at: Map<string, { wall: object; x: number; y: number }>;
} = { at: new Map() };

const TRANSLATE = /translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/;

/**
 * Asks whichever wall holds the item `key` to scroll to it and focus it, once
 * it renders. False when no wall has it (it was deleted, or filtered out).
 */
export function focusMasonryKey(key: string): boolean {
  const request = { key, handled: false };
  document.dispatchEvent(new CustomEvent(FOCUS_KEY, { detail: request }));
  return request.handled;
}

export type MasonrySelection = {
  ids: readonly string[];
  choose: (id: string, mode: "toggle" | "range") => void;
  all: () => void;
  clear: () => void;
  marquee: (ids: string[], additive: boolean) => void;
};

type MasonryProps<T> = {
  selection?: MasonrySelection;
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
  /** False holds the glide for now (the wall glides only when a Memory is moved on purpose). */
  glide?: boolean;
  onOpen?: (index: number) => void;
  onPreview?: (index: number) => void;
  /**
   * ↑ or ↓ pressed on the top or bottom tile of its column: there is no
   * tile further that way here, so a neighbouring wall can take focus.
   * Return the destination id when it did; otherwise the key keeps its default (scrolling).
   */
  onEdge?: (key: "ArrowUp" | "ArrowDown") => string | undefined;
  handle?: Ref<MasonryHandle>;
  renderItem: (item: T, tile: MasonryTile) => ReactNode;
};

/**
 * A window-scrolled, virtualised masonry of Memories. Heights come from the
 * known aspect ratio (no measuring, so no reflow jumps). Keyboard: arrows move
 * spatially, Enter opens; Space toggles when selection is enabled, otherwise previews.
 */
export function Masonry<T>({
  items,
  selection,
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
  glide: gliding = true,
  onOpen,
  onPreview,
  onEdge,
  handle,
  renderItem,
}: MasonryProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const marquee = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    pageY: number;
    active: boolean;
    touch: boolean;
    index?: number;
    additive: boolean;
    timer?: ReturnType<typeof setTimeout>;
  }>(undefined);
  const suppressClick = useRef(false);
  useEffect(() => () => clearTimeout(gesture.current?.timer), []);
  const [box, setBox] = useState({ width: 0, top: 0, inset: 0 });
  const [active, setActive] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      const next = {
        width: el.clientWidth,
        top: el.getBoundingClientRect().top + window.scrollY,
        // What a sticky bar covers: the page's own scroll-padding-top, so
        // focus moved by arrow keys clears it as Tab does (WCAG 2.4.11).
        inset: parseFloat(getComputedStyle(root).scrollPaddingTop) || 0,
      };
      // The page's own growth fires this often; only a real change renders.
      setBox((box) =>
        box.width === next.width &&
        box.top === next.top &&
        box.inset === next.inset
          ? box
          : next
      );
    };
    update();
    // The wall's top moves when something above it (the Get Started band)
    // mounts or grows, which resizes the page but not the wall.
    const observer = new ResizeObserver(update);
    observer.observe(el);
    observer.observe(document.body);
    const inset = new MutationObserver(update);
    inset.observe(root, { attributes: true, attributeFilter: ["style"] });
    return () => {
      observer.disconnect();
      inset.disconnect();
    };
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
    scrollPaddingStart: box.inset,
    scrollPaddingEnd: selection?.ids.length ? 128 : 0,
    getItemKey: (i) => (items[i] ? getKey(items[i]) : i),
  });

  useEffect(() => virtualizer.measure(), [virtualizer, colWidth, lanes, items]);

  const focusIndex = (index: number, patient = false) => {
    setActive(index);
    virtualizer.scrollToIndex(index, { align: "auto" });
    // After a long scroll the tile is not drawn for a few frames: wait for it.
    let frames = patient ? 30 : 1;
    const focusWhenDrawn = () => {
      const tile = ref.current?.querySelector<HTMLElement>(
        `[data-index="${index}"]`
      );
      if (tile) tile.focus({ preventScroll: true });
      else if (--frames > 0) requestAnimationFrame(focusWhenDrawn);
    };
    requestAnimationFrame(focusWhenDrawn);
  };

  const focusKey = useRef<(key: string) => boolean>(() => false);
  useLayoutEffect(() => {
    focusKey.current = (key) => {
      const index = items.findIndex((item) => getKey(item) === key);
      if (index < 0) return false;
      focusIndex(index, true);
      return true;
    };
  });
  useEffect(() => {
    const onRequest = (event: Event) => {
      const request = (event as CustomEvent<{ key: string; handled: boolean }>)
        .detail;
      if (!request.handled && focusKey.current(request.key))
        request.handled = true;
    };
    document.addEventListener(FOCUS_KEY, onRequest);
    return () => document.removeEventListener(FOCUS_KEY, onRequest);
  }, []);

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
  const wall = useRef({});
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
      gliding &&
      same &&
      now < openUntil &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const at = new Map<string, string>();
    const timing = {
      duration: DURATION.small,
      easing: `cubic-bezier(${EASING.out.join(",")})`,
    };
    if (glideKey !== undefined && travel.glideKey !== glideKey) {
      travel.glideKey = glideKey;
      travel.at.clear();
    }
    const origin = el.getBoundingClientRect();
    const [pageX, pageY] = [
      origin.left + window.scrollX,
      origin.top + window.scrollY,
    ];
    for (const tile of el.querySelectorAll<HTMLElement>(
      ":scope > [data-key]"
    )) {
      const key = tile.dataset.key!;
      const to = tile.style.transform;
      at.set(key, to);
      const from = before.at.get(key);
      if (glide && from && from !== to) {
        tile.animate([{ transform: from }, { transform: to }], timing);
      }
      const offset = TRANSLATE.exec(to);
      if (glideKey === undefined || !offset) continue;
      const here = {
        wall: wall.current,
        x: pageX + +offset[1]!,
        y: pageY + +offset[2]!,
      };
      const left = travel.at.get(key);
      // New in this wall, and last drawn by another one close to the screen.
      if (
        glide &&
        !from &&
        left &&
        left.wall !== wall.current &&
        left.y > window.scrollY - window.innerHeight &&
        left.y < window.scrollY + 2 * window.innerHeight
      ) {
        tile.animate(
          [
            { translate: `${left.x - here.x}px ${left.y - here.y}px` },
            { translate: "0px 0px" },
          ],
          timing
        );
      }
      travel.at.set(key, here);
    }
    placed.current = { items, glideKey, openUntil: same ? openUntil : 0, at };
  });

  const onKeyDown = (event: KeyboardEvent) => {
    // Only the wall and its tiles; never an input a tile might hold.
    if (
      event.target !== event.currentTarget &&
      !(
        event.target instanceof HTMLElement &&
        event.target.hasAttribute("data-index")
      )
    )
      return;
    if (selection?.ids.length && event.key === "Escape") {
      event.preventDefault();
      clearTimeout(gesture.current?.timer);
      gesture.current = undefined;
      if (marquee.current) marquee.current.hidden = true;
      selection.clear();
      return;
    }
    if (
      selection &&
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "a"
    ) {
      event.preventDefault();
      selection.all();
      return;
    }
    if (current === undefined) return;
    const target = neighbour(virtualizer.measurementsCache, current, event.key);
    if (target !== undefined) {
      event.preventDefault();
      focusIndex(target);
      if (event.shiftKey && selection && items[target]) {
        if (!selection.ids.length && items[current])
          selection.choose(getKey(items[current]), "toggle");
        selection.choose(getKey(items[target]), "range");
      }
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const destination = onEdge?.(event.key);
      if (destination !== undefined) {
        event.preventDefault();
        if (event.shiftKey && selection) {
          if (!selection.ids.length && items[current])
            selection.choose(getKey(items[current]), "toggle");
          selection.choose(destination, "range");
        }
      }
    } else if (event.key === "Enter") {
      onOpen?.(current);
    } else if (event.key === " ") {
      event.preventDefault();
      if (selection && items[current])
        selection.choose(getKey(items[current]), "toggle");
      else onPreview?.(current);
    }
  };

  const pointerDown = (e: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (
      !selection ||
      e.button !== 0 ||
      !(e.target instanceof HTMLElement) ||
      e.target.closest("button, a, input, summary")
    )
      return;
    const tile = e.target.closest<HTMLElement>("[data-index]");
    const index = tile ? Number(tile.dataset.index) : undefined;
    const touch = e.pointerType === "touch";
    const g = {
      x: e.clientX,
      y: e.clientY,
      pageY: e.pageY,
      active: false,
      touch,
      index,
      additive: e.ctrlKey || e.metaKey,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    gesture.current = g;
    if (touch && index !== undefined)
      g.timer = setTimeout(() => {
        if (gesture.current !== g || !items[index]) return;
        selection.choose(getKey(items[index]), "toggle");
        suppressClick.current = true;
        g.active = true;
      }, 450);
  };
  const pointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6 && !g.active) return;
    clearTimeout(g.timer);
    if (g.touch) {
      if (!g.active) gesture.current = undefined;
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    g.active = true;
    suppressClick.current = true;
    const el = marquee.current;
    if (!el) return;
    el.hidden = false;
    el.style.transform = `translate(${Math.min(g.x, e.clientX)}px, ${Math.min(g.pageY, e.pageY) - window.scrollY}px)`;
    el.style.width = `${Math.abs(e.clientX - g.x)}px`;
    el.style.height = `${Math.abs(e.pageY - g.pageY)}px`;
    if (e.clientY > window.innerHeight - 32) window.scrollBy(0, 24);
    else if (e.clientY < 32) window.scrollBy(0, -24);
  };
  const pointerEnd = (e: PointerEvent<HTMLDivElement>, cancel = false) => {
    const g = gesture.current;
    gesture.current = undefined;
    clearTimeout(g?.timer);
    if (marquee.current) marquee.current.hidden = true;
    if (!g || !g.active || g.touch || cancel || !selection) return;
    const rect = ref.current!.getBoundingClientRect();
    const left = rect.left;
    const top = rect.top + window.scrollY;
    const x1 = Math.min(g.x, e.clientX) - left,
      x2 = Math.max(g.x, e.clientX) - left;
    const y1 = Math.min(g.pageY, e.pageY) - top,
      y2 = Math.max(g.pageY, e.pageY) - top;
    const ids = virtualizer.measurementsCache
      .filter((v) => {
        const x = v.lane * (colWidth + gap);
        return (
          x < x2 &&
          x + colWidth > x1 &&
          v.start - box.top < y2 &&
          v.end - box.top > y1
        );
      })
      .flatMap((v) => (items[v.index] ? [getKey(items[v.index]!)] : []));
    selection.marquee(ids, g.additive);
  };

  return (
    <div
      ref={ref}
      role="list"
      aria-label={label}
      onKeyDown={onKeyDown}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={(e) => pointerEnd(e)}
      onPointerCancel={(e) => pointerEnd(e, true)}
      onContextMenu={(e) => {
        if (suppressClick.current) e.preventDefault();
      }}
      className={cn("relative w-full", className)}
      style={{ height: virtualizer.getTotalSize() }}
    >
      <div
        ref={marquee}
        hidden
        aria-hidden
        className="pointer-events-none fixed top-0 left-0 z-40 border border-ring bg-spark/20"
      />
      {rendered.map((v) => {
        const item = items[v.index];
        if (!item) return null;
        return (
          <div
            key={v.key}
            role="listitem"
            data-index={v.index}
            tabIndex={v.index === current ? 0 : -1}
            aria-label={`${getLabel(item)}${selection?.ids.includes(getKey(item)) ? ", Selected" : ""}`}
            data-selected={selection?.ids.includes(getKey(item)) || undefined}
            data-selectable={selection ? "true" : undefined}
            onFocus={() => setActive(v.index)}
            onClick={(e) => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              if (
                selection &&
                (e.shiftKey || e.metaKey || e.ctrlKey || selection.ids.length)
              ) {
                selection.choose(getKey(item), e.shiftKey ? "range" : "toggle");
              } else onOpen?.(v.index);
            }}
            data-key={v.key}
            className="group/selection absolute top-0 left-0 rounded-tile outline-offset-2 select-none data-selected:ring-2 data-selected:ring-ring"
            style={{
              width: colWidth,
              height: v.size,
              transform: `translate(${v.lane * (colWidth + gap)}px, ${v.start - box.top}px)`,
            }}
          >
            {selection && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Select ${getLabel(item)}`}
                aria-pressed={selection.ids.includes(getKey(item))}
                className="absolute top-1 right-1 z-10 grid size-11 place-items-center rounded-control opacity-0 focus:opacity-100 group-hover/selection:opacity-100 aria-pressed:opacity-100 [@media(pointer:coarse)]:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  selection.choose(
                    getKey(item),
                    e.shiftKey ? "range" : "toggle"
                  );
                }}
              >
                <span
                  aria-hidden
                  className="grid size-5 place-items-center rounded-chip border border-ring bg-surface text-ink"
                >
                  {selection.ids.includes(getKey(item)) && (
                    <CheckIcon aria-hidden className="size-4" />
                  )}
                </span>
              </button>
            )}
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
