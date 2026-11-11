import { describe, expect, it, vi } from "vitest";
import {
  indexingActions,
  indexingIds,
  nextPollDelay,
  POLL,
  type IndexingTransport,
} from "./indexing-actions";
import type { Memory, WallMemory } from "./library-actions";

const memory = (over: Partial<Memory> = {}): Memory => ({
  id: crypto.randomUUID(),
  kind: "text",
  title: null,
  body: "Some text",
  captureNote: null,
  preservation: "preserved",
  indexState: "indexing",
  indexError: null,
  indexTitle: null,
  aiOptOut: false,
  revision: 1,
  capturedAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:00:00.000Z",
  image: null,
  ...over,
});

function setup(transport: Partial<IndexingTransport>, initial: WallMemory[]) {
  let wall = initial;
  const notify = vi.fn();
  const actions = indexingActions({
    setMemories: (update) => {
      wall = typeof update === "function" ? update(wall) : update;
    },
    transport: transport as IndexingTransport,
    notify: notify as never,
  });
  return { actions, wall: () => wall, notify };
}

describe("Index state on the wall", () => {
  it("polls only Memories Indexing whose upload is done", () => {
    const a = memory();
    const b = memory({ indexState: "searchable" });
    const c: WallMemory = { ...memory(), upload: { step: "stranded" } };
    expect(indexingIds([a, b, c])).toEqual([a.id]);
  });

  it("backs off while nothing changes, up to 30 seconds", () => {
    let delay = POLL.first;
    for (let i = 0; i < 20; i++) delay = nextPollDelay(delay);
    expect(nextPollDelay(POLL.first)).toBe(3000);
    expect(delay).toBe(POLL.max);
  });

  it("takes the Index state from the server and keeps the wall's own edits", async () => {
    const m = memory({ title: "Typed here" });
    const { actions, wall } = setup(
      {
        poll: async () => [
          {
            ...m,
            title: "Older",
            indexState: "searchable",
            indexTitle: "Named",
          },
        ],
      },
      [m]
    );
    await actions.poll([m.id]);
    expect(wall()[0]).toMatchObject({
      title: "Typed here",
      indexState: "searchable",
      indexTitle: "Named",
    });
  });

  it("Retry shows Indexing at once, and rolls back with a message if refused", async () => {
    const failed = memory({ indexState: "failed", indexError: "unavailable" });
    let reject!: () => void;
    const { actions, wall, notify } = setup(
      {
        retryIndexing: () => new Promise((_, no) => (reject = () => no())),
      },
      [failed]
    );
    const done = actions.retryIndexing(failed);
    expect(wall()[0]).toMatchObject({
      indexState: "indexing",
      indexError: null,
    });
    reject();
    await done;
    expect(wall()[0]).toMatchObject({
      indexState: "failed",
      indexError: "unavailable",
    });
    expect(notify).toHaveBeenCalledWith("Retry Did Not Finish");
  });

  it("AI opt-out turns Searchable at once and forgets the title Indexing gave", async () => {
    const m = memory({ indexState: "searchable", indexTitle: "Named" });
    const setAiOptOut = vi.fn(async () => ({
      ...m,
      aiOptOut: true,
      indexTitle: null,
    }));
    const { actions, wall } = setup({ setAiOptOut }, [m]);
    await actions.setAiOptOut(m, true);
    expect(setAiOptOut).toHaveBeenCalledWith(m.id, true);
    expect(wall()[0]).toMatchObject({
      aiOptOut: true,
      indexState: "searchable",
      indexTitle: null,
    });
  });

  it("sends AI opt-out switches one at a time, the latest winning", async () => {
    const m = memory({ indexState: "searchable" });
    const answers: ((on: boolean) => void)[] = [];
    const setAiOptOut = vi.fn(
      (_id: string, on: boolean) =>
        new Promise<Memory>((done) =>
          answers.push(() => done({ ...m, aiOptOut: on }))
        )
    );
    const { actions, wall } = setup({ setAiOptOut }, [m]);
    const first = actions.setAiOptOut(m, true);
    void actions.setAiOptOut(m, false);
    void actions.setAiOptOut(m, true);
    expect(setAiOptOut).toHaveBeenCalledTimes(1);
    answers[0]!(true);
    await vi.waitFor(() => expect(setAiOptOut).toHaveBeenCalledTimes(2));
    // The switches in between collapse into the latest.
    expect(setAiOptOut.mock.calls.map((c) => c[1])).toEqual([true, true]);
    answers[1]!(true);
    await first;
    expect(wall()[0]!.aiOptOut).toBe(true);
  });

  it("rolls a failed series of switches back to where it started", async () => {
    const m = memory({ indexState: "searchable", aiOptOut: false });
    const { actions, wall, notify } = setup(
      { setAiOptOut: async () => Promise.reject(new Error("down")) },
      [m]
    );
    await actions.setAiOptOut(m, true);
    expect(wall()[0]).toMatchObject({
      aiOptOut: false,
      indexState: "searchable",
    });
    expect(notify).toHaveBeenCalledWith("AI Opt-Out Did Not Change");
  });

  it("stops asking after a Memory the server no longer has", async () => {
    const kept = memory();
    const deleted = memory();
    const poll = vi.fn(async () => [kept]);
    const { actions } = setup({ poll }, [kept, deleted]);
    expect(actions.pollable([kept, deleted])).toEqual([kept.id, deleted.id]);
    await actions.poll([kept.id, deleted.id]);
    expect(actions.pollable([kept, deleted])).toEqual([kept.id]);
  });
});
