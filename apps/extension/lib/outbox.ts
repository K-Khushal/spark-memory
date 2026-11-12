import type { LinkCapture } from "@spark/core";
import { ApiError, type SavedMemory } from "./client";
export type PendingCapture = {
  owner: string;
  capture: LinkCapture;
  screenshot?: string;
  addedAt: number;
};
/** One writer (the service worker), serialized even across overlapping retries. */
export function createOutbox(io: {
  read(): Promise<PendingCapture[]>;
  write(rows: PendingCapture[]): Promise<void>;
  send(row: PendingCapture): Promise<SavedMemory>;
}) {
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  return {
    add: (row: PendingCapture) =>
      serial(async () => {
        const rows = await io.read();
        if (rows.length >= 10) throw new Error("Outbox Full");
        await io.write([...rows, row]);
      }),
    clear: () => serial(() => io.write([])),
    flush: (owner: string) =>
      serial(async () => {
        const rows = await io.read();
        const results: { captureId: string; memory: SavedMemory }[] = [];
        for (const row of [...rows]) {
          if (row.owner !== owner) continue;
          try {
            const memory = await io.send(row);
            results.push({ captureId: row.capture.id!, memory });
            rows.splice(rows.indexOf(row), 1);
            await io.write(rows);
          } catch (error) {
            if (error instanceof ApiError && !error.retryable) {
              if (error.status === 401 || error.status === 409) throw error;
              // Retain the refused Capture for an explicit discard; try later rows.
              continue;
            }
            break;
          }
        }
        return results;
      }),
  };
}
