import { ApiError } from "../lib/client";
import { expect, it } from "vitest";
import { createOutbox, type PendingCapture } from "../lib/outbox";
it("retains an offline Capture, retries idempotently, and never sends it as another person", async () => {
  let rows: PendingCapture[] = [];
  let online = false;
  const sent: string[] = [];
  const box = createOutbox({
    read: async () => rows,
    write: async (value) => {
      rows = structuredClone(value);
    },
    send: async (row) => {
      if (!online) throw new TypeError("offline");
      sent.push(row.capture.id!);
      return { id: row.capture.id!, revision: 1, captureNote: null };
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
    read: async () => rows,
    write: async (value) => {
      rows = value;
    },
    send: async (row) => {
      if (row.capture.url.endsWith("bad")) throw new ApiError(400);
      return { id: row.capture.id!, revision: 1, captureNote: null };
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
