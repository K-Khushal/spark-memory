import { describe, expect, it, vi } from "vitest";
import { draftStore, type Draft, type DraftStore } from "./drafts";
import {
  libraryActions,
  type Memory,
  type Transport,
  type WallMemory,
} from "./library-actions";

// Editing a Memory: one pending edit per Memory, against a fake server that
// checks revisions the way the real one does (409 when based on an old one).

const settle = () => new Promise((r) => setTimeout(r, 0));

const start: Memory = {
  id: "m1",
  kind: "text",
  title: "Start",
  body: "Body",
  captureNote: null,
  preservation: "preserved",
  indexState: "searchable",
  revision: 1,
  capturedAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:00:00.000Z",
  image: null,
};

const text = (title: string, body = "Body"): Draft => ({
  title,
  body,
  captureNote: "",
});

/** A gate a fake request waits on: closed, then opened by the test. */
function gate() {
  let open: Promise<void> | undefined;
  let release = () => {};
  return {
    wait: () => open,
    close() {
      open = new Promise((r) => (release = r));
    },
    open() {
      open = undefined;
      release();
    },
  };
}

function fakeServer() {
  let row = start;
  const patchGate = gate();
  const getGate = gate();
  let failPatches = 0;
  let failGets = 0;
  const patch = vi.fn(
    async (_id: string, json: Record<string, unknown>, _init?: unknown) => {
      await patchGate.wait();
      if (failPatches > 0) {
        failPatches--;
        throw new Error("503");
      }
      if (json.revision !== row.revision) return "stale" as const;
      const { revision: _, ...changes } = json;
      row = { ...row, ...changes, revision: row.revision + 1 } as Memory;
      return row;
    }
  );
  const get = vi.fn(async () => {
    await getGate.wait();
    if (failGets > 0) {
      failGets--;
      throw new Error("offline");
    }
    return row;
  });
  return {
    row: () => row,
    patch,
    get,
    remove: vi.fn(async () => {}),
    pause: () => patchGate.close(),
    resume: () => patchGate.open(),
    pauseGet: () => getGate.close(),
    resumeGet: () => getGate.open(),
    failNext: () => void failPatches++,
    failNextGet: () => void failGets++,
    /** Another tab edits the Memory. */
    editElsewhere(title: string) {
      row = { ...row, title, revision: row.revision + 1 };
    },
  };
}

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

/** One page (tab) of the dashboard. Pages can share a server and storage. */
function setup(
  shared: { server?: ReturnType<typeof fakeServer>; drafts?: DraftStore } = {}
) {
  let wall: WallMemory[] = [start];
  const server = shared.server ?? fakeServer();
  const drafts = shared.drafts ?? draftStore(storage());
  const notify = vi.fn();
  const actions = libraryActions({
    setMemories: (update) => {
      wall = typeof update === "function" ? update(wall) : update;
    },
    transport: {
      create: vi.fn(),
      remove: server.remove,
      patch: server.patch,
      get: server.get,
    } as unknown as Transport,
    drafts,
    notify: notify as never,
    onSaved: vi.fn(),
  });
  const onWall = () => wall.find((m) => m.id === "m1");
  const toast = (title: string) =>
    notify.mock.calls.findLast(([t]) => t === title)?.[1];
  const tryAgain = () => toast("Changes Did Not Save")!.action.onClick();
  return { actions, server, drafts, notify, onWall, toast, tryAgain };
}

/** Typed "Mine", then refused because another tab saved first. */
async function refused() {
  const t = setup();
  t.server.editElsewhere("Other tab");
  t.actions.editText(start, text("Mine"));
  t.actions.saveEdit("m1");
  await settle();
  return t;
}

describe("a pending edit", () => {
  it("is sent one request at a time; typing during a send is sent next", async () => {
    const t = setup();
    t.actions.editText(start, text("One"));
    t.server.pause();
    t.actions.saveEdit("m1");
    t.actions.editText(start, text("Two"));
    t.actions.saveEdit("m1"); // already sending: waits its turn
    await settle();
    expect(t.server.patch).toHaveBeenCalledTimes(1);
    t.server.resume();
    await settle();
    expect(t.server.patch).toHaveBeenCalledTimes(2);
    expect(t.server.row()).toMatchObject({ title: "Two", revision: 3 });
    expect(t.actions.pendingEdit("m1")).toBeUndefined();
    expect(t.drafts.read("m1")).toBeUndefined();
  });

  it("asks the browser to carry a save past page close only when it fits in bytes", async () => {
    const t = setup();
    t.actions.editText(start, text("Short"));
    t.actions.saveEdit("m1");
    await settle();
    // 40,000 characters, but 80,000 bytes of UTF-8: over keepalive's 64 KB.
    t.actions.editText(t.onWall()!, text("Long", "é".repeat(40_000)));
    t.actions.saveEdit("m1");
    await settle();
    expect(t.server.patch.mock.calls[0]![2]).toEqual({ keepalive: true });
    expect(t.server.patch.mock.calls[1]![2]).toEqual({ keepalive: false });
  });
});

describe("Try Again after a failed edit", () => {
  it("sends nothing once a newer edit has saved, so the old text never wins", async () => {
    const t = setup();
    t.server.failNext();
    t.actions.editText(start, text("A"));
    t.actions.saveEdit("m1");
    await settle();
    expect(t.actions.pendingEdit("m1")?.status).toBe("failed");
    t.actions.editText(start, text("B"));
    t.actions.saveEdit("m1");
    await settle();
    expect(t.server.row().title).toBe("B");
    t.tryAgain();
    await settle();
    expect(t.server.patch).toHaveBeenCalledTimes(2);
    expect(t.server.row().title).toBe("B");
  });

  it("sends the latest text, not the text that failed", async () => {
    const t = setup();
    t.server.failNext();
    t.actions.editText(start, text("A"));
    t.actions.saveEdit("m1");
    await settle();
    t.actions.editText(start, text("B"));
    t.tryAgain();
    await settle();
    expect(t.server.patch.mock.calls[1]![1]).toMatchObject({ title: "B" });
    expect(t.server.row().title).toBe("B");
  });
});

describe("an edit refused because the Memory changed elsewhere", () => {
  it("keeps the person's latest text through queued typing, and Restore sends it", async () => {
    const t = setup();
    t.server.pause();
    t.actions.editText(start, text("Mine 1"));
    t.actions.saveEdit("m1");
    t.actions.editText(start, text("Mine 2"));
    t.actions.saveEdit("m1");
    t.server.editElsewhere("Other tab");
    t.server.resume();
    await settle();
    expect(t.server.patch).toHaveBeenCalledTimes(1);
    expect(t.actions.pendingEdit("m1")).toMatchObject({
      status: "idle",
      refused: { title: "Mine 2" },
    });
    expect(t.onWall()?.title).toBe("Other tab");

    expect(t.actions.restoreEdit("m1")?.title).toBe("Mine 2");
    await settle();
    expect(t.server.row()).toMatchObject({ title: "Mine 2", revision: 3 });
    expect(t.actions.pendingEdit("m1")).toBeUndefined();
  });

  it("stays on offer while the person types over the server copy", async () => {
    const t = await refused();
    // The dialog now shows the server copy; the next keystroke edits it.
    t.actions.editText(t.onWall()!, text("Other tabx"));
    expect(t.actions.pendingEdit("m1")).toMatchObject({
      status: "dirty",
      fields: { title: "Other tabx" },
      refused: { title: "Mine" },
    });
    expect(t.actions.restoreEdit("m1")?.title).toBe("Mine");
    await settle();
    expect(t.server.row().title).toBe("Mine");
  });

  it("sends nothing on close, and keeps the text as a draft to offer next time", async () => {
    const t = await refused();
    t.actions.closeEdit("m1");
    await settle();
    expect(t.server.patch).toHaveBeenCalledTimes(1);
    expect(t.drafts.read("m1")?.refused?.title).toBe("Mine");
  });

  it("keeps new typing after the refusal, even when closed before it saves", async () => {
    const t = await refused();
    t.actions.editText(t.onWall()!, text("Typed after"));
    t.server.pause();
    t.actions.closeEdit("m1");
    expect(t.drafts.read("m1")).toMatchObject({
      fields: { title: "Typed after" },
      baseRevision: 2,
      refused: { title: "Mine" },
    });
    t.server.resume();
    await settle();
    expect(t.server.row().title).toBe("Typed after");
    // The refused text is still on offer; the typing is saved.
    expect(t.drafts.read("m1")).toMatchObject({ refused: { title: "Mine" } });
    expect(t.drafts.read("m1")?.fields).toBeUndefined();
  });

  it("when the server copy can't be fetched, fails and retries instead of offering", async () => {
    const t = setup();
    t.server.editElsewhere("Other tab");
    t.server.failNextGet();
    t.actions.editText(start, text("Mine"));
    t.actions.saveEdit("m1");
    await settle();
    // Not knowing the server copy, nothing is offered or shown as saved.
    expect(t.actions.pendingEdit("m1")).toMatchObject({ status: "failed" });
    expect(t.actions.pendingEdit("m1")?.refused).toBeUndefined();
    t.tryAgain();
    await settle();
    expect(t.actions.pendingEdit("m1")).toMatchObject({
      status: "idle",
      refused: { title: "Mine" },
    });
    expect(t.onWall()?.title).toBe("Other tab");
    t.actions.restoreEdit("m1");
    await settle();
    expect(t.server.row()).toMatchObject({ title: "Mine", revision: 3 });
  });

  it("leaves nothing behind when the Memory is deleted while the server copy loads", async () => {
    const t = setup();
    t.server.editElsewhere("Other tab");
    t.server.pauseGet();
    t.actions.editText(start, text("Mine"));
    t.actions.saveEdit("m1");
    await settle();
    t.actions.remove(t.onWall()!);
    t.toast("Deleted")!.onAutoClose();
    t.server.resumeGet();
    await settle();
    expect(t.actions.pendingEdit("m1")).toBeUndefined();
    expect(t.drafts.read("m1")).toBeUndefined();
  });
});

describe("a draft left by another page", () => {
  it("on an older revision, is offered and never sent by itself", async () => {
    const t = setup();
    t.drafts.keep("m1", {
      fields: text("Old draft"),
      baseRevision: 0,
      page: "earlier",
    });
    expect(t.actions.openEdit(start)).toMatchObject({
      status: "idle",
      refused: { title: "Old draft" },
    });
    t.actions.closeEdit("m1");
    await settle();
    expect(t.server.patch).not.toHaveBeenCalled();
    expect(t.drafts.read("m1")).toBeUndefined();
  });

  it("comes back on Restore, saved on the current revision", async () => {
    const t = setup();
    t.drafts.keep("m1", {
      fields: text("Old draft"),
      baseRevision: 0,
      page: "earlier",
    });
    t.actions.openEdit(start);
    t.actions.restoreEdit("m1");
    await settle();
    expect(t.server.row()).toMatchObject({ title: "Old draft", revision: 2 });
  });

  it("on the current revision, is still only offered: it is another tab's typing", async () => {
    const shared = { server: fakeServer(), drafts: draftStore(storage()) };
    const tabA = setup(shared);
    tabA.actions.editText(start, text("Half typed"));
    const tabB = setup(shared);
    expect(tabB.actions.openEdit(start)).toMatchObject({
      status: "idle",
      refused: { title: "Half typed" },
    });
    await settle();
    expect(shared.server.patch).not.toHaveBeenCalled();
  });

  it("is dropped when the server already has its text", () => {
    const t = setup();
    t.drafts.keep("m1", {
      fields: text("Start"),
      baseRevision: 0,
      page: "earlier",
    });
    expect(t.actions.openEdit(start)).toBeUndefined();
    expect(t.drafts.read("m1")).toBeUndefined();
  });
});

describe("deleting a Memory with an unsaved edit", () => {
  it("drops the edit and draft once the delete is sent", async () => {
    const t = setup();
    t.actions.editText(start, text("Unsaved"));
    t.actions.remove(t.onWall()!);
    t.toast("Deleted")!.onAutoClose();
    await settle();
    expect(t.actions.pendingEdit("m1")).toBeUndefined();
    expect(t.drafts.read("m1")).toBeUndefined();
  });

  it("saves the edit after Undo", async () => {
    const t = setup();
    t.actions.editText(start, text("Unsaved"));
    t.actions.remove(t.onWall()!);
    t.toast("Deleted")!.action.onClick();
    await settle();
    expect(t.onWall()?.title).toBe("Unsaved");
    expect(t.server.row().title).toBe("Unsaved");
  });

  it("saves an edit whose send failed during the Undo window", async () => {
    const t = setup();
    t.server.pause();
    t.server.failNext();
    t.actions.editText(start, text("In flight"));
    t.actions.saveEdit("m1");
    t.actions.remove(t.onWall()!);
    t.server.resume();
    await settle();
    t.toast("Deleted")!.action.onClick();
    await settle();
    expect(t.server.row().title).toBe("In flight");
  });
});
