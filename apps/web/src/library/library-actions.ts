import type { Dispatch, SetStateAction } from "react";
import type { InferResponseType } from "@spark/api-client";
import {
  FREE_ALLOWANCE,
  type MemoryEdit,
  type MemoryEditRequest,
} from "@spark/core";
import type { toast } from "@spark/ui";
import type { api } from "../api";

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

export type EditOutcome =
  | { status: "saved"; memory: Memory }
  | { status: "stale"; latest?: Memory }
  | { status: "failed" };

export const newestFirst = (a: Memory, b: Memory) =>
  b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id);

/**
 * Capture, edit and delete, optimistic: the wall changes first and rolls back
 * with a message if the server says no. Everything sent for one Memory goes
 * in order (Capture, then each edit, then delete), and each edit carries the
 * revision it was based on, so a late write can never win. `onSaved` runs
 * after each change the server accepted (search looks again).
 */
export function libraryActions({
  setMemories,
  transport,
  notify,
  onSaved,
}: {
  setMemories: Dispatch<SetStateAction<WallMemory[]>>;
  transport: Transport;
  notify: typeof toast;
  onSaved: () => void;
}) {
  /** Deletes waiting out their Undo window: id → send it now. */
  const pendingDeletes = new Map<string, () => void>();
  /** The tail of each Memory's queue of requests. */
  const queues = new Map<string, Promise<unknown>>();
  /** The newest revision the server has confirmed, per Memory. */
  const revisions = new Map<string, number>();
  /** Bumped when an edit is refused as stale: edits queued before it are dropped. */
  const epochs = new Map<string, number>();
  /** How many edits are queued, per Memory: only the last one's answer is shown. */
  const queuedEdits = new Map<string, number>();

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
  const confirmed = (memory: Memory) => {
    revisions.set(memory.id, memory.revision);
    onSaved();
  };

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
        confirmed(saved);
        replaceLocal(saved);
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
   * "saved" once the server has these changes; "stale" when the Memory changed
   * elsewhere (the wall shows the server's copy, `latest`, and nothing is
   * resubmitted: Memory detail lets the person choose); "failed" otherwise.
   */
  async function edit(
    before: Memory,
    changes: MemoryEdit
  ): Promise<EditOutcome> {
    const id = before.id;
    const epoch = epochs.get(id) ?? 0;
    replaceLocal({
      ...before,
      ...changes,
      title: changes.title === undefined ? before.title : changes.title || null,
      captureNote:
        changes.captureNote === undefined
          ? before.captureNote
          : changes.captureNote || null,
    });
    queuedEdits.set(id, (queuedEdits.get(id) ?? 0) + 1);
    const isLast = () => queuedEdits.get(id) === 1;
    try {
      const result = await inOrder(id, () => {
        // Based on text the server has since refused: never send it.
        if ((epochs.get(id) ?? 0) !== epoch)
          return Promise.resolve("stale" as const);
        const json = {
          ...changes,
          revision: revisions.get(id) ?? before.revision,
        };
        return transport.patch(id, json, { keepalive: fitsKeepalive(json) });
      });
      if (result === "stale") {
        // Changed elsewhere: the wall shows what the server has.
        if ((epochs.get(id) ?? 0) === epoch) epochs.set(id, epoch + 1);
        const latest = await transport.get(id).catch(() => undefined);
        if (latest) {
          revisions.set(id, latest.revision);
          replaceLocal(latest);
        }
        return { status: "stale", latest };
      }
      confirmed(result);
      // A newer edit is queued: its optimistic text stays on the wall.
      if (isLast()) replaceLocal(result);
      return { status: "saved", memory: result };
    } catch {
      if (isLast()) {
        const latest = await transport.get(id).catch(() => undefined);
        if (latest) replaceLocal(latest);
      }
      notify("Changes Did Not Save", {
        action: {
          label: "Try Again",
          onClick: () => void edit(before, changes),
        },
      });
      return { status: "failed" };
    } finally {
      queuedEdits.set(id, (queuedEdits.get(id) ?? 1) - 1);
    }
  }

  function remove(memory: Memory) {
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
    edit,
    remove,
    /** For a page on its way out: Undo is no longer possible. */
    sendPendingDeletes: () => {
      for (const send of pendingDeletes.values()) send();
    },
  };
}
