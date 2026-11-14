import { describe, expect, it, vi } from "vitest";
import type { BulkOutbox, PendingBulk } from "./bulk-outbox";
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
  pages: null,
  body: "Some text",
  captureNote: null,
  preservation: "preserved",
  indexState: "searchable",
  indexError: null,
  indexTitle: null,
  sample: false,
  aiOptOut: false,
  hasVectors: false,
  deepFetch: null,
  categories: ["Other"],
  categoriesLocked: false,
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

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(
  transport: Partial<Transport>,
  initial: WallMemory[] = [],
  bulkOutbox?: BulkOutbox
) {
  let wall = initial;
  const notify = vi.fn();
  const onSaved = vi.fn();
  const onCaptured = vi.fn();
  const actions = libraryActions({
    bulkOutbox,
    setMemories: (update) => {
      wall = typeof update === "function" ? update(wall) : update;
    },
    transport: {
      create: vi.fn(),
      createLink: vi.fn(),
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

describe("Capture of a link", () => {
  const link = (over: Partial<Memory> = {}) =>
    memory({
      kind: "link",
      body: null,
      sourceUrl: "https://garden.test/basil",
      preservation: "reference_only",
      indexState: "indexing",
      ...over,
    });

  it("lands a link Memory when the paste is one URL, and sends it as a link", async () => {
    const createLink = vi.fn(async (input) => link({ id: input.id }));
    const create = vi.fn();
    const { actions, wall, notify, onCaptured } = setup({ createLink, create });
    expect(
      actions.capture("  https://garden.test/basil \n", "for spring")
    ).toBe(true);
    expect(wall()[0]).toMatchObject({
      kind: "link",
      sourceUrl: "https://garden.test/basil",
      body: null,
      indexState: "indexing",
      captureNote: "for spring",
    });
    expect(notify).toHaveBeenCalledWith("Captured", expect.anything());
    await settle();
    expect(create).not.toHaveBeenCalled();
    expect(createLink).toHaveBeenCalledWith(
      expect.objectContaining({
        id: wall()[0]!.id,
        url: "https://garden.test/basil",
        captureNote: "for spring",
      })
    );
    expect(onCaptured).toHaveBeenCalledWith("link");
  });

  it("keeps text with a link inside it as text", async () => {
    const create = vi.fn(async (input) => memory(input));
    const { actions } = setup({ create });
    actions.capture("see https://garden.test/basil");
    await settle();
    expect(create).toHaveBeenCalled();
  });

  it("puts the Memory already saved at the top and says so, when the page is in the Library", async () => {
    const older = link({
      id: crypto.randomUUID(),
      indexState: "searchable",
      lastSavedAt: "2026-11-01T10:00:00.000Z",
    });
    const newer = memory({ lastSavedAt: "2026-11-05T10:00:00.000Z" });
    const resurfaced = { ...older, lastSavedAt: "2026-11-11T10:00:00.000Z" };
    const { actions, wall, notify, onCaptured } = setup(
      { createLink: vi.fn().mockResolvedValue(resurfaced) },
      [newer, older]
    );
    actions.capture("https://garden.test/basil?utm_source=x");
    expect(wall()).toHaveLength(3);
    await settle();
    expect(wall().map((m) => m.id)).toEqual([older.id, newer.id]);
    expect(notify).toHaveBeenLastCalledWith(
      "Already in Your Library",
      expect.objectContaining({ action: undefined })
    );
    expect(onCaptured).not.toHaveBeenCalled();
  });
});

describe("an edit of a link", () => {
  it("keeps the page's title the page's until the person changes it", async () => {
    const link = memory({
      kind: "link",
      body: "Preserved text",
      sourceUrl: "https://garden.test/",
      pageTitle: "Growing Basil",
    });
    const patch = vi
      .fn()
      .mockResolvedValue({ ...link, captureNote: "n", revision: 2 });
    const { actions } = setup({ patch }, [link]);
    actions.openEdit(link);
    actions.editText(link, {
      title: "Growing Basil",
      body: "",
      captureNote: "n",
    });
    actions.saveEdit(link.id);
    await settle();
    expect(patch.mock.calls[0]![1]).toEqual({ captureNote: "n", revision: 1 });

    actions.editText(link, {
      title: "Basil, mine",
      body: "",
      captureNote: "n",
    });
    actions.saveEdit(link.id);
    await settle();
    expect(patch.mock.calls[1]![1]).toMatchObject({ title: "Basil, mine" });
  });
});

describe("Bulk Undo", () => {
  it("restores every Memory before any delete is sent", () => {
    const rows = [memory(), memory()];
    const bulk = vi.fn();
    const { actions, wall, notify } = setup({ bulk }, rows);
    actions.bulk(rows, { operation: "delete" });
    expect(wall()).toEqual([]);
    toastAction(notify, "Undo")();
    expect(wall()).toHaveLength(2);
    actions.sendPending();
    expect(bulk).not.toHaveBeenCalled();
  });
});

it("batches a thousand selected Memories and reports a failed batch for retry", async () => {
  const rows = Array.from({ length: 1001 }, () => memory());
  const bulk = vi
    .fn()
    .mockResolvedValue({ ids: [] })
    .mockRejectedValueOnce(new Error("offline"));
  const { actions, wall, notify } = setup({ bulk }, rows);
  actions.bulk(rows, { operation: "delete" });
  actions.sendPending();
  await settle();
  expect(bulk).toHaveBeenCalledTimes(6);
  expect(bulk.mock.calls[0]![0].ids).toHaveLength(200);
  expect(bulk.mock.calls[5]![0].ids).toHaveLength(1);
  expect(wall()).toHaveLength(200);
  expect(notify.mock.calls.at(-1)![0]).toBe("200 Memories Not Updated");
});
it("Undo restores the previous Categories on all Memories", () => {
  const rows = [
    memory({ categories: ["Recipe"] }),
    memory({ categories: ["Idea"] }),
  ];
  const bulk = vi.fn();
  const { actions, wall, notify } = setup({ bulk }, rows);
  actions.bulk(rows, { operation: "categories", categories: ["Code"] });
  expect(wall().every((m) => m.categoriesLocked)).toBe(true);
  toastAction(notify, "Undo")();
  expect(wall().map((m) => m.categories)).toEqual([["Recipe"], ["Idea"]]);
  actions.sendPending();
  expect(bulk).not.toHaveBeenCalled();
});

it("keeps 2,000 closing Memories within the shared keepalive budget", async () => {
  const rows = Array.from({ length: 2000 }, () => memory());
  let bytes = 0;
  const bulk = vi.fn((change, init) => {
    if (init.keepalive)
      bytes += new TextEncoder().encode(JSON.stringify(change)).length;
    return new Promise<{ ids: string[] }>(() => {});
  });
  const { actions } = setup({ bulk }, rows);
  actions.bulk(rows, { operation: "delete" });
  actions.bulk([memory()], { operation: "categories", categories: ["Code"] });
  actions.sendPending();
  await settle();
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThan(65536);
  expect(bulk).toHaveBeenCalledTimes(1);
});

it.each(["delete", "categories"] as const)(
  "resumes only unacknowledged %s batches after reload",
  async (operation) => {
    const records = new Map<string, PendingBulk>();
    const outbox: BulkOutbox = {
      list: async () => structuredClone([...records.values()]),
      put: async (record) => {
        records.set(record.key, structuredClone(record));
      },
      remove: async (key) => {
        records.delete(key);
      },
    };
    const rows = Array.from({ length: 401 }, () => memory());
    const bulk = vi
      .fn()
      .mockResolvedValueOnce({ ids: [] })
      .mockImplementation(() => new Promise(() => {}));
    const { actions } = setup({ bulk }, rows, outbox);
    actions.bulk(
      rows,
      operation === "delete"
        ? { operation }
        : { operation, categories: ["Code"] }
    );
    actions.sendPending();
    await settle();
    expect(bulk).toHaveBeenCalledTimes(2);
    const resumed = vi.fn().mockResolvedValue({ ids: [] });
    const reload = setup({ bulk: resumed }, rows, outbox);
    await reload.actions.resumeBulks();
    expect(resumed.mock.calls.map(([change]) => change.ids)).toEqual([
      rows.slice(200, 400).map((m) => m.id),
      [rows[400]!.id],
    ]);
    expect(resumed.mock.calls[0]![0].operation).toBe(operation);
    expect(await outbox.list()).toEqual([]);
    if (operation === "delete")
      expect(
        reload
          .wall()
          .filter((m) => rows.slice(200).some((row) => row.id === m.id))
      ).toEqual([]);
    else
      expect(
        reload
          .wall()
          .slice(200)
          .every((m) => m.categoriesLocked && m.categories[0] === "Code")
      ).toBe(true);
  }
);

it("reports the remaining count and keeps failed replay available for retry", async () => {
  const row = memory();
  let record: PendingBulk | undefined = {
    key: "retry",
    change: { operation: "delete", ids: [row.id] },
    remaining: [row.id],
    readyAt: 0,
  };
  const outbox: BulkOutbox = {
    list: async () => (record ? [structuredClone(record)] : []),
    put: async (next) => {
      record = structuredClone(next);
    },
    remove: async () => {
      record = undefined;
    },
  };
  const bulk = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ ids: [row.id] });
  const { actions, wall, notify } = setup({ bulk }, [row], outbox);
  await actions.resumeBulks();
  expect(actions.isRemoving(row.id)).toBe(false);
  expect(wall()).toHaveLength(1);
  expect(notify.mock.calls.at(-1)![0]).toBe("1 Memory Not Updated");
  await actions.resumeBulks();
  expect(wall()).toHaveLength(0);
  expect(await outbox.list()).toEqual([]);
});

it("does not replay an older failed Category change over a newer successful change", async () => {
  const records = new Map<string, PendingBulk>();
  const outbox: BulkOutbox = {
    list: async () => structuredClone([...records.values()]),
    put: async (record) => {
      records.set(record.key, structuredClone(record));
    },
    remove: async (key) => {
      records.delete(key);
    },
  };
  const row = memory();
  const bulk = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ ids: [row.id] });
  const { actions } = setup({ bulk }, [row], outbox);
  actions.bulk([row], { operation: "categories", categories: ["Recipe"] });
  actions.sendPending();
  await settle();
  expect(records.size).toBe(1);
  actions.bulk([row], { operation: "categories", categories: ["Code"] });
  actions.sendPending();
  await settle();
  const replay = vi.fn().mockResolvedValue({ ids: [row.id] });
  await setup({ bulk: replay }, [row], outbox).actions.resumeBulks();
  expect(replay).not.toHaveBeenCalled();
});

it("keeps the Library readable when the durable outbox is unavailable", async () => {
  const outbox: BulkOutbox = {
    list: async () => {
      throw new Error("storage denied");
    },
    put: vi.fn(),
    remove: vi.fn(),
  };
  const row = memory();
  const { actions, wall, notify } = setup({ bulk: vi.fn() }, [row], outbox);
  await expect(actions.resumeBulks()).resolves.toBeUndefined();
  expect(wall()).toEqual([row]);
  expect(notify).toHaveBeenCalledWith("Bulk Updates Unavailable");
});
