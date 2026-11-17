/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useOpenLayer, useOpenLayerCount } from "../index";

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function Layer() {
  useOpenLayer();
  return null;
}
function Count() {
  return <output>{useOpenLayerCount()}</output>;
}
const count = () => host.querySelector("output")!.textContent;

it("counts each open layer while it is mounted", () => {
  act(() =>
    root.render(
      <>
        <Count />
        <Layer />
      </>
    )
  );
  expect(count()).toBe("1");
  act(() =>
    root.render(
      <>
        <Count />
        <Layer />
        <Layer />
      </>
    )
  );
  expect(count()).toBe("2");
  act(() => root.render(<Count />));
  expect(count()).toBe("0");
});
