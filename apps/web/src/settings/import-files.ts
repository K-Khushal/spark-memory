/** User-scoped originals survive reload until the existing presigned Capture confirms them. */
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("spark-import-files", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(new Error("Images Could Not Be Kept On This Device"));
  });
}
export async function importFile(
  userId: string,
  id: string,
  value?: File | null
): Promise<File | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "files",
        value === undefined ? "readonly" : "readwrite"
      );
      const store = tx.objectStore("files"),
        key = `${userId}/${id}`;
      const request =
        value === undefined
          ? store.get(key)
          : value === null
            ? store.delete(key)
            : store.put(value, key);
      tx.oncomplete = () =>
        resolve(
          value === undefined ? (request.result as File | undefined) : undefined
        );
      tx.onerror = () =>
        reject(new Error("Images Could Not Be Kept On This Device"));
    });
  } finally {
    db.close();
  }
}

/** Releases originals when their job is cancelled on this device. */
export async function clearImportFiles(userId: string, jobId: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      const request = tx.objectStore("files").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(`${userId}/${jobId}/`))
          cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(new Error("Images Could Not Be Removed From This Device"));
    });
  } finally {
    db.close();
  }
}
