import { describe, expect, it, vi } from "vitest";
import {
  libraryActions,
  type Memory,
  type Transport,
  type WallMemory,
} from "./library-actions";

// The optimistic Library actions against a fake server (the Transport seam).

const memory = (over: Partial<Memory> = {}): Memory => ({
  id: crypto.randomUUID(),
  kind: "text",
  title: null,
  body: "Some text",
  captureNote: null,
  preservation: "preserved",
  indexState: "searchable",
  revision: 1,
  capturedAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:00:00.000Z",
  ...over,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(transport: Partial<Transport>, initial: WallMemory[] = []) {
  let wall = initial;
  const notify = vi.fn();
  const onSaved = vi.fn();
  const actions = libraryActions({
    setMemories: (update) => {
      wall = typeof update === "function" ? update(wall) : update;
    },
    transport: {
      create: vi.fn(),
      patch: vi.fn(),
      remove: vi.fn(),
      get: vi.fn(),
      ...transport,
    } as Transport,
    notify: notify as never,
    onSaved,
  });
  return { actions, wall: () => wall, notify, onSaved };
}

/** The action a toast offered, by its label. */
function toastAction(notify: ReturnType<typeof vi.fn>, label: string) {
  for (const [, options] of notify.mock.calls) {
    if (options?.action?.label === label) return options.action.onClick;
  }
  throw new Error(`no toast offered ${label}`);
}

describe("editing a Memory", () => {
  it("sends edits one at a time, so a late answer never undoes a newer edit", async () => {
    const m = memory();
    const answers = [deferred<Memory>(), deferred<Memory>()];
    const patch = vi
      .fn()
      .mockReturnValueOnce(answers[0]!.promise)
      .mockReturnValueOnce(answers[1]!.promise);
    const { actions, wall } = setup({ patch }, [m]);

    void actions.edit(m, { title: "First" });
    void actions.edit(m, { title: "Second" });
    await settle();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(wall()[0]?.title).toBe("Second");

    answers[0]!.resolve({ ...m, title: "First", revision: 2 });
    await settle();
    expect(wall()[0]?.title).toBe("Second");
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[1]![1]).toMatchObject({
      title: "Second",
      revision: 2,
    });

    answers[1]!.resolve({ ...m, title: "Second", revision: 3 });
    await settle();
    expect(wall()[0]).toMatchObject({ title: "Second", revision: 3 });
  });

  it("shows the saved copy when the server refuses a stale edit", async () => {
    const m = memory();
    const server = { ...m, title: "From another window", revision: 4 };
    const { actions, wall, notify } = setup(
      {
        patch: vi.fn().mockResolvedValue("stale"),
        get: vi.fn().mockResolvedValue(server),
      },
      [m]
    );
    await actions.edit(m, { title: "Mine" });
    expect(wall()[0]).toEqual(server);
    expect(notify).toHaveBeenCalledWith(
      "Changes Did Not Save",
      expect.anything()
    );
  });

  it("asks the browser to carry a save past page close only when it fits in bytes", async () => {
    const m = memory();
    const patch = vi.fn().mockImplementation(async (_id, json) => ({
      ...m,
      ...json,
    }));
    const { actions } = setup({ patch }, [m]);
    await actions.edit(m, { body: "short" });
    // 40,000 characters, but 80,000 bytes of UTF-8: over keepalive's 64 KB.
    await actions.edit(m, { body: "é".repeat(40_000) });
    expect(patch.mock.calls[0]![2]).toEqual({ keepalive: true });
    expect(patch.mock.calls[1]![2]).toEqual({ keepalive: false });
  });
});

describe("Undo of a Capture", () => {
  it("brings the Memory back with a message when the delete fails", async () => {
    const saved = memory({ body: "Keep me" });
    const { actions, wall, notify } = setup({
      create: vi.fn().mockResolvedValue(saved),
      remove: vi.fn().mockRejectedValue(new Error("offline")),
    });
    actions.capture("Keep me");
    await settle();
    toastAction(notify, "Undo")();
    expect(wall()).toEqual([]);
    await settle();
    expect(wall().map((m) => m.body)).toEqual(["Keep me"]);
    expect(notify).toHaveBeenCalledWith(
      "Undo Did Not Finish",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Try Again" }),
      })
    );
  });
});

describe("search freshness", () => {
  it("is told after every Capture, edit and delete that reaches the server", async () => {
    const m = memory();
    const { actions, onSaved, notify } = setup(
      {
        create: vi.fn().mockImplementation(async (input) => memory(input)),
        patch: vi.fn().mockResolvedValue({ ...m, title: "New", revision: 2 }),
        remove: vi.fn().mockResolvedValue(undefined),
      },
      [m]
    );
    actions.capture("Fresh text");
    await settle();
    expect(onSaved).toHaveBeenCalledTimes(1);
    await actions.edit(m, { title: "New" });
    expect(onSaved).toHaveBeenCalledTimes(2);
    actions.remove(m);
    const deleted = notify.mock.calls.find(([title]) => title === "Deleted");
    deleted![1].onAutoClose();
    await settle();
    expect(onSaved).toHaveBeenCalledTimes(3);
  });
});
