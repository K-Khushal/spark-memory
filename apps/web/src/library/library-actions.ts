import type { BulkOutbox, PendingBulk } from "./bulk-outbox";
import type { Dispatch, SetStateAction } from "react";
import type { InferResponseType } from "@spark/api-client";
import {
  BULK_LIMIT,
  type BulkMemories,
  FREE_ALLOWANCE,
  linkFromPaste,
  type MemoryEditRequest,
} from "@spark/core";
import type { toast } from "@spark/ui";
import type { api } from "../api";
import { captureProductAnalytics } from "../product-analytics";
import {
  sameText,
  withRefused,
  type Draft,
  type DraftStore,
  type StoredEdit,
} from "./drafts";
import {
  imageCapture,
  type CaptureOutcome,
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
  /** A pasted link; a different id back means the page was already saved. */
  createLink: (input: {
    id: string;
    url: string;
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
  bulk?: (
    change: BulkMemories,
    init: { keepalive: boolean }
  ) => Promise<{ ids: string[] }>;
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
 * or text another page left: newest first, at most three, only ever sent by
 * Restore Your Edit. Typing never overwrites it. `fromStorage` marks an
 * offer loaded from storage: this page does not rewrite that crash copy,
 * never auto-sends it, and never drops it on close.
 */
export type PendingEdit = Readonly<{
  fields?: Draft;
  baseRevision: number;
  status: "idle" | "dirty" | "sending" | "failed";
  refused?: Draft[];
  fromStorage: boolean;
}>;

/**
 * What Memory detail edits. A link's text is its Preserved copy, never
 * edited (body stays empty, so it is never sent), and its title starts as
 * the page's own.
 */
export const textOf = (memory: Memory): Draft =>
  memory.kind === "link" || memory.kind === "video"
    ? {
        title: memory.title ?? memory.pageTitle ?? "",
        body: "",
        captureNote: memory.captureNote ?? "",
      }
    : {
        title: memory.title ?? "",
        body: memory.body ?? "",
        captureNote: memory.captureNote ?? "",
      };

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

const withoutSaved = (list: Draft[] | undefined, memory: Memory) => {
  const kept = list?.filter((d) => !saved(memory, d));
  return kept?.length ? kept : undefined;
};

/**
 * Stored text this snapshot does not already have. An older snapshot never
 * drops fields or refused written on a newer revision.
 */
const leftUnsaved = (
  kept: StoredEdit,
  memory: Memory
): Pick<StoredEdit, "fields" | "refused"> | undefined => {
  if (kept.baseRevision > memory.revision) {
    return { fields: kept.fields, refused: kept.refused };
  }
  const fields =
    kept.fields && !saved(memory, kept.fields) ? kept.fields : undefined;
  const refused = withoutSaved(kept.refused, memory);
  if (!fields && !refused) return undefined;
  return { fields, refused };
};

const withText = (memory: Memory, fields: Draft): Memory => ({
  ...memory,
  title: fields.title.trim() || null,
  body: fields.body.trim() ? fields.body.trim() : memory.body,
  captureNote: fields.captureNote.trim() || null,
});

/** The wall's order: last saved first (a duplicate Capture moves a Memory up). */
export const newestFirst = (a: Memory, b: Memory) =>
  b.lastSavedAt.localeCompare(a.lastSavedAt) || b.id.localeCompare(a.id);

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
  freeUpSpace,
  bulkOutbox,
}: {
  setMemories: Dispatch<SetStateAction<WallMemory[]>>;
  transport: Transport;
  drafts: DraftStore;
  bulkOutbox?: BulkOutbox;
  notify: typeof toast;
  onSaved: () => void;
  /** The server accepted a new Memory. Kind only, for the product event. */
  onCaptured?: (kind: "text" | "image" | "link" | "pdf") => void;
  /** Where to free storage, offered when a file does not fit (see imageCapture). */
  freeUpSpace?: () => void;
}) {
  /** Memories in a bulk change, from its Undo window to its answer. */
  const bulkIds = new Set<string>();
  /** The bulk-deleted ones, kept off the wall until the server has answered. */
  const bulkRemoved = new Set<string>();
  /** Bulk changes waiting out their Undo window: send it now. */
  const pendingBulks = new Set<(closing?: boolean) => void>();
  /** Deletes waiting out their Undo window: id → send it now. */
  const pendingDeletes = new Map<string, () => void>();
  /** The tail of each Memory's queue of requests. */
  const queues = new Map<string, Promise<unknown>>();
  const pending = new Map<string, PendingEdit>();
  /** The server's copy, as last seen, per Memory with a pending edit. */
  const serverCopy = new Map<string, Memory>();
  const watchers = new Map<string, Set<(edit?: PendingEdit) => void>>();
  /** Bumped on delete, Undo, Restore and edit, so a late GET cannot clobber. */
  const generation = new Map<string, number>();

  /** Tags drafts this live page writes; a new load only ever offers them. */
  const page = drafts.page;

  const bump = (id: string) =>
    generation.set(id, (generation.get(id) ?? 0) + 1);

  /** The only way a pending edit changes: kept as a draft, and watchers told. */
  function setPending(
    id: string,
    edit: PendingEdit | undefined,
    opts: { sent?: Draft; dropStorage?: boolean; take?: boolean } = {}
  ) {
    if (edit && (edit.fields || edit.refused?.length)) {
      pending.set(id, edit);
      // An offer from storage belongs to the page that wrote it; leave it
      // unless this page is now typing or restoring (take).
      if (!edit.fromStorage) {
        const kept = drafts.read(id);
        if (opts.take || !kept || kept.page === page) {
          drafts.keep(id, {
            fields: edit.fields,
            baseRevision: edit.baseRevision,
            refused: edit.refused,
            page,
          });
        }
      }
    } else {
      edit = undefined;
      pending.delete(id);
      serverCopy.delete(id);
      if (opts.dropStorage) {
        drafts.discard(id);
      } else {
        const kept = drafts.read(id);
        if (
          kept?.page === page &&
          (!opts.sent || !kept.fields || sameText(kept.fields, opts.sent))
        ) {
          drafts.discard(id);
        }
      }
    }
    for (const watch of watchers.get(id) ?? []) watch(edit);
  }

  /**
   * Drop every stored version whose text the server already has, whichever
   * page owns the record. Unmatched text, including the owner's own unsaved
   * fields, stays. An empty record is removed. A delayed older response
   * must not drop fields or refused written on a newer revision.
   */
  function pruneStored(id: string, memory: Memory) {
    const kept = drafts.read(id);
    if (!kept) return;
    const remaining = leftUnsaved(kept, memory);
    if (!remaining) {
      drafts.discard(id);
      return;
    }
    drafts.keep(id, {
      ...remaining,
      baseRevision: kept.baseRevision,
      page: kept.page,
    });
  }

  /** Drop refused versions the server already stores, in memory and in storage. */
  function dropRefusedOnServer(id: string, memory: Memory) {
    pruneStored(id, memory);
    const now = pending.get(id);
    if (!now?.refused?.length) return;
    const refused = withoutSaved(now.refused, memory);
    if ((refused?.length ?? 0) === now.refused.length) return;
    setPending(id, { ...now, refused });
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
  /** Add or replace the wall snapshot for this Memory. */
  const putLocal = (memory: Memory) =>
    setMemories((all) =>
      all.some((m) => m.id === memory.id)
        ? all.map((m) => (m.id === memory.id ? memory : m))
        : [...all, memory].sort(newestFirst)
    );

  /** Captures pasted text, or a link when the paste is exactly one URL. */
  function capture(
    text: string,
    captureNote?: string,
    shared?: { id: string; end: (outcome: CaptureOutcome) => void }
  ): boolean {
    const body = text.trim();
    if (!body) {
      notify("Paste Text to Capture");
      return false;
    }
    if (body.length > FREE_ALLOWANCE.textMaxChars) {
      notify("Too Long to Capture");
      return false;
    }
    const url = linkFromPaste(body);
    const now = new Date().toISOString();
    send(
      {
        id: shared?.id ?? crypto.randomUUID(),
        kind: url ? "link" : "text",
        title: null,
        body: url ? null : body,
        sourceUrl: url ?? null,
        pageTitle: null,
        description: null,
        pages: null,
        captureNote: captureNote?.trim() || null,
        // A link keeps nothing until gathering does.
        preservation: url ? "reference_only" : "preserved",
        indexState: "indexing",
        indexError: null,
        indexTitle: null,
        sample: false,
        aiOptOut: false,
        hasVectors: false,
        deepFetch: null,
        categories: ["Other"],
        categoriesLocked: false,
        categoriesVersion: null,
        revision: 1,
        capturedAt: now,
        lastSavedAt: now,
        updatedAt: now,
        image: null,
        fresh: true,
      },
      shared?.end
    );
    return true;
  }

  /**
   * Captures what the share target held: the same as a paste, but under the
   * share's own id, ending when the server has it (or Capture refused it, or
   * Undo took it back). A failed request stays open for Try Again.
   */
  function captureShared(text: string, id: string): Promise<CaptureOutcome> {
    return new Promise((resolve) => {
      if (!capture(text, undefined, { id, end: resolve })) resolve("refused");
    });
  }

  const images = imageCapture({
    setMemories,
    transport,
    notify,
    onSaved,
    onCaptured: (kind) => onCaptured?.(kind),
    inOrder,
    freeUpSpace,
  });

  /** Deletes Memories now, no Undo window; Try Again resends the deletes. */
  function removeNow(ids: string[]) {
    for (const id of ids) {
      bump(id);
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

  /** Captures image and PDF files: each lands and uploads on its own; Undo takes the batch back. */
  async function captureFiles(files: File[]) {
    await landFiles(files);
  }

  async function landFiles(files: File[], ids?: string[]) {
    const landed = await images.capture(files, ids);
    if (!landed.length) return landed;
    notify("Captured", {
      duration: UNDO_MS,
      action: { label: "Undo", onClick: () => removeNow(landed) },
    });
    return landed;
  }

  /** Image and PDF files the share target held, each under its own id; see captureShared. */
  async function captureSharedFiles(
    held: { id: string; file: File }[]
  ): Promise<CaptureOutcome[]> {
    await landFiles(
      held.map(({ file }) => file),
      held.map(({ id }) => id)
    );
    // A file that never landed was refused up front, and said so.
    return Promise.all(
      held.map(({ id }) => images.outcome(id) ?? ("refused" as const))
    );
  }

  /** Puts `memory` on the wall and sends it; Try Again resends the same one (same id). */
  function send(memory: WallMemory, end?: (outcome: CaptureOutcome) => void) {
    setMemories((all) =>
      all.some((m) => m.id === memory.id) ? all : [memory, ...all]
    );
    const created = inOrder(memory.id, () =>
      memory.kind === "link" || memory.kind === "video"
        ? transport.createLink({
            id: memory.id,
            url: memory.sourceUrl ?? "",
            captureNote: memory.captureNote,
            productAnalytics: captureProductAnalytics(),
          })
        : transport.create({
            id: memory.id,
            body: memory.body ?? "",
            captureNote: memory.captureNote,
            productAnalytics: captureProductAnalytics(),
          })
    );

    const undo = () => {
      end?.("dropped");
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
        end?.("stored");
        onSaved();
        if (
          (memory.kind === "link" || memory.kind === "video") &&
          saved.id !== memory.id
        ) {
          return resurface(memory.id, saved, toastId);
        }
        // The server's copy (its Capture time) replaces the optimistic one,
        // unless Undo already took it off the wall.
        onCaptured?.(
          memory.kind === "link" || memory.kind === "video" ? "link" : "text"
        );
        if (!pending.has(saved.id)) replaceLocal(saved);
      },
      () => {
        removeLocal(memory.id);
        notify("Capture Did Not Finish", {
          id: toastId,
          duration: 8000,
          action: { label: "Try Again", onClick: () => send(memory, end) },
        });
      }
    );
  }

  /**
   * The page was already in the Library: the optimistic Memory goes, the
   * one saved before moves to the top (keeping any edit in progress), and
   * the Capture's toast says so, without Undo (nothing new was made).
   */
  function resurface(sent: string, saved: Memory, toastId: string | number) {
    const lastSavedAt = saved.lastSavedAt;
    setMemories((all) => {
      const kept = all.filter((m) => m.id !== sent && m.id !== saved.id);
      const before = all.find((m) => m.id === saved.id);
      const now =
        before && pending.has(saved.id) ? { ...before, lastSavedAt } : saved;
      return [...kept, now].sort(newestFirst);
    });
    notify("Already in Your Library", {
      id: toastId,
      duration: 4000,
      action: undefined,
    });
  }

  /**
   * The person typed: their text becomes the pending edit (latest wins).
   * Typing over the server's copy is a new edit on the server's revision;
   * a refused edit stays on offer beside it.
   */
  function editText(memory: Memory, fields: Draft) {
    const id = memory.id;
    bump(id);
    const now = pending.get(id);
    const base = serverCopy.get(id) ?? memory;
    if (!serverCopy.has(id)) serverCopy.set(id, base);
    setPending(
      id,
      {
        fields,
        baseRevision:
          !now || now.status === "idle" ? base.revision : now.baseRevision,
        status: now?.status === "sending" ? "sending" : "dirty",
        refused: now?.refused,
        fromStorage: false,
      },
      { take: true }
    );
    replaceLocal(withText(base, fields));
  }

  /** Sends the pending edit as it is now. One request at a time per Memory. */
  function saveEdit(id: string, { keepalive = true } = {}) {
    if (pendingDeletes.has(id)) return;
    const edit = pending.get(id);
    if (!edit?.fields || edit.status === "sending" || edit.status === "idle") {
      return;
    }
    const sent = edit.fields;
    // A link's title starts as the page's: it becomes the person's own
    // only once they change it.
    const base = serverCopy.get(id);
    const pageTitle =
      (base?.kind === "link" || base?.kind === "video") &&
      sent.title.trim() === textOf(base).title.trim();
    const json: MemoryEditRequest = {
      ...(!pageTitle && { title: sent.title }),
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
        dropRefusedOnServer(id, latest);
        setPending(id, {
          baseRevision: latest.revision,
          status: "idle",
          refused: withoutSaved(withRefused(now.refused, now.fields), latest),
          fromStorage: false,
        });
        return;
      }
      onSaved();
      serverCopy.set(id, result);
      dropRefusedOnServer(id, result);
      const now = pending.get(id)!;
      const refused = withoutSaved(now.refused, result);
      if (now.fields && sameText(now.fields, sent)) {
        setPending(
          id,
          {
            ...now,
            fields: undefined,
            refused,
            baseRevision: result.revision,
            status: "idle",
          },
          { sent }
        );
        replaceLocal(result);
      } else {
        // Typed during the send: that is next, on the new revision.
        setPending(id, {
          ...now,
          refused,
          baseRevision: result.revision,
          status: "dirty",
        });
        saveEdit(id, { keepalive });
      }
    }, failed);
  }

  /**
   * Restore Your Edit: the newest refused text becomes the edit, on the
   * server's current revision, and is sent. Current typing, if any, swaps
   * into `refused` so it is not dropped; older refused versions stay on
   * offer. Returns the restored text.
   */
  function restoreEdit(id: string): Draft | undefined {
    const edit = pending.get(id);
    const base = serverCopy.get(id);
    if (!edit?.refused?.[0] || !base) return undefined;
    const newest = edit.refused[0];
    bump(id);
    const older = edit.refused.slice(1);
    const displaced =
      edit.fields && !sameText(edit.fields, newest) ? edit.fields : undefined;
    setPending(
      id,
      {
        fields: newest,
        baseRevision:
          edit.status === "sending" ? edit.baseRevision : base.revision,
        status: edit.status === "sending" ? "sending" : "dirty",
        refused: withRefused(older, displaced),
        fromStorage: false,
      },
      { take: true }
    );
    replaceLocal(withText(base, newest));
    saveEdit(id);
    return newest;
  }

  /**
   * What opening `memory` finds from storage: never sent by itself. Text
   * the server already has is dropped; everything else is offered through
   * Restore Your Edit. A delayed older snapshot does not drop a newer record.
   */
  function fromStorage(
    memory: Memory,
    kept: StoredEdit | undefined
  ): PendingEdit | undefined {
    if (!kept) return undefined;
    const remaining = leftUnsaved(kept, memory);
    if (!remaining) return undefined;
    const offered: Draft[] = [];
    if (remaining.fields) offered.push(remaining.fields);
    for (const draft of remaining.refused ?? []) offered.push(draft);
    const refused = withRefused(offered.slice(1), offered[0]);
    if (!refused?.length) return undefined;
    return {
      baseRevision: memory.revision,
      status: "idle",
      refused,
      fromStorage: true,
    };
  }

  /** Memory detail opened: its pending edit, picking up a stored draft. */
  function openEdit(memory: Memory): PendingEdit | undefined {
    const id = memory.id;
    const now = pending.get(id);
    if (now) return now;
    const kept = drafts.read(id);
    if (kept && !leftUnsaved(kept, memory)) {
      drafts.discard(id);
      return undefined;
    }
    const edit = fromStorage(memory, kept);
    if (!edit) return undefined;
    serverCopy.set(id, memory);
    setPending(id, edit);
    return pending.get(id);
  }

  /**
   * Memory detail closed. Unsaved text is sent and stays a draft until saved;
   * an offered draft is left in storage until it is restored and saved, a
   * new typed edit saves, or the server already has the text.
   */
  function closeEdit(id: string) {
    const edit = pending.get(id);
    if (!edit) return;
    if (edit.fromStorage && !edit.fields) {
      pending.delete(id);
      serverCopy.delete(id);
      for (const watch of watchers.get(id) ?? []) watch(undefined);
      return;
    }
    if (!edit.fields) return;
    const kind = serverCopy.get(id)?.kind;
    if (!edit.fields.body.trim() && kind !== "link" && kind !== "video") {
      notify("Text Can't Be Empty");
    }
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
    bump(id);
    removeLocal(id);
    let done = false;
    const send = (keepalive = false) => {
      if (done) return;
      done = true;
      pendingDeletes.delete(id);
      const known = serverCopy.get(id);
      const gen = generation.get(id) ?? 0;
      setPending(id, undefined, { dropStorage: true });
      inOrder(id, () => transport.remove(id, { keepalive })).then(
        onSaved,
        () => {
          let snapshot = known;
          if (known) restoreLocal(known);
          void transport.get(id).then(
            (row) => {
              if ((generation.get(id) ?? 0) !== gen) return;
              if (pendingDeletes.has(id)) return;
              snapshot = row ?? known ?? memory;
              if (row) putLocal(row);
            },
            () => {
              if ((generation.get(id) ?? 0) !== gen) return;
              if (pendingDeletes.has(id)) return;
              snapshot = known ?? memory;
              if (!known) restoreLocal(memory);
            }
          );
          notify("Delete Did Not Finish", {
            action: {
              label: "Try Again",
              onClick: () => remove(snapshot ?? memory),
            },
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
          bump(id);
          const edit = pending.get(id);
          restoreLocal(edit?.fields ? withText(memory, edit.fields) : memory);
          if (edit?.status === "failed")
            setPending(id, { ...edit, status: "dirty" });
          saveEdit(id);
        },
      },
    });
  }

  // One request at a time across all bulk operations, including page-close sends.
  let bulkQueue: Promise<unknown> = Promise.resolve();
  const serialBulk = (change: BulkMemories, closing: boolean) => {
    const task = bulkQueue
      .catch(() => {})
      .then(() =>
        transport.bulk!(change, { keepalive: closing && fitsKeepalive(change) })
      );
    bulkQueue = task;
    return task;
  };

  async function acknowledgeBulk(record: PendingBulk, ids: string[]) {
    const acknowledged = new Set(ids);
    const change = record.change;
    record.remaining = record.remaining.filter((id) => !acknowledged.has(id));
    await bulkOutbox?.put(record);
    if (change.operation === "delete") {
      setMemories((all) => all.filter((m) => !acknowledged.has(m.id)));
      for (const id of ids) setPending(id, undefined, { dropStorage: true });
    } else {
      setMemories((all) =>
        all.map((m) =>
          acknowledged.has(m.id)
            ? { ...m, categories: change.categories, categoriesLocked: true }
            : m
        )
      );
    }
  }

  // Once Undo ends, newer intent supersedes unresolved older intent for these ids.
  // Write the new record first: a crash between writes replays old then new.
  async function supersedeBulks(record: PendingBulk) {
    if (!bulkOutbox) return;
    const ids = new Set(record.change.ids);
    for (const old of await bulkOutbox.list()) {
      if (old.key === record.key || old.readyAt > record.readyAt) continue;
      old.remaining = old.remaining.filter((id) => !ids.has(id));
      if (old.remaining.length) await bulkOutbox.put(old);
      else await bulkOutbox.remove(old.key);
    }
  }

  async function resumeBulks() {
    if (!bulkOutbox || !transport.bulk) return;
    let records: PendingBulk[];
    try {
      records = await bulkOutbox.list();
    } catch {
      notify("Bulk Updates Unavailable");
      return;
    }
    for (const record of records.sort((a, b) => a.readyAt - b.readyAt)) {
      // A reload ends Undo, just like pagehide.
      for (const id of record.remaining) {
        bulkIds.add(id);
        if (record.change.operation === "delete") bulkRemoved.add(id);
      }
      try {
        while (record.remaining.length) {
          const ids = record.remaining.slice(0, BULK_LIMIT);
          await serialBulk({ ...record.change, ids }, false);
          await acknowledgeBulk(record, ids);
          for (const id of ids) bulkIds.delete(id);
        }
        await bulkOutbox.remove(record.key);
        onSaved();
      } catch {
        for (const id of record.remaining) {
          bulkRemoved.delete(id);
          bulkIds.delete(id);
        }
        notify(
          `${record.remaining.length.toLocaleString()} ${record.remaining.length === 1 ? "Memory" : "Memories"} Not Updated`,
          {
            action: {
              label: "Try Again",
              onClick: () => void resumeBulks(),
            },
          }
        );
        // Keep ordering: don't replay a later operation over an unfinished one.
        break;
      }
    }
  }

  /** Same five-second Undo as a single delete. Large selections use bounded requests. */
  function bulk(
    rows: Memory[],
    change:
      | { operation: "delete" }
      | { operation: "categories"; categories: string[] }
  ) {
    rows = rows.filter((m) => !bulkIds.has(m.id));
    if (!rows.length || !transport.bulk) return;
    for (const m of rows) bulkIds.add(m.id);
    const ids = new Set(rows.map((m) => m.id));
    for (const id of ids) bump(id);
    const restore = (snapshots: Memory[]) => {
      if (change.operation === "delete")
        for (const m of snapshots) restoreLocal(m);
      else {
        const before = new Map(snapshots.map((m) => [m.id, m]));
        setMemories((all) =>
          all.map((m) => {
            const old = before.get(m.id);
            return old
              ? {
                  ...m,
                  categories: old.categories,
                  categoriesLocked: old.categoriesLocked,
                }
              : m;
          })
        );
      }
    };
    if (change.operation === "delete")
      for (const id of ids) bulkRemoved.add(id);
    if (change.operation === "delete")
      setMemories((all) => all.filter((m) => !ids.has(m.id)));
    else
      setMemories((all) =>
        all.map((m) =>
          ids.has(m.id)
            ? { ...m, categories: change.categories, categoriesLocked: true }
            : m
        )
      );
    const record: PendingBulk = {
      key: crypto.randomUUID(),
      change: { ...change, ids: [...ids] },
      remaining: [...ids],
      readyAt: Date.now() + UNDO_MS,
    };
    // Start durability during Undo, never for the first time in pagehide.
    const persisted = bulkOutbox?.put(record);
    void persisted?.catch(() => {});
    let done = false;
    const send = (closing = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      pendingBulks.delete(send);
      // Reserve every queue before sending, so edits cannot overtake the batch.
      const previous = [...ids].map(
        (id) => queues.get(id) ?? Promise.resolve()
      );
      const task = Promise.allSettled(previous).then(async () => {
        const failed: Memory[] = [];
        const batches: Memory[][] = [];
        for (let offset = 0; offset < rows.length; offset += BULK_LIMIT)
          batches.push(rows.slice(offset, offset + BULK_LIMIT));
        try {
          await persisted;
          await supersedeBulks(record);
        } catch {
          // Refuse to send without a crash copy when persistent storage failed.
          for (const id of ids) {
            bulkIds.delete(id);
            bulkRemoved.delete(id);
            pendingDeletes.delete(id);
          }
          restore(rows);
          notify("Bulk Update Could Not Be Saved");
          return;
        }
        for (const batch of batches) {
          try {
            await serialBulk(
              { ...change, ids: batch.map((m) => m.id) },
              closing
            );
            await acknowledgeBulk(
              record,
              batch.map((m) => m.id)
            );
          } catch {
            failed.push(...batch);
          }
        }
        if (!record.remaining.length) await bulkOutbox?.remove(record.key);
        for (const id of ids) {
          pendingDeletes.delete(id);
          bulkIds.delete(id);
        }
        onSaved();
        if (failed.length) {
          for (const m of failed) bulkRemoved.delete(m.id);
          restore(failed);
          notify(
            `${failed.length.toLocaleString()} ${failed.length === 1 ? "Memory" : "Memories"} Not Updated`,
            {
              action: {
                label: "Try Again",
                onClick: () => bulk(failed, change),
              },
            }
          );
        }
      });
      for (const id of ids) {
        queues.set(id, task);
        void task.finally(() => {
          if (queues.get(id) === task) queues.delete(id);
        });
      }
    };
    // Hidden rows remain pending through completion, including poll/search merges.
    if (change.operation === "delete")
      for (const id of ids) pendingDeletes.set(id, () => send(true));
    pendingBulks.add(send);
    const timer = setTimeout(() => send(), UNDO_MS);
    notify(change.operation === "delete" ? "Deleted" : "Categories Updated", {
      duration: UNDO_MS,
      onAutoClose: () => send(),
      onDismiss: () => send(),
      action: {
        label: "Undo",
        onClick: () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          pendingBulks.delete(send);
          void persisted
            ?.then(() => bulkOutbox?.remove(record.key))
            .catch(() => {});
          for (const id of ids) {
            pendingDeletes.delete(id);
            bulkIds.delete(id);
            bulkRemoved.delete(id);
            bump(id);
          }
          restore(rows);
          for (const id of ids) saveEdit(id);
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
      (fresh) => {
        if (!fresh) return;
        // Fresh URLs only: whatever the wall knows of its upload stays.
        setMemories((all) =>
          all.map((m) => (m.id === id ? { ...fresh, upload: m.upload } : m))
        );
        dropRefusedOnServer(id, fresh);
      },
      () => {}
    );
  }

  return {
    resumeBulks,
    bulk,
    capture,
    captureShared,
    captureFiles,
    captureSharedFiles,
    retryUpload: images.retry,
    /** A request for this Memory (Capture, Try Again, edit, delete) is still out. */
    isPending: (id: string) => queues.has(id) || bulkIds.has(id),
    isRemoving: (id: string) => pendingDeletes.has(id) || bulkRemoved.has(id),
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
      for (const send of pendingBulks) send(true);
      for (const send of pendingDeletes.values()) send();
      for (const id of pending.keys()) saveEdit(id);
    },
  };
}
