import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  searchSession,
  type Answer,
  type Mode,
  type SearchRequest,
} from "./search-session";

// The instant-then-full search state machine against a fake server whose
// answers the test releases in any order.

type Pending = {
  request: SearchRequest;
  mode: Mode;
  signal: AbortSignal;
  answer: (ids: string[], final?: boolean) => void;
  fail: () => void;
};

function setup(pauseMs = 300) {
  const pending: Pending[] = [];
  const answers: (Answer | undefined)[] = [];
  const session = searchSession({
    pauseMs,
    cache: new Map(),
    fetch: (request, mode, signal) =>
      new Promise((resolve, reject) =>
        pending.push({
          request,
          mode,
          signal,
          answer: (ids, final = true) =>
            resolve({
              hits: ids.map((id) => ({ id, match: "direct", part: null })),
              final,
            }),
          fail: () => reject(new Error("offline")),
        })
      ),
    onAnswer: (answer) => answers.push(answer),
  });
  const last = () => answers.at(-1);
  const ids = () => {
    const a = last();
    return a && "hits" in a ? [a.mode, a.hits.map((h) => h.id)] : a;
  };
  const find = (mode: Mode, q: string) =>
    pending.find(
      (p) => p.mode === mode && "query" in p.request && p.request.query === q
    )!;
  return { session, pending, answers, last, ids, find };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("searchSession", () => {
  it("answers instantly per keystroke, then fully after a pause in typing", async () => {
    const s = setup();
    s.session.set({ query: "pur" }, 0);
    s.session.set({ query: "purple" }, 0);
    expect(s.pending.map((p) => p.mode)).toEqual(["instant", "instant"]);
    expect(s.pending[0]!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(299);
    expect(s.pending.filter((p) => p.mode === "full")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.find("full", "purple")).toBeDefined();

    s.find("instant", "purple").answer(["a"]);
    await settle();
    expect(s.ids()).toEqual(["instant", ["a"]]);
    s.find("full", "purple").answer(["b", "a"]);
    await settle();
    expect(s.ids()).toEqual(["full", ["b", "a"]]);
  });

  it("never lets a late instant answer replace the full one", async () => {
    const s = setup(0);
    s.session.set({ query: "purple" }, 0);
    await settle();
    s.find("full", "purple").answer(["b"]);
    await settle();
    s.find("instant", "purple").answer(["a"]);
    await settle();
    expect(s.ids()).toEqual(["full", ["b"]]);
  });

  it("drops answers to a query the person has typed past", async () => {
    const s = setup(0);
    s.session.set({ query: "pur" }, 0);
    await settle();
    s.session.set({ query: "purple" }, 0);
    s.find("full", "pur").answer(["stale"]);
    s.find("instant", "pur").answer(["stale"]);
    await settle();
    expect(s.answers).toEqual([]);
  });

  it("keeps the instant answer when the full search fails", async () => {
    const s = setup(0);
    s.session.set({ query: "purple" }, 0);
    await settle();
    s.find("instant", "purple").answer(["a"]);
    await settle();
    s.find("full", "purple").fail();
    await settle();
    expect(s.ids()).toEqual(["instant", ["a"]]);
  });

  it("says it failed only when nothing answered", async () => {
    const s = setup(0);
    s.session.set({ query: "purple" }, 0);
    await settle();
    s.find("instant", "purple").fail();
    s.find("full", "purple").fail();
    await settle();
    expect(s.last()).toMatchObject({ failed: true });
  });

  it("answers from the cache what it already searched fully, with no request", async () => {
    const s = setup(0);
    s.session.set({ query: "purple" }, 3);
    await settle();
    s.find("full", "purple").answer(["b"]);
    await settle();
    s.pending.length = 0;
    s.session.set({ query: "purple" }, 3);
    expect(s.pending).toEqual([]);
    expect(s.ids()).toEqual(["full", ["b"]]);
    // Once the Library changed, it searches again.
    s.session.set({ query: "purple" }, 4);
    expect(s.pending.map((p) => p.mode)).toEqual(["instant", "full"]);
  });

  it("never keeps a full search that fell back to keywords", async () => {
    const s = setup(0);
    s.session.set({ query: "purple" }, 3);
    await settle();
    s.find("full", "purple").answer(["a"], false);
    await settle();
    expect(s.ids()).toEqual(["full", ["a"]]);
    s.pending.length = 0;
    s.session.set({ query: "purple" }, 3);
    expect(s.pending.map((p) => p.mode)).toEqual(["instant", "full"]);
  });

  it("finds More Like This in one full request", async () => {
    const s = setup();
    s.session.set({ like: "m1" }, 0);
    expect(s.pending.map((p) => [p.mode, p.request])).toEqual([
      ["full", { like: "m1" }],
    ]);
  });

  it("forgets the answer when the search is closed, and stops its requests", async () => {
    const s = setup();
    s.session.set({ query: "purple" }, 0);
    s.session.set(undefined, 0);
    expect(s.pending[0]!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.pending.length).toBe(1);
    expect(s.last()).toBeUndefined();
  });
});
