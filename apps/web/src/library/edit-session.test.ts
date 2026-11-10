import { describe, expect, it, vi } from "vitest";
import { draftStore } from "./drafts";
import { editSession } from "./edit-session";
import type { EditOutcome, Memory } from "./library-actions";

// Memory detail's saving and drafts, against a fake Library and storage.

const memory = (over: Partial<Memory> = {}): Memory => ({
  id: "m1",
  kind: "text",
  title: null,
  body: "Server text",
  captureNote: null,
  preservation: "preserved",
  indexState: "searchable",
  revision: 7,
  capturedAt: "2026-11-10T10:00:00.000Z",
  updatedAt: "2026-11-10T10:00:00.000Z",
  ...over,
});

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function setup(
  wall: Memory,
  save: (before: Memory, changes: object) => Promise<EditOutcome>
) {
  let current = wall;
  const sessions: ReturnType<typeof editSession>[] = [];
  const drafts = draftStore(storage());
  const notify = vi.fn();
  const show = vi.fn();
  const offer = vi.fn();
  const saveSpy = vi.fn(save);
  const open = () => {
    const session = editSession({
      start: current,
      drafts,
      save: saveSpy,
      notify: notify as never,
    });
    session.listen({ show, offer });
    sessions.push(session);
    return session;
  };
  return {
    open,
    drafts,
    notify,
    show,
    offer,
    save: saveSpy,
    setWall: (m: Memory) => {
      current = m;
      for (const s of sessions) s.seen(m);
    },
  };
}

describe("Memory detail drafts", () => {
  it("never sends a draft written on an older revision by itself", async () => {
    const t = setup(memory(), vi.fn());
    t.drafts.keep("m1", { title: "", body: "Old draft", captureNote: "" }, 5);
    const session = t.open();
    expect(session.initial.body).toBe("Server text");
    session.open();
    // Offered by a button in the dialog, never a toast.
    expect(session.offered).toBe(true);
    expect(t.notify).not.toHaveBeenCalled();
    session.close();
    await settle();
    expect(t.save).not.toHaveBeenCalled();
    expect(t.drafts.read("m1")).toBeUndefined();
    expect(t.offer).toHaveBeenLastCalledWith(false);
  });

  it("keeps its offer through a close and an immediate reopen (React StrictMode)", async () => {
    const t = setup(memory(), async (before) => ({
      status: "saved",
      memory: { ...before, revision: 8 },
    }));
    t.drafts.keep("m1", { title: "", body: "Old draft", captureNote: "" }, 5);
    const session = t.open();
    session.open();
    session.close();
    session.open();
    await settle();
    expect(session.offered).toBe(true);
    session.restore();
    await settle();
    expect(session.offered).toBe(false);
    expect(t.save).toHaveBeenCalledWith(expect.anything(), {
      body: "Old draft",
    });
  });

  it("brings back a draft written on the current revision, and saves it", async () => {
    const t = setup(memory(), async (before) => ({
      status: "saved",
      memory: { ...before, body: "Kept draft", revision: 8 },
    }));
    t.drafts.keep("m1", { title: "", body: "Kept draft", captureNote: "" }, 7);
    const session = t.open();
    expect(session.initial.body).toBe("Kept draft");
    session.close();
    await settle();
    expect(t.save).toHaveBeenCalledWith(expect.anything(), {
      body: "Kept draft",
    });
    expect(t.drafts.read("m1")).toBeUndefined();
  });
});

describe("an edit refused as stale", () => {
  const elsewhere = memory({ title: "Elsewhere", revision: 8 });

  async function refused() {
    const t = setup(memory(), async () => ({
      status: "stale",
      latest: elsewhere,
    }));
    const session = t.open();
    session.open();
    session.change({ title: "Mine", body: "Server text", captureNote: "" });
    session.flush(false);
    await settle();
    t.setWall(elsewhere);
    return { t, session };
  }

  it("shows the server's copy, and closing sends nothing more", async () => {
    const { t, session } = await refused();
    expect(t.show).toHaveBeenLastCalledWith({
      title: "Elsewhere",
      body: "Server text",
      captureNote: "",
    });
    session.close();
    await settle();
    expect(t.save).toHaveBeenCalledTimes(1);
    expect(t.offer).toHaveBeenCalledWith(true);
  });

  it("puts the edit back on Restore and saves it on the current revision", async () => {
    const { t, session } = await refused();
    t.save.mockImplementation(async (before) => ({
      status: "saved",
      memory: { ...before, title: "Mine", revision: 9 },
    }));
    expect(session.offered).toBe(true);
    session.restore();
    await settle();
    expect(t.show).toHaveBeenLastCalledWith({
      title: "Mine",
      body: "Server text",
      captureNote: "",
    });
    expect(t.save).toHaveBeenCalledTimes(2);
    expect(t.save.mock.calls[1]![0].revision).toBe(8);
    expect(t.save.mock.calls[1]![1]).toEqual({ title: "Mine" });
    session.close();
    await settle();
    expect(t.save).toHaveBeenCalledTimes(2);
  });
});
