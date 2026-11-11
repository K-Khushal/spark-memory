import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  searchSession,
  shownAnswer,
  type Answer,
  type Hit,
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

function setup(
  pauseMs = 300,
  {
    cache = new Map(),
    scope = "ana",
  }: { cache?: Map<string, Hit[]>; scope?: string } = {}
) {
  const pending: Pending[] = [];
  const answers: (Answer | undefined)[] = [];
  const session = searchSession({
    pauseMs,
    cache,
    scope,
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

  it("never answers one account from another's cache", async () => {
    const cache = new Map<string, Hit[]>();
    const ana = setup(0, { cache, scope: "ana" });
    ana.session.set({ query: "purple" }, 1);
    await settle();
    ana.find("full", "purple").answer(["anas"]);
    await settle();
    const ben = setup(0, { cache, scope: "ben" });
    ben.session.set({ query: "purple" }, 1);
    expect(ben.answers).toEqual([]);
    expect(ben.pending.map((p) => p.mode)).toEqual(["instant", "full"]);
  });
});

describe("shownAnswer", () => {
  const hits = (key: string): Answer => ({ key, mode: "full", hits: [] });
  const failed: Answer = { key: "q:tea", mode: "instant", failed: true };

  it("shows the answer to the current search, or to its start while typing on", () => {
    expect(shownAnswer(hits("q:purple"), "q:purple", false)).toBeDefined();
    expect(shownAnswer(hits("q:purp"), "q:purple", false)).toBeDefined();
  });

  it("never shows another search's answer in the menu", () => {
    expect(shownAnswer(hits("q:tea"), "q:purple", false)).toBeUndefined();
    expect(shownAnswer(hits("q:purple"), "q:purp", false)).toBeUndefined();
    expect(shownAnswer(hits("q:purple"), "like:m1", false)).toBeUndefined();
  });

  it("keeps the previous results on the wall until the new answer lands, never a failure", () => {
    expect(shownAnswer(hits("q:tea"), "q:purple", true)?.key).toBe("q:tea");
    expect(shownAnswer(hits("q:tea"), "like:m1", true)?.key).toBe("q:tea");
    expect(shownAnswer(failed, "q:purple", true)).toBeUndefined();
    expect(shownAnswer(failed, "q:tea", true)).toBe(failed);
  });

  it("shows nothing once there is no search", () => {
    expect(shownAnswer(hits("q:tea"), undefined, true)).toBeUndefined();
  });
});
