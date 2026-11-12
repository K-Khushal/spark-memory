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
  pages: null,
  body: "Some text",
  captureNote: null,
  preservation: "preserved",
  indexState: "indexing",
  indexError: null,
  indexTitle: null,
  aiOptOut: false,
  hasVectors: false,
  deepFetch: null,
  revision: 1,
  capturedAt: "2026-11-10T10:00:00.000Z",
  lastSavedAt: "2026-11-10T10:00:00.000Z",
  sourceUrl: null,
  pageTitle: null,
  description: null,
  updatedAt: "2026-11-10T10:00:00.000Z",
  image: null,
  ...over,
});

function setup(
  transport: Partial<IndexingTransport>,
  initial: WallMemory[],
  isPending: (id: string) => boolean = () => false
) {
  let wall = initial;
  const notify = vi.fn();
  const onChanged = vi.fn();
  const actions = indexingActions({
    setMemories: (update) => {
      wall = typeof update === "function" ? update(wall) : update;
    },
    transport: transport as IndexingTransport,
    notify: notify as never,
    isPending,
    onChanged,
  });
  return { actions, wall: () => wall, notify, onChanged };
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

  it("says the Library changed when Indexing finishes, so open searches run again", async () => {
    const m = memory();
    let answer: Memory = m;
    const { actions, wall, onChanged } = setup({ poll: async () => [answer] }, [
      m,
    ]);
    await actions.poll([m.id]);
    expect(onChanged).not.toHaveBeenCalled();
    answer = { ...m, indexState: "searchable", hasVectors: true };
    await actions.poll([m.id]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(wall()[0]).toMatchObject({ hasVectors: true });
  });

  it("says the Library changed once the server answers an AI opt-out switch", async () => {
    const m = memory({ indexState: "searchable", hasVectors: true });
    const { actions, wall, onChanged } = setup(
      {
        setAiOptOut: async (_id, on) => ({
          ...m,
          aiOptOut: on,
          hasVectors: false,
          deepFetch: null,
        }),
      },
      [m]
    );
    await actions.setAiOptOut(m, true);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(wall()[0]).toMatchObject({ aiOptOut: true, hasVectors: false });
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

  it("keeps asking after a Memory whose Deep fetch is under way, but not one waiting an hour", () => {
    const fetching = memory({
      indexState: "searchable",
      deepFetch: "fetching",
    });
    const waiting = memory({ indexState: "searchable", deepFetch: "waiting" });
    const failed = memory({ indexState: "searchable", deepFetch: "failed" });
    expect(indexingIds([fetching, waiting, failed])).toEqual([fetching.id]);
  });

  it("Try Again on Deep fetch shows Fetching at once, and rolls back with a message if refused", async () => {
    const failed = memory({ indexState: "searchable", deepFetch: "failed" });
    let reject!: () => void;
    const { actions, wall, notify } = setup(
      { retryDeepFetch: () => new Promise((_, no) => (reject = () => no())) },
      [failed]
    );
    const done = actions.retryDeepFetch(failed);
    expect(wall()[0]).toMatchObject({ deepFetch: "fetching" });
    reject();
    await done;
    expect(wall()[0]).toMatchObject({ deepFetch: "failed" });
    expect(notify).toHaveBeenCalledWith("Try Again Did Not Finish");
  });

  it("takes the server's Deep fetch state and the text it found", async () => {
    const m = memory({
      kind: "link",
      indexState: "searchable",
      preservation: "reference_only",
      body: null,
      deepFetch: "fetching",
    });
    const { actions, wall } = setup(
      {
        poll: async () => [
          { ...m, deepFetch: null, preservation: "preserved", body: "Found" },
        ],
      },
      [m]
    );
    await actions.poll([m.id]);
    expect(wall()[0]).toMatchObject({
      deepFetch: null,
      preservation: "preserved",
      body: "Found",
    });
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
      hasVectors: false,
      deepFetch: null,
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
    // One miss can be a race; two in a row is gone.
    await actions.poll([kept.id, deleted.id]);
    expect(actions.pollable([kept, deleted])).toEqual([kept.id, deleted.id]);
    await actions.poll([kept.id, deleted.id]);
    expect(actions.pollable([kept, deleted])).toEqual([kept.id]);
  });

  it("keeps asking after a Capture polled before the server saved it", async () => {
    const m = memory();
    let pending = true;
    let saved = false;
    const poll = vi.fn(async () =>
      saved ? [{ ...m, indexState: "searchable" as const }] : []
    );
    const { actions, wall } = setup({ poll }, [m], () => pending);
    // A slow create (or Try Again of it): misses while it is out never count.
    for (let i = 0; i < 3; i++) await actions.poll([m.id]);
    expect(actions.pollable(wall())).toEqual([m.id]);
    pending = false;
    // Saved now, but the first poll after can still race it.
    await actions.poll([m.id]);
    expect(actions.pollable(wall())).toEqual([m.id]);
    saved = true;
    await actions.poll([m.id]);
    expect(wall()[0]!.indexState).toBe("searchable");
  });

  it("asks again about a Memory once it is sent again (Try Again)", async () => {
    const m = memory();
    let pending = false;
    const poll = vi.fn(async (): Promise<Memory[]> => []);
    const { actions, wall } = setup({ poll }, [m], () => pending);
    await actions.poll([m.id]);
    await actions.poll([m.id]);
    expect(actions.pollable(wall())).toEqual([]);
    pending = true;
    expect(actions.pollable(wall())).toEqual([m.id]);
    // After the render that showed it sent again.
    actions.restartMisses(wall());
    pending = false;
    // Its misses start over: one more is not enough to drop it.
    await actions.poll([m.id]);
    expect(actions.pollable(wall())).toEqual([m.id]);
  });

  it("changes nothing while the wall renders, however often it asks", async () => {
    const m = memory();
    let pending = false;
    const poll = vi.fn(async (): Promise<Memory[]> => []);
    const { actions, wall } = setup({ poll }, [m], () => pending);
    await actions.poll([m.id]);
    await actions.poll([m.id]);
    pending = true;
    // A render (StrictMode renders twice, and may throw one away) asks while
    // it is pending: asked after, but its misses are not touched.
    expect(actions.pollable(wall())).toEqual([m.id]);
    expect(actions.pollable(wall())).toEqual([m.id]);
    pending = false;
    expect(actions.pollable(wall())).toEqual([]);
  });
});

describe("a link while it Indexes", () => {
  it("takes what gathering found from the poll: page title, description, text and Preservation", async () => {
    const link = memory({
      kind: "link",
      body: null,
      sourceUrl: "https://garden.test/",
      preservation: "reference_only",
    });
    const found = {
      ...link,
      indexState: "searchable" as const,
      preservation: "preserved" as const,
      pageTitle: "Growing Basil",
      description: "A guide",
      body: "The article",
      title: "Changed elsewhere",
    };
    const { actions, wall } = setup(
      { poll: vi.fn().mockResolvedValue([found]) },
      [link]
    );
    await actions.poll([link.id]);
    expect(wall()[0]).toMatchObject({
      preservation: "preserved",
      pageTitle: "Growing Basil",
      description: "A guide",
      body: "The article",
      // The person's own fields stay as the wall has them.
      title: null,
    });
  });
});

describe("a PDF while it Indexes", () => {
  it("takes the text Indexing kept from the poll, so a search opens it at the right page", async () => {
    const pdf = memory({ kind: "pdf", body: null, pages: 3 });
    const found = {
      ...pdf,
      indexState: "searchable" as const,
      body: "One\fTwo\fThree",
    };
    const { actions, wall } = setup(
      { poll: vi.fn().mockResolvedValue([found]) },
      [pdf]
    );
    await actions.poll([pdf.id]);
    expect(wall()[0]).toMatchObject({
      indexState: "searchable",
      body: "One\fTwo\fThree",
    });
  });
});
