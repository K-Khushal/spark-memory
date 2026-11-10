/** What Memory detail edits. */
export type Draft = { title: string; body: string; captureNote: string };

/**
 * A Memory's pending edit as kept in this browser: the person's unsaved
 * text (`fields`, written on `baseRevision`), text the server refused
 * (`refused`), and which page wrote it, so another tab only ever offers it.
 */
export type StoredEdit = {
  fields?: Draft;
  baseRevision: number;
  refused?: Draft;
  page: string;
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const key = (id: string) => `spark-draft:${id}`;
export const sameText = (a: Draft, b: Draft) =>
  a.title === b.title && a.body === b.body && a.captureNote === b.captureNote;

const isDraft = (x: unknown): x is Draft =>
  typeof x === "object" &&
  x !== null &&
  typeof (x as Draft).title === "string" &&
  typeof (x as Draft).body === "string" &&
  typeof (x as Draft).captureNote === "string";

const draftOf = ({ title, body, captureNote }: Draft): Draft => ({
  title,
  body,
  captureNote,
});

/**
 * Pending edits kept in this browser until the server has them, so a page
 * that closes mid-edit loses nothing. Storage can be blocked or full; then
 * this is simply off.
 */
export function draftStore(storage: Storage | undefined) {
  return {
    read(id: string): StoredEdit | undefined {
      try {
        const raw = storage?.getItem(key(id));
        const v = raw ? (JSON.parse(raw) as Partial<StoredEdit>) : undefined;
        if (!v || !Number.isInteger(v.baseRevision)) return undefined;
        if (typeof v.page !== "string") return undefined;
        const fields = isDraft(v.fields) ? draftOf(v.fields) : undefined;
        const refused = isDraft(v.refused) ? draftOf(v.refused) : undefined;
        if (!fields && !refused) return undefined;
        return { fields, refused, baseRevision: v.baseRevision!, page: v.page };
      } catch {
        return undefined;
      }
    },
    keep(id: string, edit: StoredEdit) {
      try {
        storage?.setItem(key(id), JSON.stringify(edit));
      } catch {
        // Blocked or full: the open page still holds the edit.
      }
    },
    discard(id: string) {
      try {
        storage?.removeItem(key(id));
      } catch {
        // Nothing to forget in blocked storage.
      }
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
