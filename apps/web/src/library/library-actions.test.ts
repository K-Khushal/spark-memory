import { describe, expect, it, vi } from "vitest";
import { draftStore } from "./drafts";
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
  indexError: null,
  indexTitle: null,
  aiOptOut: false,
  hasVectors: false,
  revision: 1,
  capturedAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:00:00.000Z",
  image: null,
  ...over,
});

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(transport: Partial<Transport>, initial: WallMemory[] = []) {
  let wall = initial;
  const notify = vi.fn();
  const onSaved = vi.fn();
  const onCaptured = vi.fn();
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
    drafts: draftStore(undefined),
    notify: notify as never,
    onSaved,
    onCaptured,
  });
  return { actions, wall: () => wall, notify, onSaved, onCaptured };
}

/** The action a toast offered, by its label. */
function toastAction(notify: ReturnType<typeof vi.fn>, label: string) {
  for (const [, options] of notify.mock.calls) {
    if (options?.action?.label === label) return options.action.onClick;
  }
  throw new Error(`no toast offered ${label}`);
}

describe("Try Again on a Capture", () => {
  it("resends the same Memory, so a lost answer cannot make a duplicate", async () => {
    const saved = memory({ body: "Once only" });
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost"))
      .mockImplementationOnce(async (input) => ({ ...saved, ...input }));
    const { actions, wall, notify } = setup({ create });
    actions.capture("Once only", "note");
    await settle();
    expect(wall()).toEqual([]);
    toastAction(notify, "Try Again")();
    await settle();
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![0]).toEqual(create.mock.calls[0]![0]);
    expect(wall().map((m) => m.id)).toEqual([create.mock.calls[0]![0].id]);
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
    const { actions, onSaved, onCaptured, notify } = setup(
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
    expect(onCaptured).toHaveBeenCalledTimes(1);
    expect(onCaptured).toHaveBeenCalledWith("text");
    actions.editText(m, { title: "New", body: "Some text", captureNote: "" });
    actions.saveEdit(m.id);
    await settle();
    expect(onSaved).toHaveBeenCalledTimes(2);
    expect(onCaptured).toHaveBeenCalledTimes(1);
    actions.remove(m);
    const deleted = notify.mock.calls.find(([title]) => title === "Deleted");
    deleted![1].onAutoClose();
    await settle();
    expect(onSaved).toHaveBeenCalledTimes(3);
  });
});
