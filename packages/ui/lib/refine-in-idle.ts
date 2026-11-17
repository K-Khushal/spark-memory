/** Keep precise text shaping off the first layout and out of long tasks. */
export function refineInIdle(
  count: number,
  measure: (index: number) => boolean,
  publish: (indices: number[]) => void
) {
  let stopped = false;
  let cursor = 0;
  let cancel = () => {};
  const schedule = () => {
    if (stopped || cursor >= count) return;
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(run, { timeout: 1000 });
      cancel = () => cancelIdleCallback(id);
    } else {
      const id = setTimeout(
        () => run({ didTimeout: true, timeRemaining: () => 6 }),
        16
      );
      cancel = () => clearTimeout(id);
    }
  };
  const run = (
    deadline: Pick<IdleDeadline, "didTimeout" | "timeRemaining">
  ) => {
    if (stopped) return;
    const started = performance.now();
    const changed: number[] = [];
    let visited = 0;
    // Leave two milliseconds for publishing the batch. One body is capped
    // by the tile's text/clamp; never drain a whole wall in one callback.
    while (
      cursor < count &&
      visited < 32 &&
      performance.now() - started < 6 &&
      (deadline.timeRemaining() > 1 || (deadline.didTimeout && visited === 0))
    ) {
      const index = cursor++;
      visited++;
      if (measure(index)) changed.push(index);
    }
    if (changed.length) publish(changed);
    schedule();
  };
  schedule();
  return () => {
    stopped = true;
    cancel();
  };
}
