/** How many columns of at least `minWidth` fit in `width`. */
export function columnCount(
  width: number,
  opts: { minWidth: number; gap: number; max?: number }
): number {
  const fit = Math.floor((width + opts.gap) / (opts.minWidth + opts.gap));
  return Math.max(1, Math.min(fit, opts.max ?? Infinity));
}

export type JustifiedRow = {
  height: number;
  items: { index: number; width: number }[];
};

/**
 * Google-Images-style rows: every full row is stretched edge to edge at one
 * height, each item keeps its aspect ratio, and a short last row stays at the
 * target height. A row breaks where its height lands closest to the target.
 */
export function justifyRows(
  aspects: readonly number[],
  opts: { width: number; targetHeight: number; gap: number }
): JustifiedRow[] {
  const { width, targetHeight, gap } = opts;
  const heightFor = (sum: number, n: number) => (width - gap * (n - 1)) / sum;
  const rows: JustifiedRow[] = [];
  let start = 0;

  while (start < aspects.length) {
    let end = start;
    let sum = 0;
    // Grow the row while it stays at least as tall as the target, then take
    // one more item only if that lands closer to the target height.
    while (end < aspects.length) {
      const next = sum + (aspects[end] ?? 1);
      const withIt = heightFor(next, end - start + 1);
      if (withIt < targetHeight) {
        const without = end > start ? heightFor(sum, end - start) : Infinity;
        if (targetHeight - withIt < without - targetHeight) {
          sum = next;
          end += 1;
        }
        break;
      }
      sum = next;
      end += 1;
    }
    const natural = heightFor(sum, end - start);
    const isLast = end >= aspects.length;
    const height = isLast ? Math.min(natural, targetHeight) : natural;
    rows.push({
      height,
      items: aspects.slice(start, end).map((aspect, i) => ({
        index: start + i,
        width: Math.min(aspect * height, width),
      })),
    });
    start = end;
  }
  return rows;
}
