/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TitleField } from "./title-field";

async function mount(onChange: (value: string) => void) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <TitleField
        value="Des"
        onChange={onChange}
        maxLength={300}
        placeholder="Title"
      />
    )
  );
  return {
    field: host.querySelector("textarea")!,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

it("is a Title field that grows with its content, one line of meaning", async () => {
  const { field, unmount } = await mount(() => {});
  try {
    expect(field.getAttribute("aria-label")).toBe("Title");
    expect(field.getAttribute("dir")).toBe("auto");
    expect(field.getAttribute("rows")).toBe("1");
    // It sizes to its content, never clipping to one ellipsised line.
    expect(field.className).toContain("field-sizing-content");
    expect(field.className).not.toContain("text-ellipsis");
  } finally {
    await unmount();
  }
});

it("keeps a title on one line: Enter adds none and pasted line breaks become spaces", async () => {
  const onChange = vi.fn();
  const { field, unmount } = await mount(onChange);
  try {
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      field.dispatchEvent(enter);
    });
    expect(enter.defaultPrevented).toBe(true);
    // Enter with ⌘ or Ctrl still reaches Memory detail, which closes on it.
    const close = new KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      field.dispatchEvent(close);
    });
    expect(close.defaultPrevented).toBe(false);

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )!.set!.call(field, "Soup\nrecipe\r\nfor two");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith("Soup recipe for two");
  } finally {
    await unmount();
  }
});
