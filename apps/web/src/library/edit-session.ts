import type { MemoryEdit } from "@spark/core";
import type { toast } from "@spark/ui";
import {
  sameText,
  type Draft,
  type DraftStore,
  type KeptDraft,
} from "./drafts";
import type { EditOutcome, Memory } from "./library-actions";

type View = {
  /** Puts text in the fields (after a refusal or a Restore). */
  show: (fields: Draft) => void;
  /** Shows or hides the Restore Your Edit button. */
  offer: (on: boolean) => void;
};

const textOf = (memory: Memory): Draft => ({
  title: memory.title ?? "",
  body: memory.body ?? "",
  captureNote: memory.captureNote ?? "",
});
const trimmed = (d: Draft): Draft => ({
  title: d.title.trim(),
  body: d.body.trim(),
  captureNote: d.captureNote.trim(),
});

/**
 * One open Memory detail: what its fields start with, when an edit is sent,
 * and what happens when the Memory changed elsewhere.
 *
 * - Edits save as they come (the caller debounces) and on close. Until the
 *   server has one it is kept as a draft, with the revision it was written on.
 * - A draft on the Memory's current revision comes back on open. One on an
 *   older revision never applies by itself: the server copy shows, and one
 *   button in the dialog offers "Restore Your Edit" (inside the focus trap,
 *   so the keyboard reaches it). Not taken, it is gone once this closes.
 * - An edit refused as stale stops saving until the person acts: the server
 *   copy shows, and the refused text is offered the same way. Nothing is
 *   resubmitted on its own.
 */
export function editSession({
  start,
  drafts,
  save,
  notify,
}: {
  /** The Memory as it was when the dialog opened. */
  start: Memory;
  drafts: DraftStore;
  save: (before: Memory, changes: MemoryEdit) => Promise<EditOutcome>;
  notify: typeof toast;
}) {
  /** The Memory as the wall has it now (see seen()). */
  let current = start;
  const memory = () => current;
  /** Where the dialog hears about text to show and the Restore offer; see listen(). */
  let view: View = { show: () => {}, offer: () => {} };
  const id = start.id;
  const kept = drafts.read(id);
  const resumes = kept?.revision === start.revision;

  let fields: Draft = resumes ? { ...kept } : textOf(start);
  /** What the server has, or has been sent. */
  let sent = textOf(start);
  /** The revision `fields` were written on. */
  let revision = start.revision;
  /** Edits refused or left behind, offered once through "Restore Your Edit". */
  let offered: KeptDraft | undefined = resumes ? undefined : kept;
  let blocked = false;
  let closed = false;
  let deleted = false;
  let closing: ReturnType<typeof setTimeout> | undefined;

  const setOffer = (next: KeptDraft | undefined) => {
    offered = next;
    view.offer(!!next);
  };

  function restore() {
    if (!offered || closed) return;
    fields = {
      title: offered.title,
      body: offered.body,
      captureNote: offered.captureNote,
    };
    setOffer(undefined);
    blocked = false;
    revision = memory().revision;
    drafts.keep(id, fields, revision);
    view.show(fields);
    flush(false);
  }

  function flush(closing: boolean) {
    if (deleted || blocked) return;
    const draft = fields;
    const base = sent;
    const next = trimmed(draft);
    const changes: MemoryEdit = {};
    if (next.title !== base.title) changes.title = draft.title;
    if (next.captureNote !== base.captureNote)
      changes.captureNote = draft.captureNote;
    if (!next.body) {
      if (closing) {
        notify("Text Can't Be Empty");
        drafts.keep(id, { ...draft, body: base.body }, revision);
      }
    } else if (next.body !== base.body) changes.body = draft.body;
    if (!Object.keys(changes).length) return;
    sent = {
      ...next,
      body: changes.body === undefined ? base.body : next.body,
    };
    const writtenOn = revision;

    void save(memory(), changes).then((outcome) => {
      if (outcome.status === "saved") {
        revision = outcome.memory.revision;
        drafts.saved(id, draft);
        // Typed on since: that draft now sits on the new revision.
        if (!sameText(fields, draft) && drafts.read(id)) {
          drafts.keep(id, fields, revision);
        }
      } else if (outcome.status === "stale") {
        const latest = outcome.latest ?? memory();
        const refused = { ...fields, revision: writtenOn };
        drafts.keep(id, refused, writtenOn);
        sent = textOf(latest);
        revision = latest.revision;
        if (closed) return; // offered when this Memory next opens
        blocked = true;
        fields = textOf(latest);
        view.show(fields);
        setOffer(refused);
      } else if (sameText(sent, trimmed(draft))) {
        sent = base; // failed: the next save sends it again
      }
    });
  }

  return {
    initial: fields,
    /** Whether "Restore Your Edit" is on offer. */
    get offered() {
      return !!offered;
    },
    restore,
    /** The dialog is showing (again: React's StrictMode closes and reopens at once). */
    open() {
      clearTimeout(closing);
    },
    /** The fields changed; true when there is something to save. */
    change(next: Draft): boolean {
      if (sameText(next, fields)) return false; // our own show() echoing back
      fields = next;
      blocked = false; // typing on the server copy is a choice too
      const dirty = !sameText(trimmed(next), sent);
      if (dirty) drafts.keep(id, next, revision);
      return dirty;
    },
    flush,
    /** The wall's copy changed (an optimistic edit, a save, a refusal). */
    seen(memory: Memory) {
      current = memory;
    },
    /** Where text shown by the session goes; returns a stop function. */
    listen(next: View) {
      view = next;
      return () => {
        view = { show: () => {}, offer: () => {} };
      };
    },
    close() {
      flush(true);
      closing = setTimeout(() => {
        closed = true;
        if (offered) {
          drafts.discard(id);
          setOffer(undefined);
        }
      });
    },
    deleted() {
      deleted = true;
      drafts.discard(id);
    },
  };
}

export type EditSession = ReturnType<typeof editSession>;
