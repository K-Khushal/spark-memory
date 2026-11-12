/** A shared file with the Capture id it will keep until the server has it. */
export type HeldFile = { id: string; file: File };

/**
 * One share-target payload, as the service worker stored it. The ids are
 * made once, here, so every retry of a Capture sends the same id and the
 * server's idempotent create cannot make a second Memory.
 */
export type PendingShare = {
  /** The Capture id of the text or link. */
  id: string;
  /**
   * False when the post could have come from another site's form: it is
   * Captured only after the person says so (see judgeShare).
   */
  verified: boolean;
  title: string;
  text: string;
  url: string;
  files: HeldFile[];
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
export function shareFromForm(form: FormData, verified: boolean): PendingShare {
  const read = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    id: crypto.randomUUID(),
    verified,
    title: read("title"),
    text: read("text"),
    url: read("url"),
    files: form
      .getAll("files")
      .filter((value): value is File => value instanceof File && value.size > 0)
      .map((file) => ({ id: crypto.randomUUID(), file })),
  };
}

/** Holds a share; refuses once `limit` are already held, so a page cannot fill the disk. */
export async function holdShare(
  share: PendingShare,
  limit = Infinity
): Promise<boolean> {
  return inStore("readwrite", async (store) => {
    if ((await request(store.count())) >= limit) return false;
    store.add(share);
    return true;
  });
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

/** One held share, or nothing when another tab has already dropped it. */
export function heldShare(key: IDBValidKey): Promise<PendingShare | undefined> {
  return inStore("readonly", (store) =>
    request(store.get(key) as IDBRequest<PendingShare | undefined>)
  );
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
