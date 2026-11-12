import { describe, expect, it, vi } from "vitest";
import { decideShare, drainShares, type Hold, type Locks } from "./drain";
import type { PendingShare } from "./hold";
import type { ShareLibrary } from "./share";

const share = (text: string, verified = true): PendingShare => ({
  id: crypto.randomUUID(),
  verified,
  title: "",
  text,
  url: "",
  files: [],
});

/** An in-memory hold, like the IndexedDB one: shared by every "tab". */
function memoryHold(...shares: PendingShare[]): Hold & { size: () => number } {
  const store = new Map(shares.map((s, i) => [i + 1, s]));
  return {
    held: async () => [...store].map(([key, share]) => ({ key, share })),
    get: async (key) => store.get(key as number),
    drop: async (keys) => keys.forEach((key) => store.delete(key as number)),
    size: () => store.size,
  };
}

/** Web Locks: one holder per name, the rest queue in order. */
function fakeLocks(): Locks {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: (name, run) => {
      const result = (tails.get(name) ?? Promise.resolve()).then(run);
      tails.set(
        name,
        result.catch(() => {})
      );
      return result;
    },
  };
}

const lib = (
  captured: string[][] = [],
  outcome: () => Promise<"stored"> = async () => "stored"
): ShareLibrary => ({
  captureShared: vi.fn(async (text: string, id: string) => {
    captured.push([text, id]);
    return outcome();
  }),
  captureSharedImages: vi.fn(async () => []),
});

const live = () => true;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("drainShares", () => {
  it("Captures a share under its id, then lets it go", async () => {
    const one = share("hello");
    const hold = memoryHold(one);
    const captured: string[][] = [];
    await drainShares({
      hold,
      locks: fakeLocks(),
      library: lib(captured),
      notify: vi.fn(),
      live,
    });
    expect(captured).toEqual([["hello", one.id]]);
    expect(hold.size()).toBe(0);
  });

  it("two tabs mounting at once Capture a share once", async () => {
    const hold = memoryHold(share("once"), share("twice"));
    const locks = fakeLocks();
    const captured: string[][] = [];
    const tab = () =>
      drainShares({
        hold,
        locks,
        library: lib(captured),
        notify: vi.fn(),
        live,
      });
    await Promise.all([tab(), tab()]);
    expect(captured.map(([text]) => text).sort()).toEqual(["once", "twice"]);
    expect(hold.size()).toBe(0);
  });

  it("when two claims slip through anyway, both carry the same id", async () => {
    const one = share("race");
    const hold = memoryHold(one);
    const captured: string[][] = [];
    const tab = () =>
      drainShares({ hold, library: lib(captured), notify: vi.fn(), live });
    await Promise.all([tab(), tab()]);
    expect(captured.map(([, id]) => id)).toEqual([one.id, one.id]);
  });

  it("keeps a share while its Capture is still on its way", async () => {
    const hold = memoryHold(share("slow"));
    let finish: (value: "stored") => void = () => {};
    const slow = () => new Promise<"stored">((resolve) => (finish = resolve));
    const done = drainShares({
      hold,
      locks: fakeLocks(),
      library: lib([], slow),
      notify: vi.fn(),
      live,
    });
    await tick();
    expect(hold.size()).toBe(1);
    finish("stored");
    await done;
    expect(hold.size()).toBe(0);
  });

  it("a tab closed mid-Capture loses nothing: the next one sends the same id", async () => {
    const one = share("interrupted");
    const hold = memoryHold(one);
    const never = () => new Promise<"stored">(() => {});
    const first: string[][] = [];
    void drainShares({
      hold,
      locks: fakeLocks(),
      library: lib(first, never),
      notify: vi.fn(),
      live,
    });
    await tick();
    expect(hold.size()).toBe(1); // the tab is gone; nothing was dropped
    const second: string[][] = [];
    await drainShares({
      hold,
      locks: fakeLocks(),
      library: lib(second),
      notify: vi.fn(),
      live,
    });
    expect(second).toEqual([["interrupted", one.id]]);
    expect(first[0]?.[1]).toBe(one.id);
    expect(hold.size()).toBe(0);
  });

  it("does nothing once the page that asked has gone", async () => {
    const hold = memoryHold(share("late"));
    const captured: string[][] = [];
    await drainShares({
      hold,
      locks: fakeLocks(),
      library: lib(captured),
      notify: vi.fn(),
      live: () => false,
    });
    expect(captured).toEqual([]);
    expect(hold.size()).toBe(1);
  });

  it("goes on to the next share when one cannot be Captured", async () => {
    const hold = memoryHold(share("bad"), share("good"));
    const captured: string[][] = [];
    const library = lib(captured);
    vi.mocked(library.captureShared).mockRejectedValueOnce(new Error("boom"));
    await drainShares({
      hold,
      locks: fakeLocks(),
      library,
      notify: vi.fn(),
      live,
    });
    expect(captured.map(([text]) => text)).toEqual(["good"]);
    expect(hold.size()).toBe(1); // "bad" stays for the next time
  });
});

describe("shares that could have come from another site", () => {
  it("are left held, uncaptured, and handed back to ask the person", async () => {
    const hold = memoryHold(share("sent by a page", false), share("fine"));
    const captured: string[][] = [];
    const asked = await drainShares({
      hold,
      locks: fakeLocks(),
      library: lib(captured),
      notify: vi.fn(),
      live,
    });
    expect(captured.map(([text]) => text)).toEqual(["fine"]);
    expect(asked.map(({ share }) => share.text)).toEqual(["sent by a page"]);
    expect(hold.size()).toBe(1);
  });

  it("Capture only after the person agrees, then let go", async () => {
    const maybe = share("sent by a page", false);
    const hold = memoryHold(maybe);
    const captured: string[][] = [];
    await decideShare({
      hold,
      locks: fakeLocks(),
      library: lib(captured),
      notify: vi.fn(),
      key: 1,
      capture: true,
    });
    expect(captured).toEqual([["sent by a page", maybe.id]]);
    expect(hold.size()).toBe(0);
  });

  it("are dropped, never Captured, when the person discards them", async () => {
    const hold = memoryHold(share("sent by a page", false));
    const captured: string[][] = [];
    await decideShare({
      hold,
      locks: fakeLocks(),
      library: lib(captured),
      notify: vi.fn(),
      key: 1,
      capture: false,
    });
    expect(captured).toEqual([]);
    expect(hold.size()).toBe(0);
  });

  it("a second tab answering the same share does nothing", async () => {
    const hold = memoryHold(share("sent by a page", false));
    const locks = fakeLocks();
    const captured: string[][] = [];
    const answer = () =>
      decideShare({
        hold,
        locks,
        library: lib(captured),
        notify: vi.fn(),
        key: 1,
        capture: true,
      });
    await Promise.all([answer(), answer()]);
    expect(captured).toHaveLength(1);
  });
});
