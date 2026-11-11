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
});
