/**
 * @vitest-environment happy-dom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SkeletonGate } from "../index";

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const gate = (loading: boolean): ReactNode => (
  <SkeletonGate loading={loading} skeleton={<i id="bones" />}>
    <p id="content">Loaded</p>
  </SkeletonGate>
);
const render = (loading: boolean) => act(() => root.render(gate(loading)));
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const bones = () => host.querySelector("#bones");
const layer = () => host.querySelector("[data-slot=skeleton-layer]");

it("shows nothing for the first 150ms, then the skeleton", () => {
  render(true);
  expect(bones()).toBeNull();
  expect(host.querySelector("#content")).toBeNull();
  tick(149);
  expect(bones()).toBeNull();
  tick(1);
  expect(bones()).not.toBeNull();
  expect(host.querySelector("[role=status]")?.textContent).toContain("Loading");
});

it("never shows a skeleton for a load that ends inside 150ms", () => {
  render(true);
  tick(100);
  render(false);
  expect(bones()).toBeNull();
  expect(host.querySelector("#content")).not.toBeNull();
});

it("fades the skeleton out over the content for 150ms, then removes it", () => {
  render(true);
  tick(200);
  render(false);
  expect(host.querySelector("#content")).not.toBeNull();
  expect(layer()?.getAttribute("data-leaving")).toBe("true");
  tick(149);
  expect(layer()).not.toBeNull();
  tick(1);
  expect(layer()).toBeNull();
});

it("waits a fresh 150ms when loading starts again inside the fade-out", () => {
  render(true);
  tick(200);
  render(false);
  tick(50); // still inside the 150ms exit
  expect(layer()).not.toBeNull();
  render(true);
  // The second cycle has not waited yet: no skeleton, no content.
  expect(bones()).toBeNull();
  expect(host.querySelector("#content")).toBeNull();
  tick(149);
  expect(bones()).toBeNull();
  tick(1);
  expect(bones()).not.toBeNull();
});

it("`immediate` shows the skeleton on the first frame, then fades it as usual", () => {
  act(() =>
    root.render(
      <SkeletonGate loading skeleton={<i id="bones" />} immediate>
        <p id="content">Loaded</p>
      </SkeletonGate>
    )
  );
  expect(bones()).not.toBeNull();
  expect(host.querySelector("#content")).toBeNull();
  act(() =>
    root.render(
      <SkeletonGate loading={false} skeleton={<i id="bones" />} immediate>
        <p id="content">Loaded</p>
      </SkeletonGate>
    )
  );
  expect(layer()?.getAttribute("data-leaving")).toBe("true");
  tick(150);
  expect(layer()).toBeNull();
});
