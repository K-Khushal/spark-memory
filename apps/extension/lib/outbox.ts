import type { LinkCapture } from "@spark/core";
import { ApiError, type SavedMemory } from "./client";
export type PendingCapture = {
  owner: string;
  capture: LinkCapture;
  screenshot?: string;
  addedAt: number;
};
export type OutboxState = { rows: PendingCapture[]; refused?: number };
/** One writer (the service worker), including account changes and notices. */
export function createOutbox(io: {
  read(): Promise<OutboxState>;
  write(state: OutboxState): Promise<void>;
  send(row: PendingCapture): Promise<SavedMemory>;
}) {
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  async function add(row: PendingCapture) {
    const state = await io.read();
    if (state.rows.filter((entry) => entry.owner === row.owner).length >= 10)
      throw new Error("Outbox Full");
    await io.write({ ...state, rows: [...state.rows, row] });
  }
  async function flush(owner: string) {
    const state = await io.read();
    const results: { captureId: string; memory: SavedMemory }[] = [];
    for (const row of [...state.rows]) {
      if (row.owner !== owner) continue;
      try {
        const memory = await io.send(row);
        results.push({ captureId: row.capture.id!, memory });
      } catch (error) {
        // A missing session can be recovered by signing back in as this owner.
        if (error instanceof ApiError && error.status === 401) throw error;
        if (!(error instanceof ApiError) || error.retryable) break;
        state.refused = error.status;
      }
      state.rows.splice(state.rows.indexOf(row), 1);
      // Persist the notice with removal, without keeping any refused page data.
      await io.write(state);
    }
    return results;
  }
  return {
    add: (row: PendingCapture) => serial(() => add(row)),
    submit: (row: PendingCapture) =>
      serial(async () => {
        // Make room for online Capture before enforcing the retryable-row cap.
        await flush(row.owner);
        await add(row);
        const results = await flush(row.owner);
        return results.find((result) => result.captureId === row.capture.id)
          ?.memory;
      }),
    clear: () => serial(() => io.write({ rows: [] })),
    useOwner: (owner: string) =>
      serial(async () => {
        const state = await io.read();
        if (state.rows.some((row) => row.owner !== owner))
          await io.write({
            rows: state.rows.filter((row) => row.owner === owner),
          });
      }),
    reconcile: () =>
      serial(async () => {
        const state = await io.read();
        await io.write(state);
        return state.rows.length > 0;
      }),
    takeStatus: (includeRefusal = true) =>
      serial(async () => {
        const state = await io.read();
        if (includeRefusal && state.refused !== undefined)
          await io.write({ rows: state.rows });
        return {
          hasRows: state.rows.length > 0,
          ...(includeRefusal &&
            state.refused !== undefined && { refused: state.refused }),
        };
      }),
    flush: (owner: string) => serial(() => flush(owner)),
  };
}
