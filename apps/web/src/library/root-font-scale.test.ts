/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from "vitest";
import { rootFontScale } from "./root-font-scale";
import { whyHeight, WHY_HEIGHT } from "./why";

afterEach(() => {
  document.documentElement.style.fontSize = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shares one root style read across tile bodies and captions, then refreshes next frame", () => {
  let nextFrame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    nextFrame = callback;
    return 1;
  });
  const read = vi.spyOn(globalThis, "getComputedStyle");
  document.documentElement.style.fontSize = "16px";
  expect(rootFontScale()).toBe(1);
  expect(whyHeight()).toBe(WHY_HEIGHT);
  expect(whyHeight()).toBe(WHY_HEIGHT);
  expect(read).toHaveBeenCalledTimes(1);

  document.documentElement.style.fontSize = "32px";
  nextFrame?.(0);
  expect(whyHeight()).toBe(WHY_HEIGHT * 2);
  expect(rootFontScale()).toBe(2);
  expect(read).toHaveBeenCalledTimes(2);
  nextFrame?.(0);
});
