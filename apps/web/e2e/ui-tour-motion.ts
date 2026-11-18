import { expect, type Page } from "@playwright/test";

export type MotionRow = {
  interaction: string;
  element: string;
  property: string;
  duration: number;
  easing: string;
  delay: number;
  cssDuration?: string;
  cssEasing?: string;
};

type Contract =
  | {
      duration: number;
      easing: string;
      properties: string[];
    }
  | "none";
export const OUT_EASE = "cubic-bezier(0.23,1,0.32,1)";
export const DRAWER_EASE = "cubic-bezier(0.32,0.72,0,1)";
export const motionVerdicts: string[] = [];

/** Arm before the input, so even an effect removed before the driver returns is measured. */
export async function assertInteraction(
  page: Page,
  interaction: string,
  selector: string,
  action: () => Promise<unknown>,
  contract: Contract,
  onMeasured: (rows: MotionRow[]) => void
) {
  await page.evaluate((selector) => {
    const rows: MotionRow[] = [];
    const seen = new WeakSet<Animation>(document.getAnimations());
    let active = true;
    const sample = () => {
      if (!active) return;
      for (const a of document.getAnimations()) {
        const e = a.effect;
        if (
          !(e instanceof KeyframeEffect) ||
          !(
            e.target instanceof HTMLElement || e.target instanceof SVGElement
          ) ||
          !e.target.matches(selector) ||
          seen.has(a)
        )
          continue;
        seen.add(a);
        const target = e.target;
        const timing = e.getTiming(),
          computed = e.getComputedTiming();
        const frames = e.getKeyframes();
        const css = getComputedStyle(target);
        const properties = [
          ...new Set(
            frames.flatMap((f) =>
              Object.keys(f).filter(
                (k) =>
                  !["offset", "computedOffset", "easing", "composite"].includes(
                    k
                  )
              )
            )
          ),
        ];
        for (const property of properties)
          rows.push({
            interaction: "",
            element:
              target.dataset.key ??
              target.dataset.slot ??
              (target.classList.contains("check-plate")
                ? "check-plate"
                : target.tagName),
            property,
            duration: Number(computed.duration),
            easing:
              timing.easing === "linear"
                ? (frames[0]?.easing ?? "linear")
                : (timing.easing ?? "linear"),
            delay: timing.delay ?? 0,
            // CSS values are retained alongside the measured transition, not as duplicate rows.
            ...(a instanceof CSSTransition && {
              cssDuration: css.transitionDuration,
              cssEasing: css.transitionTimingFunction,
            }),
          });
      }
      requestAnimationFrame(sample);
    };
    Object.assign(window, {
      motionProbe: {
        rows,
        stop: () => {
          active = false;
        },
      },
    });
    requestAnimationFrame(sample);
  }, selector);
  try {
    await action();
    await page.waitForTimeout(80);
    const rows = await page.evaluate(() => {
      const probe = (
        window as unknown as {
          motionProbe: { rows: MotionRow[]; stop(): void };
        }
      ).motionProbe;
      probe.stop();
      return probe.rows;
    });
    const deduped = [
      ...new Map(rows.map((r) => [r.element + "|" + r.property, r])).values(),
    ];
    const measured = deduped.length
      ? deduped.map((r) => ({ ...r, interaction }))
      : [
          {
            interaction,
            element: selector,
            property: "none",
            duration: 0,
            easing: "none",
            delay: 0,
          },
        ];
    onMeasured(measured);
    if (contract === "none") expect(rows, interaction).toEqual([]);
    else {
      expect(
        rows.length,
        interaction + ": missing running effect"
      ).toBeGreaterThan(0);
      const observed = [...new Set(rows.map((r) => r.property))];
      for (const required of contract.properties)
        expect(observed, interaction).toContain(required);
      for (const property of observed)
        expect(contract.properties, interaction).toContain(property);
      for (const row of rows) {
        expect(row.duration, interaction).toBeCloseTo(contract.duration, 0);
        expect(row.easing.replaceAll(" ", ""), interaction).toBe(
          contract.easing.replaceAll(" ", "")
        );
        expect(row.delay, interaction).toBe(0);
      }
    }
    motionVerdicts.push("PASS: " + interaction);
    return measured;
  } catch (error) {
    motionVerdicts.push("FAIL: " + interaction);
    throw error;
  } finally {
    await page
      .evaluate(() => {
        (
          window as unknown as { motionProbe?: { stop(): void } }
        ).motionProbe?.stop();
      })
      .catch(() => {});
    await page.waitForTimeout(400);
  }
}
