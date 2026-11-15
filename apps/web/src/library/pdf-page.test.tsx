/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PageView } from "./pdf-viewer";

it("a failed page keeps its page-sized sheet and its page label; only the image hides", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  const onBroken = vi.fn();
  const onRetry = vi.fn();
  try {
    await act(async () =>
      root.render(
        <PageView
          page={{ page: 3, url: "/p/3.png", width: 600, height: 800 }}
          passage={undefined}
          eager={false}
          onBroken={onBroken}
          onRetry={onRetry}
        />
      )
    );
    const image = host.querySelector("img")!;
    expect(host.querySelector('[role="img"]')).toBeNull();
    expect(image.getAttribute("alt")).toBe("Page 3");

    await act(async () => {
      image.dispatchEvent(new Event("error"));
    });
    expect(onBroken).toHaveBeenCalledOnce();
    const label = host.querySelector<HTMLElement>('[role="img"]')!;
    expect(label.getAttribute("aria-label")).toBe("Page 3");
    const sheet = host.querySelector<HTMLElement>("[data-failed]")!;
    expect(sheet.style.aspectRatio.replace(/\s/g, "")).toBe("600/800");
    expect(sheet.className).toContain("bg-surface");
    // The sheet offers Try Again, named for its page, not just a blank.
    const retry = host.querySelector<HTMLButtonElement>("button")!;
    // Its name starts with what it shows, then says which page.
    expect(retry.textContent).toBe("Try Again on Page 3");
    expect(retry.firstChild?.textContent).toBe("Try Again");
    expect(host.querySelector("img")!.className).toContain("invisible");

    // A load that then succeeds gives the page back, with no Try Again.
    await act(async () => {
      host.querySelector("img")!.dispatchEvent(new Event("load"));
    });
    expect(host.querySelector('[role="img"]')).toBeNull();
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("img")!.className).not.toContain("invisible");

    // Try Again clears the failure and asks the viewer for fresh URLs.
    await act(async () => {
      host.querySelector("img")!.dispatchEvent(new Event("error"));
    });
    await act(async () => host.querySelector("button")!.click());
    expect(onRetry).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="img"]')).toBeNull();
    expect(host.querySelector("img")!.className).not.toContain("invisible");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
