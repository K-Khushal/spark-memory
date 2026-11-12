// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { THEMES } from "@spark/ui/tokens";
import { selectRegion } from "../lib/region";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
it("removes the overlay and waits two paint frames before releasing the crop", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  // Intercept only the browser's shadow-root boundary to drive the isolated UI.
  const attach = HTMLElement.prototype.attachShadow;
  let root!: ShadowRoot;
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (
    this: HTMLElement,
    options
  ) {
    root = attach.call(this, options);
    return root;
  });
  let settled = false;
  const selected = selectRegion(THEMES).then((result) => {
    settled = true;
    return result;
  });
  const layer = root.querySelector('[role="dialog"]')!;
  layer.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
  );
  layer.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  );
  await Promise.resolve();
  expect(
    document.documentElement.querySelector('[style*="2147483647"]')
  ).toBeNull();
  expect(settled).toBe(false);
  frames.shift()!(0);
  await Promise.resolve();
  expect(settled).toBe(false);
  frames.shift()!(16);
  expect(await selected).toMatchObject({ a: { x: 100, y: 100 } });
});
