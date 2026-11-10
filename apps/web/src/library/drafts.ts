/** What Memory detail edits. */
export type Draft = { title: string; body: string; captureNote: string };
/** A kept draft and the revision of the Memory it was written on. */
export type KeptDraft = Draft & { revision: number };

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const key = (id: string) => `spark-draft:${id}`;
export const sameText = (a: Draft, b: Draft) =>
  a.title === b.title && a.body === b.body && a.captureNote === b.captureNote;

/**
 * Unsaved Memory detail edits, kept in this browser until the server has
 * them: a page that closes mid-edit (a save too big for keepalive, or one
 * still queued) loses nothing. Each draft records the revision it was
 * written on, so it is never applied over a newer one without asking.
 * Storage can be blocked or full; then drafts are simply off.
 */
export function draftStore(storage: Storage | undefined) {
  const read = (id: string): KeptDraft | undefined => {
    try {
      const raw = storage?.getItem(key(id));
      const value = raw ? (JSON.parse(raw) as Partial<KeptDraft>) : undefined;
      return typeof value?.title === "string" &&
        typeof value.body === "string" &&
        typeof value.captureNote === "string" &&
        Number.isInteger(value.revision)
        ? (value as KeptDraft)
        : undefined;
    } catch {
      return undefined;
    }
  };
  const discard = (id: string) => {
    try {
      storage?.removeItem(key(id));
    } catch {
      // Nothing to forget in blocked storage.
    }
  };
  return {
    read,
    discard,
    keep(id: string, draft: Draft, revision: number) {
      const { title, body, captureNote } = draft;
      try {
        storage?.setItem(
          key(id),
          JSON.stringify({ title, body, captureNote, revision })
        );
      } catch {
        // Blocked or full: the open dialog still autosaves.
      }
    },
    /** The server has `draft`; forget it unless a newer one was kept since. */
    saved(id: string, draft: Draft) {
      const kept = read(id);
      if (kept && sameText(kept, draft)) discard(id);
    },
  };
}

export type DraftStore = ReturnType<typeof draftStore>;

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
