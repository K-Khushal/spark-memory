import { describe, expect, it, vi } from "vitest";
import { draftStore, type Draft } from "./drafts";
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
};

const text = (title: string, body = "Body"): Draft => ({
  title,
  body,
  captureNote: "",
});

function fakeServer() {
  let row = start;
  let paused: Promise<void> | undefined;
  let resume = () => {};
  let failNext = false;
  const patch = vi.fn(
    async (_id: string, json: Record<string, unknown>, _init?: unknown) => {
      await paused;
      if (failNext) {
        failNext = false;
        throw new Error("503");
      }
      if (json.revision !== row.revision) return "stale" as const;
      const { revision: _, ...changes } = json;
      row = { ...row, ...changes, revision: row.revision + 1 } as Memory;
      return row;
    }
  );
  return {
    row: () => row,
    patch,
    get: vi.fn(async () => row),
    pause() {
      paused = new Promise((r) => (resume = r));
    },
    resume() {
      paused = undefined;
      resume();
    },
    failNext() {
      failNext = true;
    },
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

function setup() {
  let wall: WallMemory[] = [start];
  const server = fakeServer();
  const drafts = draftStore(storage());
  const notify = vi.fn();
  const actions = libraryActions({
    setMemories: (update) => {
      wall = typeof update === "function" ? update(wall) : update;
    },
    transport: {
      create: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
      patch: server.patch,
      get: server.get,
    } as unknown as Transport,
    drafts,
    notify: notify as never,
    onSaved: vi.fn(),
  });
  const onWall = () => wall.find((m) => m.id === "m1")!;
  const tryAgain = () => {
    const call = notify.mock.calls.findLast(
      ([title]) => title === "Changes Did Not Save"
    );
    call![1].action.onClick();
  };
  return { actions, server, drafts, notify, onWall, tryAgain };
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
    t.actions.editText(t.onWall(), text("Long", "é".repeat(40_000)));
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
      status: "conflict",
      fields: { title: "Mine 2" },
    });
    expect(t.onWall().title).toBe("Other tab");

    t.actions.restoreEdit("m1");
    await settle();
    expect(t.server.row()).toMatchObject({ title: "Mine 2", revision: 3 });
    expect(t.actions.pendingEdit("m1")).toBeUndefined();
  });

  it("sends nothing on close, and keeps the text as a draft to offer next time", async () => {
    const t = setup();
    t.server.editElsewhere("Other tab");
    t.actions.editText(start, text("Mine"));
    t.actions.saveEdit("m1");
    await settle();
    t.actions.closeEdit("m1");
    await settle();
    expect(t.server.patch).toHaveBeenCalledTimes(1);
    expect(t.drafts.read("m1")).toMatchObject({
      title: "Mine",
      conflict: true,
    });
  });

  it("keeps new typing after the refusal, even when closed before it saves", async () => {
    const t = setup();
    t.server.editElsewhere("Other tab");
    t.actions.editText(start, text("Mine"));
    t.actions.saveEdit("m1");
    await settle();
    t.actions.editText(t.onWall(), text("Typed after"));
    t.server.pause();
    t.actions.closeEdit("m1");
    expect(t.drafts.read("m1")).toMatchObject({
      title: "Typed after",
      revision: 2,
    });
    expect(t.drafts.read("m1")?.conflict).toBeFalsy();
    t.server.resume();
    await settle();
    expect(t.server.row().title).toBe("Typed after");
    expect(t.drafts.read("m1")).toBeUndefined();
  });
});

describe("a draft left by a page that closed", () => {
  it("on an older revision, is offered and never sent by itself", async () => {
    const t = setup();
    t.drafts.keep("m1", text("Old draft"), 0);
    expect(t.actions.openEdit(start)).toMatchObject({ status: "conflict" });
    t.actions.closeEdit("m1");
    await settle();
    expect(t.server.patch).not.toHaveBeenCalled();
    expect(t.drafts.read("m1")).toBeUndefined();
  });

  it("on an older revision, comes back on Restore, saved on the current revision", async () => {
    const t = setup();
    t.drafts.keep("m1", text("Old draft"), 0);
    t.actions.openEdit(start);
    t.actions.restoreEdit("m1");
    await settle();
    expect(t.server.row()).toMatchObject({ title: "Old draft", revision: 2 });
  });

  it("on the current revision, comes back and saves", async () => {
    const t = setup();
    t.drafts.keep("m1", text("Kept"), 1);
    expect(t.actions.openEdit(start)?.fields.title).toBe("Kept");
    await settle();
    expect(t.server.row().title).toBe("Kept");
    expect(t.drafts.read("m1")).toBeUndefined();
  });
});

describe("deleting a Memory", () => {
  it("drops its pending edit and draft", () => {
    const t = setup();
    t.actions.editText(start, text("Unsaved"));
    t.actions.remove(start);
    expect(t.actions.pendingEdit("m1")).toBeUndefined();
    expect(t.drafts.read("m1")).toBeUndefined();
  });
});
