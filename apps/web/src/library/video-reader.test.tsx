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

it("keeps the transcript to one Tab stop, moved by the arrow keys", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <VideoReader
          memory={{
            sourceUrl: "https://example.com/reel",
            video: {
              transcriptState: "available",
              transcript: [0, 30, 95].map((seconds) => ({
                seconds,
                text: `At ${seconds}`,
              })),
            },
            description: null,
          }}
        />
      )
    );
    const stops = () =>
      [...host.querySelectorAll<HTMLButtonElement>("ol button")].filter(
        (b) => b.tabIndex === 0
      );
    expect(stops().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Play at 0:00",
    ]);
    const key = (name: string) =>
      act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key: name, bubbles: true })
        );
      });
    host.querySelector<HTMLButtonElement>("ol button")!.focus();
    await key("ArrowDown");
    await key("ArrowDown");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Play at 1:35"
    );
    await key("ArrowDown");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Play at 1:35"
    );
    expect(stops().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Play at 1:35",
    ]);
    await key("Home");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Play at 0:00"
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
