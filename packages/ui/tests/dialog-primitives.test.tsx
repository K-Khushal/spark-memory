/**
 * @vitest-environment happy-dom
 */
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  inputModality,
  trackInputModality,
  useOpenLayerCount,
} from "../index";

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  act(() => root.unmount());
  // Radix defers focus restoration and focus-scope removal until unmount settles.
  await act(async () => vi.runOnlyPendingTimersAsync());
  vi.useRealTimers();
  host.remove();
  delete document.documentElement.dataset.input;
});

/** Renders a trigger and a dialog of header, body and footer, and opens it. */
async function open(presentation?: "sheet" | "dialog") {
  await act(async () =>
    root.render(
      h(
        Dialog,
        null,
        h(DialogTrigger, { id: "open", type: "button" }, "Open"),
        h(
          DialogContent,
          {
            "aria-describedby": undefined,
            ...(presentation && { presentation }),
          },
          h(DialogHeader, null, h(DialogTitle, null, "Edit")),
          h(DialogBody, null, h("input", { "aria-label": "First" })),
          h(
            DialogFooter,
            null,
            h("button", { type: "button" }, "Cancel"),
            h("button", { type: "button" }, "Done")
          )
        )
      )
    )
  );
  const trigger = host.querySelector<HTMLButtonElement>("#open")!;
  trigger.focus();
  await act(async () => trigger.click());
  return trigger;
}
const content = () =>
  document.querySelector<HTMLElement>("[data-slot=dialog-content]")!;

it("a sheet is a flex column of header, one scrolling body and a stable footer", async () => {
  await open("sheet");
  const el = content();
  expect(el.dataset.presentation).toBe("sheet");
  for (const cls of [
    "max-sm:flex-col",
    "max-sm:max-w-none",
    "max-sm:rounded-b-none",
  ])
    expect(el.className).toContain(cls);
  const body = el.querySelector("[data-slot=dialog-body]")!;
  for (const cls of ["overflow-y-auto", "min-h-0", "flex-1"])
    expect(body.className).toContain(cls);
  for (const part of ["dialog-header", "dialog-footer"])
    expect(el.querySelector(`[data-slot=${part}]`)!.className).toContain(
      "shrink-0"
    );
  expect(el.querySelector("[data-slot=dialog-footer]")!.className).toContain(
    "env(safe-area-inset-bottom)"
  );
});

it("moves focus into the dialog, wraps Tab inside it and returns focus on Escape", async () => {
  const trigger = await open("sheet");
  const el = content();
  expect(el.contains(document.activeElement)).toBe(true);
  const controls = [...el.querySelectorAll<HTMLElement>("input, button")];
  const last = controls.at(-1)!;
  last.focus();
  await act(async () => {
    last.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      })
    );
  });
  expect(el.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).not.toBe(trigger);

  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  });
  await act(async () => vi.runOnlyPendingTimersAsync());
  expect(document.querySelector("[data-slot=dialog-content]")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("the Close control is named and gets the touch target on a coarse pointer", async () => {
  await open("sheet");
  const close = content().querySelector<HTMLElement>("[aria-label=Close]");
  expect(close).not.toBeNull();
  expect(close!.className).toContain("pointer-coarse:size-(--size-touch)");
});

it("a dialog with no presentation carries none, so viewers keep the plain fade", async () => {
  await open();
  expect(content().dataset.presentation).toBeUndefined();
});

it("tracks how the last input arrived", () => {
  expect(inputModality()).toBe("pointer");
  const stop = trackInputModality();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
  expect(inputModality()).toBe("keyboard");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
  expect(inputModality()).toBe("keyboard");
  document.dispatchEvent(new Event("pointerdown"));
  expect(inputModality()).toBe("pointer");
  stop();
});

it("the header reserves the Close column from 640px up as on a phone, so a long title wraps clear of it", async () => {
  await open("sheet");
  const header = content().querySelector("[data-slot=dialog-header]")!;
  for (const cls of ["pr-14", "sm:pr-14", "pointer-coarse:pr-16"])
    expect(header.className.split(" ")).toContain(cls);
});

it("the body fades its last 24px only while there is more to read", async () => {
  await open("sheet");
  const body = content().querySelector<HTMLElement>("[data-slot=dialog-body]")!;
  const scroll = (height: number, top: number, client: number) => {
    Object.defineProperty(body, "scrollHeight", {
      configurable: true,
      value: height,
    });
    Object.defineProperty(body, "clientHeight", {
      configurable: true,
      value: client,
    });
    body.scrollTop = top;
    body.dispatchEvent(new Event("scroll"));
  };
  scroll(300, 0, 300);
  expect(body.dataset.fade).toBe("false");
  scroll(600, 0, 300);
  expect(body.dataset.fade).toBe("true");
  scroll(600, 300, 300);
  expect(body.dataset.fade).toBe("false");
});

it("remembers how it was opened, so a later click does not change its entrance", async () => {
  document.documentElement.dataset.input = "keyboard";
  await open("sheet");
  expect(content().dataset.openedBy).toBe("keyboard");
  document.documentElement.dataset.input = "pointer";
  await act(async () => {});
  expect(content().dataset.openedBy).toBe("keyboard");
  delete document.documentElement.dataset.input;
});

it("counts as an open layer only while its content is open", async () => {
  const Count = () => h("output", null, String(useOpenLayerCount()));
  const count = () => document.querySelector("output")!.textContent;
  await act(async () =>
    root.render(
      h(
        Dialog,
        null,
        h(Count),
        h(DialogTrigger, { id: "open", type: "button" }, "Open"),
        h(
          DialogContent,
          { "aria-describedby": undefined },
          h(DialogTitle, null, "T")
        )
      )
    )
  );
  expect(count()).toBe("0");
  await act(async () =>
    host.querySelector<HTMLButtonElement>("#open")!.click()
  );
  expect(count()).toBe("1");
  await act(async () => {
    content().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
  });
  await act(async () => vi.runOnlyPendingTimersAsync());
  expect(count()).toBe("0");
});
