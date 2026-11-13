/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FREE_ALLOWANCE } from "@spark/core";
import { nameOf, UsageSection, type Heaviest, type Usage } from "./usage";

const MB = 1024 * 1024;

const usage = (over: Partial<Usage> = {}): Usage => ({
  storage: { used: 412 * MB, limit: FREE_ALLOWANCE.storageBytes },
  captures: { used: 7, limit: FREE_ALLOWANCE.capturesPerDay },
  deepFetches: { used: 2, limit: FREE_ALLOWANCE.deepFetchesPerDay },
  resetsAt: "2026-11-14T00:00:00.000Z",
  largest: [],
  ...over,
});

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;

async function show(value: Usage, onDelete = vi.fn(async () => true)) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(<UsageSection usage={value} onDelete={onDelete} />)
  );
  return onDelete;
}

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const meters = () =>
  [...host.querySelectorAll('[role="meter"]')].map((m) => ({
    name: document.getElementById(m.getAttribute("aria-labelledby")!)
      ?.textContent,
    now: m.getAttribute("aria-valuenow"),
    max: m.getAttribute("aria-valuemax"),
    text: m.getAttribute("aria-valuetext"),
    width: (m.firstElementChild as HTMLElement).style.width,
  }));

describe("Usage in Settings", () => {
  it("shows each counted limit as a labelled meter with its value in words", async () => {
    await show(usage());
    expect(meters()).toEqual([
      {
        name: "Storage",
        now: String(412 * MB),
        max: String(FREE_ALLOWANCE.storageBytes),
        text: "412 MB of 1 GB",
        width: "40.23%",
      },
      {
        name: "Captures Today",
        now: "7",
        max: "100",
        text: expect.stringMatching(/^7 of 100\. Resets at /),
        width: "7%",
      },
      {
        name: "Deep Fetches Today",
        now: "2",
        max: "20",
        text: expect.stringMatching(/^2 of 20\. Resets at /),
        width: "10%",
      },
    ]);
  });

  it("explains nothing in words: no paragraph, only labels and values", async () => {
    await show(usage());
    expect(host.querySelector("p")).toBeNull();
    expect(host.textContent).toBe(
      "Storage412 MB of 1 GBCaptures Today7 of 100Deep Fetches Today2 of 20"
    );
  });

  it("is empty, exactly full and past full without leaving its bar", async () => {
    await show(
      usage({
        storage: { used: 0, limit: FREE_ALLOWANCE.storageBytes },
        captures: { used: 100, limit: 100 },
        deepFetches: { used: 25, limit: 20 },
      })
    );
    const [storage, captures, fetches] = meters();
    expect([storage!.width, captures!.width, fetches!.width]).toEqual([
      "0%",
      "100%",
      "100%",
    ]);
    expect(fetches!.now).toBe("20");
    expect(fetches!.text).toMatch(/^25 of 20\./);
  });

  it("lists what takes the most storage only when storage is nearly full", async () => {
    const largest: Heaviest[] = [
      { id: "a", kind: "pdf", title: "Lease", sourceUrl: null, bytes: 9 * MB },
    ];
    await show(usage({ largest }));
    expect(host.querySelector("ul")).toBeNull();
    await act(async () => root.unmount());
    host.remove();

    await show(
      usage({
        storage: {
          used: 0.8 * FREE_ALLOWANCE.storageBytes,
          limit: FREE_ALLOWANCE.storageBytes,
        },
        largest,
      })
    );
    expect(host.querySelector("ul")?.getAttribute("aria-label")).toBe(
      "Largest Memories"
    );
    expect(host.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Delete Lease, 9 MB"
    );
  });

  it("asks before it deletes, and deletes the one named", async () => {
    const onDelete = await show(
      usage({
        storage: {
          used: FREE_ALLOWANCE.storageBytes,
          limit: FREE_ALLOWANCE.storageBytes,
        },
        largest: [
          {
            id: "a",
            kind: "image",
            title: null,
            sourceUrl: null,
            bytes: 4 * MB,
          },
        ],
      })
    );
    await act(async () => host.querySelector("button")!.click());
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Delete Image?");
    const confirm = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Delete"
    )!;
    await act(async () => confirm.click());
    expect(onDelete).toHaveBeenCalledWith("a");
  });
});

describe("naming a Memory in the list (worst case)", () => {
  const row = (over: Partial<Heaviest>): Heaviest => ({
    id: "x",
    kind: "link",
    title: null,
    sourceUrl: null,
    bytes: 1,
    ...over,
  });

  it.each<[Partial<Heaviest>, string]>([
    [{ title: "  Lease  " }, "Lease"],
    [{ title: "   ", sourceUrl: "https://www.garden.test/a" }, "garden.test"],
    [{ sourceUrl: "not a url", kind: "pdf" }, "PDF"],
    [{ kind: "image" }, "Image"],
    [{ kind: "text" }, "Memory"],
    [
      { title: "مستند طويل جدا ".repeat(20) },
      "مستند طويل جدا ".repeat(20).trim(),
    ],
  ])("%j is called %j", (over, name) => {
    expect(nameOf(row(over))).toBe(name);
  });

  it("keeps a very long title on one truncating line, set by its own direction", async () => {
    await show(
      usage({
        storage: {
          used: FREE_ALLOWANCE.storageBytes,
          limit: FREE_ALLOWANCE.storageBytes,
        },
        largest: [row({ title: "x".repeat(400), bytes: 1023 * MB })],
      })
    );
    const title = host.querySelector("li span")!;
    expect(title.className).toContain("truncate");
    expect(title.getAttribute("dir")).toBe("auto");
    expect(host.querySelector("li")?.textContent).toContain("1023 MB");
  });
});
