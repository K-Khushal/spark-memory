/**
 * @vitest-environment happy-dom
 */
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
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
} from "../index";

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
  await act(async () => {});
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
