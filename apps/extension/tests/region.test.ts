// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { THEMES } from "@spark/ui/tokens";
import { selectRegion } from "../lib/region";
beforeEach(() => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  vi.useRealTimers();
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
  const layer = root.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(layer.style.outlineStyle).toBe("none");
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

function pausedSelection() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
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
  const selected = selectRegion(THEMES).then((value) => {
    settled = true;
    return value;
  });
  const layer = root.querySelector('[role="dialog"]')!;
  const key = (key: string) =>
    layer.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  return { selected, frames, key, settled: () => settled };
}
it("resolves a hidden document's 60-second selection timeout without paint callbacks", async () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const selection = pausedSelection();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(selection.settled()).toBe(true);
  expect(await selection.selected).toBeUndefined();
  expect(selection.frames).toHaveLength(0);
});
it("completes a hidden document selection without waiting for paint", async () => {
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  const selection = pausedSelection();
  selection.key("ArrowRight");
  selection.key("Enter");
  await vi.advanceTimersByTimeAsync(0);
  expect(selection.settled()).toBe(true);
  expect(await selection.selected).toMatchObject({ a: { x: 100, y: 100 } });
  expect(selection.frames).toHaveLength(0);
});
it("cancels a visible selection without waiting for a paint", async () => {
  const selection = pausedSelection();
  selection.key("Escape");
  await vi.advanceTimersByTimeAsync(0);
  expect(selection.settled()).toBe(true);
  expect(await selection.selected).toBeUndefined();
  expect(selection.frames).toHaveLength(0);
});
it("releases a real crop after 100ms if its paint callbacks stop running", async () => {
  const selection = pausedSelection();
  selection.key("ArrowRight");
  selection.key("Enter");
  await vi.advanceTimersByTimeAsync(99);
  expect(selection.settled()).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(selection.settled()).toBe(true);
  expect(await selection.selected).toMatchObject({ a: { x: 100, y: 100 } });
  // Resuming the old callbacks after the deadline must remain harmless.
  selection.frames.shift()!(0);
  selection.frames.shift()!(16);
});
