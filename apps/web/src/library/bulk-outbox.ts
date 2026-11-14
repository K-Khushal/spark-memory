import type { BulkMemories } from "@spark/core";

export type PendingBulk = {
  key: string;
  change: BulkMemories;
  /** Only unacknowledged ids remain; replay is safe after a lost response. */
  remaining: string[];
  readyAt: number;
};
export type BulkOutbox = {
  list(): Promise<PendingBulk[]>;
  put(record: PendingBulk): Promise<void>;
  remove(key: string): Promise<void>;
};

/** Separate database per owner: signing into another Library never replays its work. */
export function bulkOutbox(owner: string): BulkOutbox {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`spark-bulk:${owner}`, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("pending", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  async function transaction<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction("pending", mode);
        const request = run(tx.objectStore("pending"));
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  return {
    list: () =>
      transaction<PendingBulk[]>("readonly", (store) => store.getAll()),
    put: async (record) => {
      await transaction("readwrite", (store) => store.put(record));
    },
    remove: async (key) => {
      await transaction("readwrite", (store) => store.delete(key));
    },
  };
}
