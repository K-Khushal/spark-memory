/** How many columns of at least `minWidth` fit in `width`. */
export function columnCount(
  width: number,
  opts: { minWidth: number; gap: number; max?: number }
): number {
  const fit = Math.floor((width + opts.gap) / (opts.minWidth + opts.gap));
  return Math.max(1, Math.min(fit, opts.max ?? Infinity));
}

/** Where an item sits in a lane-based (masonry) layout. */
export type LaneItem = {
  index: number;
  lane: number;
  start: number;
  size: number;
};

const centre = (item: LaneItem) => item.start + item.size / 2;

/**
 * The item an arrow key moves to: the next one up or down in the same lane,
 * or the one in the lane beside whose centre is nearest. Undefined at an edge
 * or for any other key.
 */
export function neighbour(
  items: readonly LaneItem[],
  from: number,
  key: string
): number | undefined {
  const here = items.find((item) => item.index === from);
  if (!here) return undefined;
  const lane = (n: number) =>
    items.filter((item) => item.lane === n).sort((a, b) => a.start - b.start);

  if (key === "ArrowUp" || key === "ArrowDown") {
    const column = lane(here.lane);
    const at = column.indexOf(here) + (key === "ArrowDown" ? 1 : -1);
    return column[at]?.index;
  }
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const beside = lane(here.lane + (key === "ArrowRight" ? 1 : -1));
    let best: LaneItem | undefined;
    for (const item of beside) {
      const distance = Math.abs(centre(item) - centre(here));
      if (!best || distance < Math.abs(centre(best) - centre(here))) {
        best = item;
      }
    }
    return best?.index;
  }
  return undefined;
}
