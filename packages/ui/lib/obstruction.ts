import { useEffect, useSyncExternalStore, type RefObject } from "react";

// Things pinned to the bottom of the viewport (the Library's selection bar)
// tell the toaster how tall they are, so a toast with Undo stacks above them
// instead of under them. One shared store; no element, no obstruction.

const heights = new Map<symbol, number>();
const listeners = new Set<() => void>();
let tallest = 0;

function publish() {
  const next = Math.max(0, ...heights.values());
  if (next === tallest) return;
  tallest = next;
  listeners.forEach((listener) => listener());
}

/**
 * Registers the element's measured height (its border box, kept current as
 * it wraps or text grows) while `active`. Unregisters on unmount.
 */
export function useBottomObstruction(
  element: RefObject<HTMLElement | null>,
  active = true
) {
  useEffect(() => {
    const node = element.current;
    if (!node || !active) return;
    const id = Symbol("bottom-obstruction");
    const measure = () => {
      heights.set(id, node.getBoundingClientRect().height);
      publish();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
      heights.delete(id);
      publish();
    };
  }, [element, active]);
}

// Open dialogs and sheets register too, so the toaster can move out of the way
// of their actions (a phone sheet can stand 92dvh tall).
const layers = new Set<symbol>();
const layerListeners = new Set<() => void>();
let layerCount = 0;

function publishLayers() {
  if (layers.size === layerCount) return;
  layerCount = layers.size;
  layerListeners.forEach((listener) => listener());
}

/** Registers one open dialog or sheet while the caller is mounted. */
export function useOpenLayer() {
  useEffect(() => {
    const id = Symbol("open-layer");
    layers.add(id);
    publishLayers();
    return () => {
      layers.delete(id);
      publishLayers();
    };
  }, []);
}

/** How many dialogs or sheets are open right now. */
export function useOpenLayerCount(): number {
  return useSyncExternalStore(
    (listener) => {
      layerListeners.add(listener);
      return () => layerListeners.delete(listener);
    },
    () => layerCount,
    () => 0
  );
}

/** The tallest registered bottom obstruction in px (0 when there is none). */
export function useBottomObstructionHeight(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => tallest,
    () => 0
  );
}

/** Space between the viewport's bottom edge and what is pinned there. */
export const BOTTOM_EDGE = "calc(env(safe-area-inset-bottom) + 1rem)";
/** Space between a toast and the bar it stacks above. */
const TOAST_GAP = 12;

/** The toaster's distance from the bottom: edge, the bar, and a gap above it. */
export function toastOffset(obstruction: number): string {
  return obstruction > 0
    ? `calc(${BOTTOM_EDGE} + ${obstruction}px + ${TOAST_GAP}px)`
    : BOTTOM_EDGE;
}
