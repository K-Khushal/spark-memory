import type { Dispatch, SetStateAction } from "react";
import type { InferResponseType } from "@spark/api-client";
import { FREE_ALLOWANCE, type MemoryEditRequest } from "@spark/core";
import type { toast } from "@spark/ui";
import type { api } from "../api";
import { sameText, type Draft, type DraftStore } from "./drafts";

export type Memory = InferResponseType<
  (typeof api.api.memories)[":id"]["$get"],
  200
>;
/** A Memory on the wall; `fresh` marks a Capture that has just landed. */
export type WallMemory = Memory & { fresh?: boolean };

/** What the actions need from the server. Each call rejects when it fails. */
export type Transport = {
  create: (input: {
    id: string;
    body: string;
    captureNote: string | null;
  }) => Promise<Memory>;
  /** "stale" when the Memory has moved past `json.revision`. */
  patch: (
    id: string,
    json: MemoryEditRequest,
    init: { keepalive: boolean }
  ) => Promise<Memory | "stale">;
  remove: (id: string, init: { keepalive: boolean }) => Promise<void>;
  get: (id: string) => Promise<Memory | undefined>;
};

const UNDO_MS = 5000;
/** keepalive carries at most 64 KB of body per page; leave room for headers. */
const KEEPALIVE_BYTES = 60_000;

const fitsKeepalive = (json: unknown) =>
  new TextEncoder().encode(JSON.stringify(json)).length <= KEEPALIVE_BYTES;

/**
 * The one pending edit of a Memory (at most one each):
 * - dirty: typed, not sent yet;
 * - sending: one request in flight (typing goes on into `fields`);
 * - failed: the last send failed; Try Again sends `fields` as they are now;
 * - conflict: the Memory changed elsewhere; the wall shows the server copy
 *   and only Restore sends `fields`, rebased on the server's revision.
 * `fromStorage` marks a draft from an earlier page that is only on offer.
 */
export type PendingEdit = Readonly<{
  fields: Draft;
  baseRevision: number;
  status: "dirty" | "sending" | "failed" | "conflict";
  fromStorage: boolean;
}>;

export const textOf = (memory: Memory): Draft => ({
  title: memory.title ?? "",
  body: memory.body ?? "",
  captureNote: memory.captureNote ?? "",
});

/** `memory` showing `fields`, as the server will store them. */
const withText = (memory: Memory, fields: Draft): Memory => ({
  ...memory,
  title: fields.title.trim() || null,
  body: fields.body.trim() ? fields.body.trim() : memory.body,
  captureNote: fields.captureNote.trim() || null,
});

export const newestFirst = (a: Memory, b: Memory) =>
  b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id);

/**
 * Capture, edit and delete, optimistic: the wall changes first and rolls back
 * with a message if the server says no. Requests for one Memory go in order
 * (Capture, then edits, then delete). Edits follow one model, a single
 * PendingEdit per Memory, mirrored to `drafts` so a closing page loses
 * nothing. `onSaved` runs after each change the server accepted.
 */
export function libraryActions({
  setMemories,
  transport,
  drafts,
  notify,
  onSaved,
}: {
  setMemories: Dispatch<SetStateAction<WallMemory[]>>;
  transport: Transport;
  drafts: DraftStore;
  notify: typeof toast;
  onSaved: () => void;
}) {
  /** Deletes waiting out their Undo window: id → send it now. */
  const pendingDeletes = new Map<string, () => void>();
  /** The tail of each Memory's queue of requests. */
  const queues = new Map<string, Promise<unknown>>();
  const pending = new Map<string, PendingEdit>();
  /** The server's copy, as last seen, per Memory with a pending edit. */
  const serverCopy = new Map<string, Memory>();
  const watchers = new Map<string, Set<(edit?: PendingEdit) => void>>();

  /** The only way a pending edit changes: kept as a draft, and watchers told. */
  function setPending(id: string, edit: PendingEdit | undefined) {
    if (edit) {
      pending.set(id, edit);
      drafts.keep(
        id,
        edit.fields,
        edit.baseRevision,
        edit.status === "conflict"
      );
    } else {
      pending.delete(id);
      serverCopy.delete(id);
      drafts.discard(id);
    }
    for (const watch of watchers.get(id) ?? []) watch(edit);
  }

  function inOrder<T>(id: string, task: () => Promise<T>): Promise<T> {
    const next = (queues.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(task);
    queues.set(id, next);
    void next
      .catch(() => {})
      .finally(() => queues.get(id) === next && queues.delete(id));
    return next;
  }

  const removeLocal = (id: string) =>
    setMemories((all) => all.filter((m) => m.id !== id));
  const restoreLocal = (memory: Memory) =>
    setMemories((all) =>
      all.some((m) => m.id === memory.id)
        ? all
        : [...all, memory].sort(newestFirst)
    );
  const replaceLocal = (memory: Memory) =>
    setMemories((all) => all.map((m) => (m.id === memory.id ? memory : m)));

  function capture(text: string, captureNote?: string): boolean {
    const body = text.trim();
    if (!body) {
      notify("Paste Text to Capture");
      return false;
    }
    if (body.length > FREE_ALLOWANCE.textMaxChars) {
      notify("Too Long to Capture");
      return false;
    }
    const now = new Date().toISOString();
    send({
      id: crypto.randomUUID(),
      kind: "text",
      title: null,
      body,
      captureNote: captureNote?.trim() || null,
      preservation: "preserved",
      indexState: "searchable",
      revision: 1,
      capturedAt: now,
      updatedAt: now,
      fresh: true,
    });
    return true;
  }

  /** Puts `memory` on the wall and sends it; Try Again resends the same one (same id). */
  function send(memory: WallMemory) {
    setMemories((all) =>
      all.some((m) => m.id === memory.id) ? all : [memory, ...all]
    );
    const created = inOrder(memory.id, () =>
      transport.create({
        id: memory.id,
        body: memory.body ?? "",
        captureNote: memory.captureNote,
      })
    );

    const undo = () => {
      removeLocal(memory.id);
      inOrder(memory.id, () =>
        transport.remove(memory.id, { keepalive: true })
      ).then(onSaved, () => {
        // A Capture that never landed has nothing to delete.
        void created.then(() => {
          restoreLocal(memory);
          notify("Undo Did Not Finish", {
            action: { label: "Try Again", onClick: undo },
          });
        });
      });
    };
    const toastId = notify("Captured", {
      duration: UNDO_MS,
      action: { label: "Undo", onClick: undo },
    });

    created.then(
      (saved) => {
        // The server's copy (its Capture time) replaces the optimistic one,
        // unless Undo already took it off the wall.
        onSaved();
        if (!pending.has(saved.id)) replaceLocal(saved);
      },
      () => {
        removeLocal(memory.id);
        notify("Capture Did Not Finish", {
          id: toastId,
          duration: 8000,
          action: { label: "Try Again", onClick: () => send(memory) },
        });
      }
    );
  }

  /** The person typed: their text becomes the pending edit (latest wins). */
  function editText(memory: Memory, fields: Draft) {
    const id = memory.id;
    const now = pending.get(id);
    const base = serverCopy.get(id) ?? memory;
    setPending(id, {
      fields,
      // Typing over the server's copy after a conflict is a new edit on it.
      baseRevision:
        !now || now.status === "conflict" ? base.revision : now.baseRevision,
      status: now?.status === "sending" ? "sending" : "dirty",
      fromStorage: false,
    });
    replaceLocal(withText(base, fields));
  }

  /** Sends the pending edit as it is now. One request at a time per Memory. */
  function saveEdit(id: string, { keepalive = true } = {}) {
    const edit = pending.get(id);
    if (!edit || edit.status === "sending" || edit.status === "conflict") {
      return;
    }
    const sent = edit.fields;
    const json: MemoryEditRequest = {
      title: sent.title,
      captureNote: sent.captureNote,
      // Text can't be emptied; the other fields still save.
      ...(sent.body.trim() && { body: sent.body }),
      revision: edit.baseRevision,
    };
    setPending(id, { ...edit, status: "sending" });
    const init = { keepalive: keepalive && fitsKeepalive(json) };

    inOrder(id, () => transport.patch(id, json, init)).then(
      async (result) => {
        const now = pending.get(id);
        if (!now) return; // deleted meanwhile
        if (result === "stale") {
          const latest = await transport.get(id).catch(() => undefined);
          if (latest) {
            serverCopy.set(id, latest);
            replaceLocal(latest);
          }
          setPending(id, { ...(pending.get(id) ?? now), status: "conflict" });
          return;
        }
        onSaved();
        serverCopy.set(id, result);
        const latest = pending.get(id) ?? now;
        if (sameText(latest.fields, sent)) {
          setPending(id, undefined);
          replaceLocal(result);
        } else {
          // Typed during the send: that is next, on the new revision.
          setPending(id, {
            ...latest,
            baseRevision: result.revision,
            status: "dirty",
          });
          saveEdit(id, { keepalive });
        }
      },
      () => {
        const now = pending.get(id);
        if (!now) return;
        setPending(id, { ...now, status: "failed" });
        notify("Changes Did Not Save", {
          id: `edit-${id}`,
          action: { label: "Try Again", onClick: () => saveEdit(id) },
        });
      }
    );
  }

  /** Restore Your Edit: the refused or left-behind text, on the server's revision. */
  function restoreEdit(id: string) {
    const edit = pending.get(id);
    if (edit?.status !== "conflict") return;
    const base = serverCopy.get(id);
    setPending(id, {
      ...edit,
      baseRevision: base?.revision ?? edit.baseRevision,
      status: "dirty",
      fromStorage: false,
    });
    if (base) replaceLocal(withText(base, edit.fields));
    saveEdit(id);
  }

  /**
   * Memory detail opened: its pending edit, picking up a draft an earlier page
   * left. A draft on the current revision carries on (and is sent); one on an
   * older revision, or already refused, is only offered.
   */
  function openEdit(memory: Memory): PendingEdit | undefined {
    const id = memory.id;
    const now = pending.get(id);
    if (now) return now;
    const kept = drafts.read(id);
    if (!kept) return undefined;
    const { revision, conflict, ...fields } = kept;
    serverCopy.set(id, memory);
    if (!conflict && revision === memory.revision) {
      setPending(id, {
        fields,
        baseRevision: revision,
        status: "dirty",
        fromStorage: false,
      });
      replaceLocal(withText(memory, fields));
      saveEdit(id);
    } else {
      setPending(id, {
        fields,
        baseRevision: revision,
        status: "conflict",
        fromStorage: true,
      });
    }
    return pending.get(id);
  }

  /**
   * Memory detail closed. Unsaved text is sent and stays a draft until saved;
   * a refused edit stays a draft to offer next time. Only a left-behind draft
   * that was offered and neither restored nor typed over is dropped.
   */
  function closeEdit(id: string) {
    const edit = pending.get(id);
    if (!edit) return;
    if (edit.status === "conflict") {
      if (edit.fromStorage) setPending(id, undefined);
      return;
    }
    if (!edit.fields.body.trim()) notify("Text Can't Be Empty");
    saveEdit(id);
  }

  const pendingEdit = (id: string) => pending.get(id);

  /** What openEdit(memory) will give, without changing anything (for a first render). */
  function previewEdit(memory: Memory): PendingEdit | undefined {
    const now = pending.get(memory.id);
    if (now) return now;
    const kept = drafts.read(memory.id);
    if (!kept) return undefined;
    const { revision, conflict, ...fields } = kept;
    const resumes = !conflict && revision === memory.revision;
    return {
      fields,
      baseRevision: revision,
      status: resumes ? "dirty" : "conflict",
      fromStorage: !resumes,
    };
  }

  /** Hears every change to a Memory's pending edit; returns a stop function. */
  function watchEdit(id: string, watch: (edit?: PendingEdit) => void) {
    const set = watchers.get(id) ?? new Set();
    set.add(watch);
    watchers.set(id, set);
    return () => void set.delete(watch);
  }

  function remove(memory: Memory) {
    setPending(memory.id, undefined);
    removeLocal(memory.id);
    let done = false;
    const send = (keepalive = false) => {
      if (done) return;
      done = true;
      pendingDeletes.delete(memory.id);
      inOrder(memory.id, () => transport.remove(memory.id, { keepalive })).then(
        onSaved,
        () => {
          restoreLocal(memory);
          notify("Delete Did Not Finish", {
            action: { label: "Try Again", onClick: () => remove(memory) },
          });
        }
      );
    };
    pendingDeletes.set(memory.id, () => send(true));
    notify("Deleted", {
      duration: UNDO_MS,
      onAutoClose: () => send(),
      onDismiss: () => send(),
      action: {
        label: "Undo",
        onClick: () => {
          done = true;
          pendingDeletes.delete(memory.id);
          restoreLocal(memory);
        },
      },
    });
  }

  return {
    capture,
    editText,
    saveEdit,
    restoreEdit,
    openEdit,
    closeEdit,
    pendingEdit,
    previewEdit,
    watchEdit,
    remove,
    /** For a page on its way out: Undo is gone, unsent edits go now. */
    sendPending: () => {
      for (const send of pendingDeletes.values()) send();
      for (const id of pending.keys()) saveEdit(id);
    },
  };
}
