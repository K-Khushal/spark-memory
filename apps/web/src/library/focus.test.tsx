/** @vitest-environment happy-dom */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Masonry } from "@spark/ui";
import { restoreLibraryFocus } from "./focus";

vi.mock("../shell", () => ({ focusDeskControl: vi.fn() }));
const { virtualizer } = vi.hoisted(() => {
  const items = [0, 1].map((index) => ({
    index,
    key: index === 0 ? "first" : "second",
    start: 0,
    end: 100,
    size: 100,
    lane: index,
  }));
  return {
    virtualizer: {
      measure: vi.fn(),
      scrollToIndex: vi.fn(),
      getVirtualItems: () => items,
      getTotalSize: () => 100,
      measurementsCache: items,
    },
  };
});
vi.mock("@tanstack/react-virtual", () => ({
  useWindowVirtualizer: () => virtualizer,
}));

let frames: FrameRequestCallback[];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    frames.push(callback)
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function frame() {
  const pending = frames;
  frames = [];
  await act(async () => pending.forEach((callback) => callback(0)));
}
function Library() {
  const [viewing, setViewing] = useState(true);
  const [opened, setOpened] = useState("");
  return (
    <main>
      <Masonry
        items={["first", "second"]}
        getKey={(item) => item}
        getLabel={(item) => item}
        label="All Memories"
        glide={false}
        onOpen={(index) => setOpened(index === 0 ? "first" : "second")}
        renderItem={(item) => item}
      />
      {viewing && (
        <div role="dialog" data-state="open">
          <button
            onClick={(event) => {
              restoreLibraryFocus(event.nativeEvent, "first");
              setViewing(false);
            }}
          >
            Close viewer
          </button>
        </div>
      )}
      <output>{opened}</output>
    </main>
  );
}
async function closeViewer() {
  await act(async () => root.render(<Library />));
  const close = host.querySelector("button")!;
  close.focus();
  await act(async () => close.click());
  expect(host.querySelector('[role="dialog"]')).toBeNull();
}

it.each([0, 1])(
  "opens the newly focused Memory when focus moves after %i restore frames",
  async (elapsed) => {
    await closeViewer();
    for (let i = 0; i < elapsed; i++) await frame();
    const next = host.querySelector<HTMLElement>('[data-key="second"]')!;
    await act(async () => next.focus());
    await frame();
    await frame();
    expect(document.activeElement).toBe(next);
    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      )
    );
    expect(host.querySelector("output")?.textContent).toBe("second");
  }
);

it("restores the closed Memory when focus is still on the body", async () => {
  await closeViewer();
  expect(document.activeElement).toBe(document.body);
  await frame();
  await frame();
  expect(document.activeElement).toBe(host.querySelector('[data-key="first"]'));
});

it("restores when the element focused at close time still holds focus", async () => {
  await closeViewer();
  await frame();
  await frame();
  const atClose = document.createElement("button");
  const closingDialog = document.createElement("div");
  closingDialog.setAttribute("role", "dialog");
  closingDialog.setAttribute("data-state", "closed");
  closingDialog.append(atClose);
  host.append(closingDialog);
  atClose.focus();
  await act(async () => restoreLibraryFocus(new Event("close"), "second"));
  await frame();
  await frame();
  expect(document.activeElement).toBe(
    host.querySelector('[data-key="second"]')
  );
});

it("leaves a newly focused control alone during the second frame", async () => {
  await closeViewer();
  await frame();
  const control = document.createElement("button");
  host.append(control);
  control.focus();
  await frame();
  expect(document.activeElement).toBe(control);
});

it("preserves a route handoff that focused its control before the close callback", async () => {
  await closeViewer();
  await frame();
  await frame();
  const next = host.querySelector<HTMLElement>('[data-key="second"]')!;
  await act(async () => next.focus());
  await act(async () => restoreLibraryFocus(new Event("close"), "first"));
  await frame();
  await frame();
  expect(document.activeElement).toBe(next);
});
