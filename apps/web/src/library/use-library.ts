import { useEffect, useState } from "react";
import { toast } from "@spark/ui";
import { api } from "../api";
import { drafts } from "./drafts";
import { Refused, type Upload } from "./image-capture";
import {
  libraryActions,
  newestFirst,
  type Memory,
  type Transport,
  type WallMemory,
} from "./library-actions";

export type { Memory, WallMemory } from "./library-actions";

const byId = api.api.memories[":id"];

async function ok(request: Promise<Response>) {
  const res = await request;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

/** The Memory API, as the Library actions need it. */
const transport: Transport = {
  create: async (json) =>
    (await (await ok(api.api.memories.$post({ json }))).json()) as Memory,
  patch: async (id, json, init) => {
    const res = await byId.$patch({ param: { id }, json }, { init });
    if (res.status === 409) return "stale";
    return (await (await ok(Promise.resolve(res))).json()) as Memory;
  },
  remove: async (id, init) => {
    const res = await byId.$delete({ param: { id } }, { init });
    const status: number = res.status;
    if (status >= 300 && status !== 404) throw new Error(`HTTP ${status}`);
  },
  get: async (id) => {
    const res = await byId.$get({ param: { id } });
    return res.ok ? ((await res.json()) as Memory) : undefined;
  },
  storage: async () => (await ok(api.api.storage.$get())).json(),
  createImage: async (json) => {
    const res = await api.api.memories.images.$post({ json });
    const status: number = res.status;
    if (status === 413) {
      const { error } = (await res.json()) as { error: string };
      if (error === "file_too_large" || error === "storage_full") {
        throw new Refused(error);
      }
    }
    // The server refused what was sent: the same request would fail again.
    if (status === 400 || status === 413) throw new Refused("invalid");
    return (await (await ok(Promise.resolve(res))).json()) as {
      memory: Memory;
      uploads: Upload[];
    };
  },
  preload: (url) =>
    new Promise((done) => {
      const image = new Image();
      image.onload = image.onerror = () => done();
      image.src = url;
    }),
  put: (upload, body, onProgress, signal) =>
    putFile(upload, body, onProgress, signal),
  confirm: async (id) =>
    (await (await ok(byId.stored.$post({ param: { id } }))).json()) as Memory,
};

/** PUTs a file to its presigned URL; XHR, because fetch cannot report upload progress. */
function putFile(
  { url, headers }: Upload,
  body: Blob,
  onProgress: (sent: number) => void,
  signal: AbortSignal
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`HTTP ${xhr.status}`));
    xhr.onerror = xhr.onabort = () => reject(new Error("upload stopped"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/**
 * The signed-in person's Library on the wall, with optimistic Capture, edit
 * and delete (library-actions.ts). Deletes wait out a 5 second Undo, then are
 * permanent; a page that closes inside that window sends them on its way
 * out. `version` goes up whenever the server accepts a change.
 */
export function useLibrary() {
  const [memories, setMemories] = useState<WallMemory[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [version, setVersion] = useState(0);
  // Stable for the page's life, so dialogs can depend on them.
  const [actions] = useState(() =>
    libraryActions({
      setMemories,
      transport,
      drafts,
      notify: toast,
      onSaved: () => setVersion((n) => n + 1),
    })
  );

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
        // Uploads an earlier page left unfinished show as Failed, to delete.
        const unfinished: Memory[] = page.unfinished ?? [];
        const stranded = unfinished.map((m): WallMemory => ({
          ...m,
          upload: { step: "stranded" },
        }));
        setMemories((all) =>
          mergeNewestFirst(all, [...page.memories, ...stranded])
        );
        setState("ready");
        after = page.next;
      } while (after);
    })().catch(() => !cancelled && setState("failed"));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    const flush = actions.sendPending;
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [actions]);

  return {
    memories,
    state,
    version,
    retry: () => {
      setState("loading");
      setAttempt((n) => n + 1);
    },
    ...actions,
    /** The same functions as one stable object, for effects that depend on it. */
    edits: actions,
  };
}

/** Adds a page from the server; Memories already on the wall (optimistic ones) win. */
function mergeNewestFirst(all: WallMemory[], page: WallMemory[]) {
  const known = new Set(all.map((m) => m.id));
  return [...all, ...page.filter((m) => !known.has(m.id))].sort(newestFirst);
}
