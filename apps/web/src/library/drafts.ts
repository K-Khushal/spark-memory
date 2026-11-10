/** What Memory detail edits. */
export type Draft = { title: string; body: string; captureNote: string };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const key = (id: string) => `spark-draft:${id}`;
const same = (a: Draft, b: Draft) =>
  a.title === b.title && a.body === b.body && a.captureNote === b.captureNote;

/**
 * Unsaved Memory detail edits, kept in this browser until the server has
 * them: a page that closes mid-edit (a save too big for keepalive, or one
 * still queued) loses nothing, and the next time the Memory opens the draft
 * comes back. Storage can be blocked or full; then drafts are simply off.
 */
export function draftStore(storage: Storage | undefined) {
  const read = (id: string): Draft | undefined => {
    try {
      const raw = storage?.getItem(key(id));
      const value = raw ? (JSON.parse(raw) as Partial<Draft>) : undefined;
      return typeof value?.title === "string" &&
        typeof value.body === "string" &&
        typeof value.captureNote === "string"
        ? (value as Draft)
        : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    read,
    keep(id: string, draft: Draft) {
      try {
        storage?.setItem(key(id), JSON.stringify(draft));
      } catch {
        // Blocked or full: the open dialog still autosaves.
      }
    },
    /** The server has `draft`; forget it unless a newer one was kept since. */
    saved(id: string, draft: Draft) {
      const kept = read(id);
      if (!kept || !same(kept, draft)) return;
      try {
        storage?.removeItem(key(id));
      } catch {
        // Nothing to forget in blocked storage.
      }
    },
  };
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export const drafts = draftStore(
  typeof window === "undefined" ? undefined : browserStorage()
);
