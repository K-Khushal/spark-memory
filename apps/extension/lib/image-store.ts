import type { ImageBytes } from "./image";
/** Extension-origin IndexedDB avoids storage.local's 10 MB limit; page scripts
 * and content scripts use their page's origin and cannot open this database. */
export function imageStore() {
  const opened = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("spark-image-outbox", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Try Again"));
  });
  async function transaction<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>
  ) {
    const db = await opened;
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("images", mode);
      const result = work(tx.objectStore("images"));
      tx.oncomplete = () => resolve(result.result);
      tx.onerror = tx.onabort = () => reject(new Error("Try Again"));
    });
  }
  return {
    get: (id: string) =>
      transaction<ImageBytes | undefined>("readonly", (store) => store.get(id)),
    put: (id: string, bytes: ImageBytes) =>
      transaction("readwrite", (store) => store.put(bytes, id)),
    async retain(ids: string[]) {
      const keys = await transaction<IDBValidKey[]>("readonly", (store) =>
        store.getAllKeys()
      );
      for (const key of keys)
        if (!ids.includes(String(key)))
          await transaction("readwrite", (store) => store.delete(key));
    },
  };
}
