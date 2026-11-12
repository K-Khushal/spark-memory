/** One share-target payload, as the service worker stored it. */
export type PendingShare = {
  title: string;
  text: string;
  url: string;
  files: File[];
};

/**
 * The hold: an IndexedDB store the service worker writes and the Library
 * drains. A share waits here while signed out, and is dropped at sign-out.
 */
const DB_NAME = "spark-share";
const STORE = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(STORE, {
        autoIncrement: true,
      });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Runs one transaction, resolving when it commits. */
async function inStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    const result = await work(tx.objectStore(STORE));
    await done;
    return result;
  } finally {
    db.close();
  }
}

/** The multipart form Android posts, as a share. Empty files are dropped. */
export function shareFromForm(form: FormData): PendingShare {
  const read = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    title: read("title"),
    text: read("text"),
    url: read("url"),
    files: form
      .getAll("files")
      .filter(
        (value): value is File => value instanceof File && value.size > 0
      ),
  };
}

export async function holdShare(share: PendingShare): Promise<void> {
  await inStore("readwrite", (store) => void store.add(share));
}

export type HeldShare = { key: IDBValidKey; share: PendingShare };

/** Everything held, left in place: drop each one only after Capture has it. */
export function heldShares(): Promise<HeldShare[]> {
  return inStore("readonly", async (store) => {
    const [keys, shares] = await Promise.all([
      request(store.getAllKeys()),
      request(store.getAll() as IDBRequest<PendingShare[]>),
    ]);
    return keys.map((key, i) => ({ key, share: shares[i]! }));
  });
}

export function dropShares(keys: IDBValidKey[]): Promise<void> {
  return inStore("readwrite", (store) => {
    for (const key of keys) store.delete(key);
  });
}

/** Sign-out: a share held for the session that is ending goes with it. */
export function clearHeldShares(): void {
  if (typeof indexedDB === "undefined") return;
  void inStore("readwrite", (store) => void store.clear()).catch(() => {});
}
