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
      "Play At 0:00",
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
      "Play At 1:35"
    );
    await key("ArrowDown");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Play At 1:35"
    );
    expect(stops().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Play At 1:35",
    ]);
    await key("Home");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Play At 0:00"
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each([
  ["unavailable", ["Transcript Unavailable"]],
  ["over_allowance", ["Transcript Unavailable", "Over 60 Minutes"]],
] as const)(
  "says a %s transcript is missing in separate compact labels",
  async (state, labels) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <VideoReader
            memory={{
              sourceUrl: "https://example.com/reel",
              video: { transcriptState: state, transcript: [] },
              description: null,
            }}
          />
        )
      );
      const status = host.querySelector('[role="status"]')!;
      expect(
        [...status.querySelectorAll("span")].map((s) => s.textContent)
      ).toEqual([...labels]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  }
);

const POSTER = "/preserved/poster.jpg";
const withPoster = (image: unknown) => ({
  sourceUrl: "https://youtu.be/abcdefghijk",
  video: null,
  description: null,
  image: image as never,
});

it("shows Spark's preserved poster behind Play when there is one, and never a third party's", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<VideoReader memory={withPoster({ thumbnailUrl: POSTER })} />)
    );
    const poster = host.querySelector("button img");
    expect(poster?.getAttribute("src")).toBe(POSTER);
    expect(poster?.getAttribute("alt")).toBe("");
    // The label stays a button name, whatever is behind it.
    expect(host.querySelector("button")?.textContent).toBe("Play At 0:00");
    // A poster that will not load leaves the plain panel, still playable.
    await act(async () => {
      poster!.dispatchEvent(new Event("error"));
    });
    expect(host.querySelector("button img")).toBeNull();
    expect(host.querySelector("button")?.textContent).toBe("Play At 0:00");
    expect(host.querySelector("iframe")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("is a flat panel with no poster, and Play names its moment in Title Case", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <VideoReader
          memory={{
            ...withPoster(null),
            sourceUrl: "https://youtu.be/abcdefghijk?t=3725",
          }}
        />
      )
    );
    expect(host.querySelector("img")).toBeNull();
    const play = host.querySelector("button")!;
    expect(play.textContent).toBe("Play At 1:02:05");
    expect(play.className).toContain("aspect-video");
    expect(play.className).toContain("pointer-coarse:min-h-(--size-touch)");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
