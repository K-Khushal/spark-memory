import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { InferResponseType } from "@spark/api-client";
import { FREE_ALLOWANCE, type MemoryEdit } from "@spark/core";
import { toast } from "@spark/ui";
import { api } from "../api";

const byId = api.api.memories[":id"];

export type Memory = InferResponseType<typeof byId.$get, 200>;
/** A Memory on the wall; `fresh` marks a Capture that has just landed. */
export type WallMemory = Memory & { fresh?: boolean };

const UNDO_MS = 5000;

const newestFirst = (a: Memory, b: Memory) =>
  b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id);

async function ok(request: Promise<Response>) {
  const res = await request;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

/**
 * The signed-in person's Library on the wall. Capture, edit and delete are
 * optimistic: the wall changes first and rolls back with a message if the
 * server says no. Deletes wait out a 5 second Undo, then are permanent; a
 * page that closes inside that window sends them on its way out.
 */
export function useLibrary() {
  const [memories, setMemories] = useState<WallMemory[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  // Stable for the page's life, so dialogs can depend on them.
  const [actions] = useState(() => libraryActions(setMemories));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let after: string | undefined;
      do {
        const res = await ok(
          api.api.memories.$get({ query: after ? { after } : {} })
        );
        const page = await res.json();
        if (cancelled) return;
        setMemories((all) => mergeNewestFirst(all, page.memories));
        setState("ready");
        after = page.next;
      } while (after);
    })().catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const flush = actions.sendPendingDeletes;
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [actions]);

  return {
    memories,
    state,
    retry: () => {
      setState("loading");
      setAttempt((n) => n + 1);
    },
    ...actions,
  };
}

function libraryActions(setMemories: Dispatch<SetStateAction<WallMemory[]>>) {
  /** Deletes waiting out their Undo window: id → send it now. */
  const pendingDeletes = new Map<string, () => void>();
  /** Captures still on their way to the server. */
  const saving = new Map<string, Promise<unknown>>();

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
      toast("Paste Text to Capture");
      return false;
    }
    if (body.length > FREE_ALLOWANCE.textMaxChars) {
      toast("Too Long to Capture");
      return false;
    }
    const now = new Date().toISOString();
    const memory: WallMemory = {
      id: crypto.randomUUID(),
      kind: "text",
      title: null,
      body,
      captureNote: captureNote?.trim() || null,
      preservation: "preserved",
      indexState: "searchable",
      capturedAt: now,
      updatedAt: now,
      fresh: true,
    };
    setMemories((all) => [memory, ...all]);
    const request = ok(
      api.api.memories.$post({
        json: { id: memory.id, body, captureNote: memory.captureNote },
      })
    );
    saving.set(memory.id, request);
    const toastId = toast("Captured", {
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          removeLocal(memory.id);
          // Delete once the Capture has landed; nothing to do if it never did.
          void request
            .then(() => ok(byId.$delete({ param: { id: memory.id } })))
            .catch(() => {});
        },
      },
    });
    request
      .then(async (res) => {
        // The server's copy (its Capture time) replaces the optimistic one,
        // unless Undo already took it off the wall.
        const saved = (await res.json()) as Memory;
        setMemories((all) => all.map((m) => (m.id === saved.id ? saved : m)));
      })
      .catch(() => {
        removeLocal(memory.id);
        toast("Capture Did Not Finish", {
          id: toastId,
          duration: 8000,
          action: {
            label: "Try Again",
            onClick: () => capture(body, captureNote),
          },
        });
      })
      .finally(() => saving.delete(memory.id));
    return true;
  }

  async function edit(before: Memory, changes: MemoryEdit) {
    replaceLocal({
      ...before,
      ...changes,
      title: changes.title === undefined ? before.title : changes.title || null,
      captureNote:
        changes.captureNote === undefined
          ? before.captureNote
          : changes.captureNote || null,
    });
    try {
      await saving.get(before.id);
      const res = await ok(
        byId.$patch(
          { param: { id: before.id }, json: changes },
          // Survives the page closing (detail saves on pagehide), within
          // keepalive's 64 KB body limit.
          { init: { keepalive: JSON.stringify(changes).length < 60_000 } }
        )
      );
      replaceLocal(await res.json());
    } catch {
      replaceLocal(before);
      toast("Changes Did Not Save", {
        action: {
          label: "Try Again",
          onClick: () => void edit(before, changes),
        },
      });
    }
  }

  function remove(memory: Memory) {
    removeLocal(memory.id);
    let done = false;
    const send = (keepalive = false) => {
      if (done) return;
      done = true;
      pendingDeletes.delete(memory.id);
      void (saving.get(memory.id) ?? Promise.resolve())
        .then(() =>
          ok(
            byId.$delete({ param: { id: memory.id } }, { init: { keepalive } })
          )
        )
        .catch(() => {
          restoreLocal(memory);
          toast("Delete Did Not Finish");
        });
    };
    pendingDeletes.set(memory.id, () => send(true));
    toast("Deleted", {
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

/** Adds a page from the server; Memories already on the wall (optimistic ones) win. */
function mergeNewestFirst(all: WallMemory[], page: Memory[]) {
  const known = new Set(all.map((m) => m.id));
  return [...all, ...page.filter((m) => !known.has(m.id))].sort(newestFirst);
}
