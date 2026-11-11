/** What Memory detail edits. */
export type Draft = { title: string; body: string; captureNote: string };

/**
 * A Memory's pending edit as kept in this browser: the person's unsaved
 * text (`fields`, written on `baseRevision`), text the server refused
 * (`refused`, newest first, at most three), and which page wrote it, so
 * another tab only ever offers it.
 */
export type StoredEdit = {
  fields?: Draft;
  baseRevision: number;
  refused?: Draft[];
  page: string;
};

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

const key = (id: string) => `spark-draft:${id}`;
export const REFUSED_MAX = 3;

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

/** Newest first, de-duplicated, at most `REFUSED_MAX`. Accepts a legacy single Draft. */
export function refusedList(value: unknown): Draft[] {
  const items = Array.isArray(value) ? value : value != null ? [value] : [];
  const out: Draft[] = [];
  for (const item of items) {
    if (!isDraft(item)) continue;
    const next = draftOf(item);
    if (!out.some((d) => sameText(d, next))) out.push(next);
    if (out.length === REFUSED_MAX) break;
  }
  return out;
}

/** Puts `next` at the front of a refused list, de-duplicated, capped. */
export function withRefused(
  list: Draft[] | undefined,
  next: Draft | undefined
): Draft[] | undefined {
  if (!next) return list?.length ? list : undefined;
  const rest = (list ?? []).filter((d) => !sameText(d, next));
  const out = [next, ...rest].slice(0, REFUSED_MAX);
  return out.length ? out : undefined;
}

/**
 * Pending edits kept in this browser until the server has them, so a page
 * that closes mid-edit loses nothing. Storage can be blocked or full; then
 * this is simply off. `page` is this live JS realm: drafts it writes are
 * tagged with it, and a new load (or another tab) only ever offers them.
 */
export function draftStore(
  storage: Storage | undefined,
  page: string = crypto.randomUUID()
) {
  return {
    page,
    read(id: string): StoredEdit | undefined {
      try {
        const raw = storage?.getItem(key(id));
        const v = raw ? (JSON.parse(raw) as Partial<StoredEdit>) : undefined;
        if (!v || !Number.isInteger(v.baseRevision)) return undefined;
        if (typeof v.page !== "string") return undefined;
        const fields = isDraft(v.fields) ? draftOf(v.fields) : undefined;
        const refused = refusedList(v.refused);
        if (!fields && !refused.length) return undefined;
        return {
          fields,
          refused: refused.length ? refused : undefined,
          baseRevision: v.baseRevision!,
          page: v.page,
        };
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
