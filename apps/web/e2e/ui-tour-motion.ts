import { expect, type Page } from "@playwright/test";

export type MotionRow = {
  interaction: string;
  element: string;
  property: string;
  duration: number;
  easing: string;
  delay: number;
  expectedDuration?: number;
  expectedEasing?: string;
};

const recordings = new WeakMap<Page, MotionRow[]>();

/** Sample running effects each frame, including short effects between driver calls. */
export async function observeMotion(page: Page) {
  const captured: MotionRow[] = [];
  recordings.set(page, captured);
  await page.exposeFunction("recordTourMotion", (row: MotionRow) =>
    captured.push(row)
  );
  const install = () => {
    const rows = {
      push: (row: MotionRow) =>
        void (
          window as unknown as {
            recordTourMotion(row: MotionRow): Promise<void>;
          }
        ).recordTourMotion(row),
    };
    const seen = new WeakSet<Animation>();
    let interaction = "initial";
    for (const event of ["pointerdown", "keydown", "click"]) {
      document.addEventListener(
        event,
        (e) => {
          interaction = `${e.type}: ${e instanceof KeyboardEvent ? e.key : (e.target as Element)?.textContent?.trim().slice(0, 40)}`;
        },
        true
      );
    }
    Object.assign(window, { tourMotion: rows });
    const sample = () => {
      for (const animation of document.getAnimations()) {
        if (seen.has(animation)) continue;
        seen.add(animation);
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect)) continue;
        const target = effect.target;
        if (!(target instanceof HTMLElement)) continue;
        const timing = effect.getTiming();
        const computed = effect.getComputedTiming();
        const frames = effect.getKeyframes();
        const properties = [
          ...new Set(
            frames.flatMap((frame) =>
              Object.keys(frame).filter(
                (key) =>
                  !["offset", "computedOffset", "easing", "composite"].includes(
                    key
                  )
              )
            )
          ),
        ];
        const css = getComputedStyle(target);
        const root = getComputedStyle(document.documentElement);
        const name =
          animation instanceof CSSAnimation ? animation.animationName : "";
        const contracts: Record<string, [string, string]> = {
          "spark-sheet-in": ["panel", "drawer"],
          "spark-sheet-out": ["small", "drawer"],
          "spark-dialog-in": ["small", "out"],
          "spark-fade-in": ["preview", "out"],
        };
        const contract = contracts[name];
        rows.push({
          ...(contract && {
            expectedDuration: parseFloat(
              root.getPropertyValue(`--duration-${contract[0]}`)
            ),
            expectedEasing: root
              .getPropertyValue(`--ease-${contract[1]}`)
              .trim(),
          }),
          interaction,
          element:
            target.dataset.slot ??
            target.getAttribute("role") ??
            target.tagName,
          property: properties.join(","),
          duration: Number(computed.duration),
          easing:
            timing.easing === "linear"
              ? (frames[0]?.easing ?? timing.easing)
              : (timing.easing ?? "linear"),
          delay: timing.delay ?? 0,
        });
        if (animation instanceof CSSTransition) {
          rows.push({
            interaction,
            element: target.dataset.slot ?? target.tagName,
            property: `CSS ${animation.transitionProperty} (${css.transitionDuration}; ${css.transitionTimingFunction})`,
            duration: Number(computed.duration),
            easing: timing.easing ?? "linear",
            delay: timing.delay ?? 0,
          });
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  };
  await page.addInitScript(install);
  await page.evaluate(install);
}

export async function readMotion(page: Page, reduced: boolean) {
  const rows = recordings.get(page) ?? [];
  for (const row of rows) {
    if (row.expectedDuration !== undefined) {
      expect(row.duration).toBeCloseTo(row.expectedDuration, 0);
      expect(row.easing.replaceAll(" ", "")).toBe(
        row.expectedEasing?.replaceAll(" ", "")
      );
    }
  }
  // Sonner owns its timing; cursor and caret are recording tooling.
  for (const row of rows.filter((row) => row.element === "dialog-content")) {
    expect(row.duration).toBeLessThanOrEqual(reduced ? 150 : 300);
    if (reduced)
      expect(row.property.split(",").every((p) => p === "opacity")).toBe(true);
  }
  return rows;
}
