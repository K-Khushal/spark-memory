import type { Dispatch, SetStateAction } from "react";
import type { InferResponseType } from "@spark/api-client";
import { FREE_ALLOWANCE, type MemoryEditRequest } from "@spark/core";
import type { toast } from "@spark/ui";
import type { api } from "../api";
import { captureProductAnalytics } from "../product-analytics";
import {
  sameText,
  type Draft,
  type DraftStore,
  type StoredEdit,
} from "./drafts";
import {
  imageCapture,
  type ImageTransport,
  type UploadState,
} from "./image-capture";

export type Memory = InferResponseType<
  (typeof api.api.memories)[":id"]["$get"],
  200
>;
/**
 * A Memory on the wall; `fresh` marks a Capture that has just landed, and
 * `upload` an image whose files are still on their way (image-capture.ts).
 */
export type WallMemory = Memory & { fresh?: boolean; upload?: UploadState };

/** What the actions need from the server. Each call rejects when it fails. */
export type Transport = ImageTransport & {
  create: (input: {
    id: string;
    body: string;
    captureNote: string | null;
    productAnalytics?: boolean;
  }) => Promise<Memory>;
  /** "stale" when the Memory has moved past `json.revision`. */
  patch: (
    id: string,
    json: MemoryEditRequest,
    init: { keepalive: boolean }
  ) => Promise<Memory | "stale">;
  /** Resolves when the Memory is gone, including when it never existed. */
  remove: (id: string, init: { keepalive: boolean }) => Promise<void>;
  get: (id: string) => Promise<Memory | undefined>;
};

const UNDO_MS = 5000;
/** keepalive carries at most 64 KB of body per page; leave room for headers. */
const KEEPALIVE_BYTES = 60_000;

const fitsKeepalive = (json: unknown) =>
  new TextEncoder().encode(JSON.stringify(json)).length <= KEEPALIVE_BYTES;

/**
 * The one pending edit of a Memory (at most one each).
 * `fields` is the person's own edit, written on `baseRevision`:
 * - idle: none (only `refused` is on offer);
 * - dirty: typed, not sent yet;
 * - sending: one request in flight (typing goes on into `fields`);
 * - failed: the last send failed; Try Again sends `fields` as they are now.
 * `refused` is text the server refused because the Memory changed elsewhere,
 * or text another page left: it is only ever sent by Restore Your Edit, and
 * typing never overwrites it. `fromStorage` marks a `refused` from storage,
 * which is dropped if closed without a Restore.
 */
export type PendingEdit = Readonly<{
  fields?: Draft;
  baseRevision: number;
  status: "idle" | "dirty" | "sending" | "failed";
  refused?: Draft;
  fromStorage: boolean;
}>;

export const textOf = (memory: Memory): Draft => ({
  title: memory.title ?? "",
  body: memory.body ?? "",
  captureNote: memory.captureNote ?? "",
});

/** `memory` showing `fields`, as the server will store them. */
const trimmed = (d: Draft): Draft => ({
  title: d.title.trim(),
  body: d.body.trim(),
  captureNote: d.captureNote.trim(),
});
/** Whether the server already stores `fields` for `memory`. */
const saved = (memory: Memory, fields: Draft) =>
  sameText(trimmed(fields), textOf(memory)) ||
  (!fields.body.trim() &&
    sameText({ ...trimmed(fields), body: memory.body ?? "" }, textOf(memory)));

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
  onCaptured,
}: {
  setMemories: Dispatch<SetStateAction<WallMemory[]>>;
  transport: Transport;
  drafts: DraftStore;
  notify: typeof toast;
  onSaved: () => void;
  /** The server accepted a new Memory. Kind only, for the product event. */
  onCaptured?: (kind: "text" | "image") => void;
}) {
  /** Deletes waiting out their Undo window: id → send it now. */
  const pendingDeletes = new Map<string, () => void>();
  /** The tail of each Memory's queue of requests. */
  const queues = new Map<string, Promise<unknown>>();
  const pending = new Map<string, PendingEdit>();
  /** The server's copy, as last seen, per Memory with a pending edit. */
  const serverCopy = new Map<string, Memory>();
  const watchers = new Map<string, Set<(edit?: PendingEdit) => void>>();

  /** Tags this page's drafts: only the page that wrote one resumes it. */
  const page = crypto.randomUUID();

  /** The only way a pending edit changes: kept as a draft, and watchers told. */
  function setPending(id: string, edit: PendingEdit | undefined) {
    if (edit && (edit.fields || edit.refused)) {
      pending.set(id, edit);
      drafts.keep(id, {
        fields: edit.fields,
        baseRevision: edit.baseRevision,
        refused: edit.refused,
        page,
      });
    } else {
      edit = undefined;
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
      indexState: "indexing",
      indexError: null,
      indexTitle: null,
      aiOptOut: false,
      revision: 1,
      capturedAt: now,
      updatedAt: now,
      image: null,
      fresh: true,
    });
    return true;
  }

  const images = imageCapture({
    setMemories,
    transport,
    notify,
    onSaved,
    onCaptured: () => onCaptured?.("image"),
    inOrder,
  });

  /** Deletes Memories now, no Undo window; Try Again resends the deletes. */
  function removeNow(ids: string[]) {
    for (const id of ids) {
      if (!images.cancel(id)) removeLocal(id);
      inOrder(id, () => transport.remove(id, { keepalive: true })).then(
        onSaved,
        () =>
          notify("Delete Did Not Finish", {
            id: `remove-${id}`,
            action: { label: "Try Again", onClick: () => removeNow([id]) },
          })
      );
    }
  }

  /** Captures image files: each lands and uploads on its own; Undo takes the batch back. */
  async function captureImages(files: File[]) {
    const ids = await images.capture(files);
    if (!ids.length) return;
    notify("Captured", {
      duration: UNDO_MS,
      action: { label: "Undo", onClick: () => removeNow(ids) },
    });
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
        productAnalytics: captureProductAnalytics(),
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
        onCaptured?.("text");
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

  /**
   * The person typed: their text becomes the pending edit (latest wins).
   * Typing over the server's copy is a new edit on the server's revision;
   * a refused edit stays on offer beside it.
   */
  function editText(memory: Memory, fields: Draft) {
    const id = memory.id;
    const now = pending.get(id);
    const base = serverCopy.get(id) ?? memory;
    setPending(id, {
      fields,
      baseRevision:
        !now || now.status === "idle" ? base.revision : now.baseRevision,
      status: now?.status === "sending" ? "sending" : "dirty",
      refused: now?.refused,
      fromStorage: now?.fromStorage ?? false,
    });
    replaceLocal(withText(base, fields));
  }

  /** Sends the pending edit as it is now. One request at a time per Memory. */
  function saveEdit(id: string, { keepalive = true } = {}) {
    const edit = pending.get(id);
    if (!edit?.fields || edit.status === "sending" || edit.status === "idle") {
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

    const failed = () => {
      const now = pending.get(id);
      if (!now) return;
      setPending(id, { ...now, status: "failed" });
      notify("Changes Did Not Save", {
        id: `edit-${id}`,
        action: { label: "Try Again", onClick: () => saveEdit(id) },
      });
    };

    inOrder(id, () => transport.patch(id, json, init)).then(async (result) => {
      if (!pending.has(id)) return; // deleted meanwhile
      if (result === "stale") {
        const latest = await transport.get(id).catch(() => undefined);
        const now = pending.get(id);
        if (!now) return; // deleted while the server copy loaded
        // Without the server's copy nothing can be offered: try again later.
        if (!latest) return failed();
        serverCopy.set(id, latest);
        replaceLocal(latest);
        setPending(id, {
          baseRevision: latest.revision,
          status: "idle",
          refused: now.fields,
          fromStorage: false,
        });
        return;
      }
      onSaved();
      serverCopy.set(id, result);
      const now = pending.get(id)!;
      if (now.fields && sameText(now.fields, sent)) {
        setPending(id, {
          ...now,
          fields: undefined,
          baseRevision: result.revision,
          status: "idle",
        });
        replaceLocal(result);
      } else {
        // Typed during the send: that is next, on the new revision.
        setPending(id, {
          ...now,
          baseRevision: result.revision,
          status: "dirty",
        });
        saveEdit(id, { keepalive });
      }
    }, failed);
  }

  /**
   * Restore Your Edit: the refused text becomes the edit, on the server's
   * current revision, and is sent. Returns the restored text.
   */
  function restoreEdit(id: string): Draft | undefined {
    const edit = pending.get(id);
    const base = serverCopy.get(id);
    if (!edit?.refused || !base) return undefined;
    const fields = edit.refused;
    setPending(id, {
      fields,
      baseRevision:
        edit.status === "sending" ? edit.baseRevision : base.revision,
      status: edit.status === "sending" ? "sending" : "dirty",
      refused: undefined,
      fromStorage: false,
    });
    replaceLocal(withText(base, fields));
    saveEdit(id);
    return fields;
  }

  /**
   * What opening `memory` finds, from a draft in storage: text the server
   * already has is dropped; this page's own draft on the current revision
   * carries on; anything else (another tab's, an older revision's, a refused
   * one) is only offered.
   */
  function fromStorage(
    memory: Memory,
    kept: StoredEdit | undefined
  ): PendingEdit | undefined {
    if (!kept) return undefined;
    const fields =
      kept.fields && !saved(memory, kept.fields) ? kept.fields : undefined;
    const refused =
      kept.refused && !saved(memory, kept.refused) ? kept.refused : undefined;
    if (fields && kept.page === page && kept.baseRevision === memory.revision) {
      return {
        fields,
        baseRevision: kept.baseRevision,
        status: "dirty",
        refused,
        fromStorage: false,
      };
    }
    const offer = fields ?? refused;
    if (!offer) return undefined;
    return {
      baseRevision: memory.revision,
      status: "idle",
      refused: offer,
      fromStorage: true,
    };
  }

  /** Memory detail opened: its pending edit, picking up a stored draft. */
  function openEdit(memory: Memory): PendingEdit | undefined {
    const id = memory.id;
    const now = pending.get(id);
    if (now) return now;
    const kept = drafts.read(id);
    const edit = fromStorage(memory, kept);
    if (!edit) {
      if (kept) drafts.discard(id);
      return undefined;
    }
    serverCopy.set(id, memory);
    setPending(id, edit);
    if (edit.fields) {
      replaceLocal(withText(memory, edit.fields));
      saveEdit(id);
    }
    return pending.get(id);
  }

  /**
   * Memory detail closed. Unsaved text is sent and stays a draft until saved;
   * refused text stays a draft to offer next time. Only text offered from
   * storage and neither restored nor typed beside is dropped.
   */
  function closeEdit(id: string) {
    const edit = pending.get(id);
    if (!edit) return;
    if (edit.fromStorage && edit.refused) {
      setPending(id, { ...edit, refused: undefined, fromStorage: false });
    }
    if (!edit.fields) return;
    if (!edit.fields.body.trim()) notify("Text Can't Be Empty");
    saveEdit(id);
  }

  const pendingEdit = (id: string) => pending.get(id);

  /** What openEdit(memory) will give, without changing anything (for a first render). */
  const previewEdit = (memory: Memory) =>
    pending.get(memory.id) ?? fromStorage(memory, drafts.read(memory.id));

  /** Hears every change to a Memory's pending edit; returns a stop function. */
  function watchEdit(id: string, watch: (edit?: PendingEdit) => void) {
    const set = watchers.get(id) ?? new Set();
    set.add(watch);
    watchers.set(id, set);
    return () => void set.delete(watch);
  }

  /**
   * Delete with a 5 second Undo. A pending edit stays until the delete is
   * sent; Undo brings the Memory back and sends the edit.
   */
  function remove(memory: Memory) {
    const id = memory.id;
    // Nothing is stored yet, so nothing to Undo: the upload stops, and goes.
    if (images.isUploading(id)) {
      removeNow([id]);
      notify("Deleted");
      return;
    }
    removeLocal(id);
    let done = false;
    const send = (keepalive = false) => {
      if (done) return;
      done = true;
      pendingDeletes.delete(id);
      setPending(id, undefined);
      inOrder(id, () => transport.remove(id, { keepalive })).then(
        onSaved,
        () => {
          restoreLocal(memory);
          notify("Delete Did Not Finish", {
            action: { label: "Try Again", onClick: () => remove(memory) },
          });
        }
      );
    };
    pendingDeletes.set(id, () => send(true));
    notify("Deleted", {
      duration: UNDO_MS,
      onAutoClose: () => send(),
      onDismiss: () => send(),
      action: {
        label: "Undo",
        onClick: () => {
          done = true;
          pendingDeletes.delete(id);
          const edit = pending.get(id);
          restoreLocal(edit?.fields ? withText(memory, edit.fields) : memory);
          if (edit?.status === "failed")
            setPending(id, { ...edit, status: "dirty" });
          saveEdit(id);
        },
      },
    });
  }

  /** Refreshes a Memory's signed URLs (they last two hours), once a minute at most. */
  const refreshed = new Map<string, number>();
  function refresh(id: string) {
    const last = refreshed.get(id) ?? 0;
    if (images.isUploading(id) || Date.now() - last < 60_000) return;
    refreshed.set(id, Date.now());
    void transport.get(id).then(
      // Fresh URLs only: whatever the wall knows of its upload stays.
      (fresh) =>
        fresh &&
        setMemories((all) =>
          all.map((m) => (m.id === id ? { ...fresh, upload: m.upload } : m))
        ),
      () => {}
    );
  }

  return {
    capture,
    captureImages,
    retryUpload: images.retry,
    /** A request for this Memory (Capture, Try Again, edit, delete) is still out. */
    isPending: (id: string) => queues.has(id),
    refresh,
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
