import { createApiClient } from "@spark/api-client";
import type { ImageCapture } from "@spark/core";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "@spark/ui";
import { api } from "../api";
import { track } from "../analytics";
import { drafts } from "./drafts";
import { Refused, type Upload } from "./image-capture";
import {
  indexingActions,
  nextPollDelay,
  POLL,
  type IndexingTransport,
} from "./indexing-actions";
import {
  libraryActions,
  newestFirst,
  type Memory,
  type Transport,
  type WallMemory,
} from "./library-actions";
import { renamedIn, withoutIn } from "./category-wall";
import { libraryVersion } from "./search-session";

export type { Memory, WallMemory } from "./library-actions";

const byId = api.api.memories[":id"];

async function ok(request: Promise<Response>) {
  const res = await request;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

/** A new image or PDF Memory and its uploads; Refused over the Free allowance. */
async function created(request: Promise<Response>) {
  const res = await request;
  const status: number = res.status;
  if (status === 413) {
    const { error } = (await res.json()) as { error: string };
    if (error === "file_too_large" || error === "storage_full") {
      throw new Refused(error);
    }
  }
  // Today's Captures are used up: it is allowed again after midnight UTC.
  if (status === 429) {
    const { error } = (await res.clone().json()) as { error: string };
    if (error === "captures_full") throw new Refused(error);
  }
  // The server refused what was sent: the same request would fail again.
  if (status === 400 || status === 413) throw new Refused("invalid");
  return (await (await ok(Promise.resolve(res))).json()) as {
    memory: Memory;
    uploads: Upload[];
  };
}

/** The Memory API, as the Library actions need it. */
const transport: Transport = {
  create: async (json) =>
    (await (await ok(api.api.memories.$post({ json }))).json()) as Memory,
  createLink: async (json) =>
    (await (await ok(api.api.memories.links.$post({ json }))).json()) as Memory,
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
  createImage: async (json) => created(api.api.memories.images.$post({ json })),
  createPdf: async (json) => created(api.api.memories.pdfs.$post({ json })),
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

/** Bulk image Capture stays bound to the owner who selected the originals. */
export function importImageTransport(
  userId: string,
  jobId: () => string | undefined
) {
  const client = createApiClient(window.location.origin, {
    headers: { "x-spark-user": userId },
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(30_000),
      }),
  });
  return {
    ...transport,
    createImage: (json: ImageCapture) =>
      created(
        client.api.memories.images.$post({
          json: { ...json, background: true, importJobId: jobId() },
        })
      ),
    confirm: async (id: string) =>
      (await (
        await ok(client.api.memories[":id"].stored.$post({ param: { id } }))
      ).json()) as Memory,
  };
}

const indexingTransport: IndexingTransport = {
  poll: async (ids) => {
    const res = await ok(
      api.api.memories.$get({ query: { ids: ids.join(",") } })
    );
    return (await res.json()).memories as Memory[];
  },
  retryIndexing: async (id) =>
    (await (await ok(byId.reindex.$post({ param: { id } }))).json()) as Memory,
  retryDeepFetch: async (id) =>
    (await (
      await ok(byId["deep-fetch"].$post({ param: { id } }))
    ).json()) as Memory,
  setAiOptOut: async (id, on) => {
    const res = byId["ai-opt-out"].$put({
      param: { id },
      json: { aiOptOut: on },
    });
    return (await (await ok(res)).json()) as Memory;
  },
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
    xhr.timeout = 120_000;
    xhr.ontimeout = () => reject(new Error("Upload Timed Out"));
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
  // This mount's own versions (libraryVersion), so the search cache never
  // serves it an answer from an earlier visit.
  const [versionOf] = useState(libraryVersion);
  const [changes, setChanges] = useState(0);
  const version = versionOf(changes);
  const setVersion = setChanges;
  // Stable for the page's life, so dialogs can depend on them.
  const navigate = useNavigate();
  const [actions] = useState(() =>
    libraryActions({
      setMemories,
      transport,
      drafts,
      notify: toast,
      freeUpSpace: () => void navigate({ to: "/settings" }),
      onSaved: () => setVersion((n) => n + 1),
      onCaptured: (kind) =>
        track({ event: "save_success", properties: { kind } }),
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
        // Uploads an earlier page left unfinished, once their PUT has
        // expired, show as Failed, to delete.
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

  const [indexing] = useState(() =>
    indexingActions({
      setMemories,
      transport: indexingTransport,
      notify: toast,
      isPending: actions.isPending,
      onChanged: () => setVersion((n) => n + 1),
    })
  );
  // While anything is Indexing, ask after it: every 2 s, backing off to 30 s
  // while nothing changes, starting over when something does; never while
  // the page is hidden; not at all once nothing is Indexing.
  const pollKey = indexing.pollable(memories).join(",");
  // After every render: anything sent again since starts its misses over.
  useEffect(() => indexing.restartMisses(memories));
  useEffect(() => {
    if (!pollKey) return;
    const ids = pollKey.split(",");
    let delay = POLL.first;
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        await indexing.poll(ids).catch(() => {});
      }
      if (stopped) return;
      delay = nextPollDelay(delay);
      // One timer at a time, even when a tick from coming back overlaps one.
      clearTimeout(timer);
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    // Back on the page: ask at once and start the backoff over.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      delay = POLL.first / POLL.factor;
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollKey, indexing]);

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
    async setCategories(memory: Memory, categories: string[]) {
      try {
        const saved = await transport.patch(
          memory.id,
          { categories, revision: memory.revision },
          { keepalive: false }
        );
        if (saved === "stale") {
          actions.refresh(memory.id);
          return false;
        }
        setMemories((all) =>
          all.map((m) => (m.id === saved.id ? { ...m, ...saved } : m))
        );
        setVersion((n) => n + 1);
        return true;
      } catch {
        return false;
      }
    },
    /** The wall follows a Category the person renamed or deleted, as the server did. */
    categoryRenamed(from: string, to: string) {
      setMemories((all) => renamedIn(all, from, to));
      setVersion((n) => n + 1);
    },
    categoryRemoved(name: string) {
      setMemories((all) => withoutIn(all, name));
      setVersion((n) => n + 1);
    },
    /** Reads the Categories the server chose (a re-categorising ended), touching nothing else. */
    async syncCategories() {
      const fresh = new Map<
        string,
        { categories: string[]; categoriesLocked: boolean }
      >();
      try {
        let after: string | undefined;
        do {
          const res = await ok(
            api.api.memories.$get({ query: after ? { after } : {} })
          );
          const page = await res.json();
          for (const m of page.memories) fresh.set(m.id, m);
          after = page.next;
        } while (after);
      } catch {
        return;
      }
      setMemories((all) =>
        all.map((m) => {
          const now = fresh.get(m.id);
          return now
            ? {
                ...m,
                categories: now.categories,
                categoriesLocked: now.categoriesLocked,
              }
            : m;
        })
      );
      setVersion((n) => n + 1);
    },
    state,
    version,
    retry: () => {
      setState("loading");
      setAttempt((n) => n + 1);
    },
    ...actions,
    /** Refresh Samples without discarding pending Captures or edits. */
    refreshSamples: () => {
      setMemories((all) => all.filter((m) => !m.sample));
      setAttempt((n) => n + 1);
      setVersion((n) => n + 1);
    },
    retryIndexing: indexing.retryIndexing,
    retryDeepFetch: indexing.retryDeepFetch,
    setAiOptOut: indexing.setAiOptOut,
    /** The same functions as one stable object, for effects that depend on it. */
    edits: actions,
  };
}

/** Adds a page from the server; Memories already on the wall (optimistic ones) win. */
function mergeNewestFirst(all: WallMemory[], page: WallMemory[]) {
  const known = new Set(all.map((m) => m.id));
  return [...all, ...page.filter((m) => !known.has(m.id))].sort(newestFirst);
}
