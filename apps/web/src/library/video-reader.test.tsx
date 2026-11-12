/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { VideoReader } from "./video-reader";

it("loads only a sandboxed YouTube player after an explicit Play", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <VideoReader
          memory={{
            sourceUrl: "https://youtu.be/abcdefghijk?t=760",
            video: null,
            description: null,
          }}
        />
      )
    );
    expect(host.querySelector("iframe")).toBeNull();
    await act(async () => host.querySelector("button")!.click());
    const player = host.querySelector("iframe");
    expect(player?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-presentation"
    );
    expect(player?.getAttribute("allow")).toBe(
      "encrypted-media; picture-in-picture; fullscreen"
    );
    expect(player?.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/abcdefghijk?start=760"
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
