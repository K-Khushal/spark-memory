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

/** Version 2 added the Capture ids and the verified flag to every row. */
const DB_VERSION = 2;

function isFile(value: unknown): value is File {
  return value instanceof File;
}

/** A stored row as a share, or undefined when it is not one (damaged, or an old build's). */
export function readShare(row: unknown): PendingShare | undefined {
  if (!row || typeof row !== "object") return undefined;
  const r = row as Record<string, unknown>;
  const text = (key: string) => typeof r[key] === "string";
  if (!text("id") || !text("title") || !text("text") || !text("url")) return;
  if (typeof r.verified !== "boolean" || !Array.isArray(r.files)) return;
  const sound = r.files.every(
    (f: unknown) =>
      !!f &&
      typeof (f as HeldFile).id === "string" &&
      isFile((f as HeldFile).file)
  );
  return sound ? (row as PendingShare) : undefined;
}

/**
 * Version 1 rows had no ids, no verified flag and bare files. They are kept
 * as shares that ask first (nothing says where they came from); a row that
 * is not a share at all is undefined (heldShares removes it and says so).
 */
export function upgradeRow(row: unknown): PendingShare | undefined {
  if (readShare(row)) return row as PendingShare;
  if (!row || typeof row !== "object") return undefined;
  const r = row as Record<string, unknown>;
  const { title, text, url, files } = r;
  if (typeof title !== "string" || typeof text !== "string") return undefined;
  if (typeof url !== "string" || !Array.isArray(files)) return undefined;
  if (!files.every(isFile)) return undefined;
  return {
    id: crypto.randomUUID(),
    verified: false,
    title,
    text,
    url,
    files: files.map((file) => ({ id: crypto.randomUUID(), file })),
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      if (event.oldVersion < 1) {
        req.result.createObjectStore(STORE, { autoIncrement: true });
        return;
      }
      const cursor = req.transaction!.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at) return;
        const share = upgradeRow(at.value);
        // A row that is no share stays: the first read removes it and says so.
        if (share) at.update(share);
        at.continue();
      };
    };
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

/**
 * Everything held, left in place: drop each one only after Capture has it.
 * A row that is not a share (damaged) is removed here and counted.
 */
export function heldShares(): Promise<{
  shares: HeldShare[];
  unreadable: number;
}> {
  return inStore("readwrite", async (store) => {
    const [keys, rows] = await Promise.all([
      request(store.getAllKeys()),
      request(store.getAll() as IDBRequest<unknown[]>),
    ]);
    const shares: HeldShare[] = [];
    keys.forEach((key, i) => {
      const share = readShare(rows[i]);
      if (share) shares.push({ key, share });
      else store.delete(key);
    });
    return { shares, unreadable: keys.length - shares.length };
  });
}

/** One held share, or nothing when another tab has already dropped it. */
export function heldShare(key: IDBValidKey): Promise<PendingShare | undefined> {
  return inStore("readonly", async (store) =>
    readShare(await request(store.get(key)))
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
