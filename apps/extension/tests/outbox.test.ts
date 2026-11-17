import { ApiError } from "../lib/client";
import { expect, it, vi } from "vitest";
import {
  createOutbox,
  type OutboxState,
  type PendingCapture,
} from "../lib/outbox";
it("retains an offline Capture, retries idempotently, and never sends it as another person", async () => {
  let rows: PendingCapture[] = [];
  let online = false;
  const sent: string[] = [];
  const box = createOutbox({
    read: async () => ({ rows }),
    write: async (value) => {
      rows = structuredClone(value.rows);
    },
    send: async (row) => {
      if (!online) throw new TypeError("offline");
      sent.push(row.capture.id!);
      return {
        id: row.capture.id!,
        revision: 1,
        title: null,
        captureNote: null,
      };
    },
  });
  const id = crypto.randomUUID();
  await box.add({
    owner: "ana",
    capture: { id, url: "https://garden.test" },
    addedAt: Date.now(),
  });
  await box.flush("ana");
  expect(rows).toHaveLength(1);
  online = true;
  await box.flush("ben");
  expect(sent).toEqual([]);
  await Promise.all([box.flush("ana"), box.flush("ana")]);
  expect(sent).toEqual([id]);
  expect(rows).toEqual([]);
});
it("does not let a refused Capture block the next one or resurrect discarded rows", async () => {
  let rows: PendingCapture[] = [];
  const box = createOutbox({
    read: async () => ({ rows }),
    write: async (value) => {
      rows = value.rows;
    },
    send: async (row) => {
      if ("url" in row.capture && row.capture.url.endsWith("bad"))
        throw new ApiError(400);
      return {
        id: row.capture.id!,
        revision: 1,
        title: null,
        captureNote: null,
      };
    },
  });
  await box.add({
    owner: "ana",
    capture: { id: crypto.randomUUID(), url: "https://garden.test/bad" },
    addedAt: Date.now(),
  });
  const id = crypto.randomUUID();
  await box.add({
    owner: "ana",
    capture: { id, url: "https://garden.test/good" },
    addedAt: Date.now(),
  });
  expect(await box.flush("ana")).toMatchObject([{ captureId: id }]);
  await Promise.all([box.flush("ana"), box.clear()]);
  expect(rows).toEqual([]);
});
it("counts only this owner's retryable Captures toward the cap", async () => {
  let state: OutboxState = {
    rows: Array.from({ length: 10 }, () => ({
      owner: "ben",
      capture: { id: crypto.randomUUID(), url: "https://garden.test" },
      addedAt: Date.now(),
    })),
  };
  const box = createOutbox({
    read: async () => state,
    write: async (value) => {
      state = value;
    },
    send: async () => {
      throw new TypeError("offline");
    },
  });
  await expect(
    box.add({
      owner: "ana",
      capture: { id: crypto.randomUUID(), url: "https://garden.test/ana" },
      addedAt: Date.now(),
    })
  ).resolves.toBeUndefined();
  expect(state.rows).toHaveLength(11);
});
it("drops permanent refusals, reports them once and does not retry them", async () => {
  let state: OutboxState = {
    rows: [
      {
        owner: "ana",
        capture: { id: crypto.randomUUID(), url: "https://garden.test/bad" },
        screenshot: "page bytes",
        addedAt: Date.now(),
      },
    ],
  };
  const send = vi.fn().mockRejectedValue(new ApiError(400));
  const box = createOutbox({
    read: async () => state,
    write: async (value) => {
      state = value;
    },
    send,
  });
  await box.flush("ana");
  expect(state.rows).toEqual([]);
  expect(await box.takeStatus()).toEqual({ hasRows: false, refused: 400 });
  expect(await box.takeStatus()).toEqual({ hasRows: false });
  await box.flush("ana");
  expect(send).toHaveBeenCalledTimes(1);
});
it("erases other accounts' page content only after a confirmed identity change", async () => {
  let state: OutboxState = {
    rows: [
      {
        owner: "ana",
        capture: { id: crypto.randomUUID(), url: "https://garden.test" },
        screenshot: "private bytes",
        addedAt: Date.now(),
      },
    ],
  };
  const box = createOutbox({
    read: async () => state,
    write: async (value) => {
      state = value;
    },
    send: vi.fn(),
  });
  await box.useOwner("ben");
  expect(state.rows).toEqual([]);
});
it("returns this Capture's result even when an alarm flush runs concurrently", async () => {
  let state: OutboxState = { rows: [] };
  const send = vi.fn().mockImplementation(async (row) => ({
    id: row.capture.id,
    revision: 1,
    title: null,
    captureNote: null,
  }));
  const box = createOutbox({
    read: async () => structuredClone(state),
    write: async (value) => {
      state = structuredClone(value);
    },
    send,
  });
  const row = {
    owner: "ana",
    capture: { id: crypto.randomUUID(), url: "https://garden.test" },
    addedAt: Date.now(),
  };
  const [result] = await Promise.all([box.submit(row), box.flush("ana")]);
  expect(result).toMatchObject({ id: row.capture.id });
  expect(send).toHaveBeenCalledTimes(1);
  expect(state.rows).toEqual([]);
});
it("sends a new online Capture after flushing a full backlog of refused rows", async () => {
  const row = {
    owner: "ana",
    capture: { id: crypto.randomUUID(), url: "https://garden.test/good" },
    addedAt: Date.now(),
  };
  let state: OutboxState = {
    rows: Array.from({ length: 10 }, () => ({
      ...row,
      capture: { id: crypto.randomUUID(), url: "https://garden.test/bad" },
    })),
  };
  const box = createOutbox({
    read: async () => structuredClone(state),
    write: async (value) => {
      state = structuredClone(value);
    },
    send: async (pending) => {
      if ("url" in pending.capture && pending.capture.url.endsWith("bad"))
        throw new ApiError(400);
      return {
        id: pending.capture.id!,
        revision: 1,
        title: null,
        captureNote: null,
      };
    },
  });
  expect(await box.submit(row)).toMatchObject({ id: row.capture.id });
  expect(state.rows).toEqual([]);
});
