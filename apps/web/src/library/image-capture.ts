import type { Dispatch, SetStateAction } from "react";
import {
  checkImage,
  prepareImage,
  type ImageRefusal,
  type PreparedImage,
} from "@spark/capture";
import type { ImageCapture } from "@spark/core";
import type { toast } from "@spark/ui";
import { captureProductAnalytics } from "../product-analytics";
import type { Memory, WallMemory } from "./library-actions";

/** A presigned upload: PUT the file's bytes to `url` with exactly `headers`. */
export type Upload = {
  role: "original" | "thumbnail";
  url: string;
  headers: Record<string, string>;
};

/** The server refused the Capture for a reason a retry cannot fix. */
export class Refused extends Error {
  constructor(readonly reason: "file_too_large" | "storage_full" | "invalid") {
    super(reason);
  }
}

/** What image Capture needs from the server. Each call rejects when it fails. */
export type ImageTransport = {
  storage: () => Promise<{ usedBytes: number }>;
  /** Creates the Memory (idempotent by id); rejects with Refused over the Free allowance. */
  createImage: (
    input: ImageCapture
  ) => Promise<{ memory: Memory; uploads: Upload[] }>;
  put: (
    upload: Upload,
    body: Blob,
    onProgress: (sentBytes: number) => void,
    signal: AbortSignal
  ) => Promise<void>;
  /** Asks the server to check the files and show the Memory. */
  confirm: (id: string) => Promise<Memory>;
  /** Resolves once the browser has `url` (an image) loaded, or failed to. */
  preload: (url: string) => Promise<void>;
};

/** An image upload as the wall shows it. Stored images have none. */
export type UploadState =
  | { step: "sending"; progress: number }
  | { step: "failed" }
  /** Its upload stopped on an earlier page (a reload): the file is gone, only Delete helps. */
  | { step: "stranded" };

/**
 * One state machine per image Memory, from Capture until its files are
 * stored. A run is one attempt: create (or find) the Memory, PUT each file
 * the server still lacks, then confirm. Every await checks the run is still
 * the Memory's current one, so a cancelled or superseded run never touches
 * the wall. Try Again starts a new run with the same id; the server answers
 * it idempotently. Runs go through `inOrder`, the Memory's request queue,
 * so a delete always waits for the run before it.
 */
export function imageCapture({
  setMemories,
  transport,
  notify,
  onSaved,
  onCaptured,
  inOrder,
}: {
  setMemories: Dispatch<SetStateAction<WallMemory[]>>;
  transport: ImageTransport;
  notify: typeof toast;
  onSaved: () => void;
  onCaptured?: () => void;
  inOrder: <T>(id: string, task: () => Promise<T>) => Promise<T>;
}) {
  type Entry = {
    prepared: PreparedImage;
    /** Object URLs of the local files, shown until the page closes. */
    urls: { url: string; thumbnailUrl: string };
    run: number;
    abort?: AbortController;
    failed: boolean;
  };
  const entries = new Map<string, Entry>();
  /** Bytes being Captured now, counted against storage before the server knows. */
  const reserved = () =>
    [...entries.values()].reduce(
      (n, e) => n + e.prepared.file.size + e.prepared.thumbnail.size,
      0
    );

  const show = (id: string, upload: UploadState | undefined) =>
    setMemories((all) => all.map((m) => (m.id === id ? { ...m, upload } : m)));
  const removeLocal = (id: string) =>
    setMemories((all) => all.filter((m) => m.id !== id));

  function start(id: string) {
    const entry = entries.get(id)!;
    const run = ++entry.run;
    entry.failed = false;
    entry.abort?.abort(); // nothing of an earlier run may still be sending
    entry.abort = new AbortController();
    show(id, { step: "sending", progress: 0 });
    void inOrder(id, () => send(id, run, entry));
  }

  async function send(id: string, run: number, entry: Entry) {
    const current = () => entries.get(id) === entry && entry.run === run;
    if (!current()) return;
    const { prepared } = entry;
    try {
      const { uploads } = await transport.createImage({
        id,
        mime: prepared.mime,
        bytes: prepared.file.size,
        width: prepared.width,
        height: prepared.height,
        contentHash: prepared.contentHash,
        thumbhash: prepared.thumbhash,
        palette: prepared.palette,
        thumbnail: {
          mime: prepared.thumbnailMime,
          bytes: prepared.thumbnail.size,
        },
        productAnalytics: captureProductAnalytics(),
      });
      if (!current()) return;
      const body = (u: Upload) =>
        u.role === "original" ? prepared.file : prepared.thumbnail;
      const total = uploads.reduce((n, u) => n + body(u).size, 0);
      const sent = new Map<string, number>();
      await Promise.all(
        uploads.map((u) =>
          transport.put(
            u,
            body(u),
            (bytes) => {
              if (!current()) return;
              sent.set(u.role, bytes);
              const done = [...sent.values()].reduce((a, b) => a + b, 0);
              show(id, { step: "sending", progress: done / total });
            },
            entry.abort!.signal
          )
        )
      );
      if (!current()) return;
      const saved = await transport.confirm(id);
      if (!current()) return;
      entries.delete(id);
      // The server's copy, but the local files stay on screen (no reload
      // flash) until the stored thumbnail has loaded; then they are freed.
      const local = (m: WallMemory) =>
        m.id === id && m.image?.thumbnailUrl === entry.urls.thumbnailUrl;
      setMemories((all) =>
        all.map((m) =>
          m.id === id
            ? {
                ...saved,
                image: saved.image && { ...saved.image, ...entry.urls },
              }
            : m
        )
      );
      onSaved();
      onCaptured?.();
      if (saved.image) {
        await transport.preload(saved.image.thumbnailUrl).catch(() => {});
        setMemories((all) =>
          all.map((m) => (local(m) ? { ...m, image: saved.image } : m))
        );
      }
      URL.revokeObjectURL(entry.urls.url);
      URL.revokeObjectURL(entry.urls.thumbnailUrl);
    } catch (error) {
      if (!current()) return;
      // One file failed: stop the other, so no PUT outlives its run.
      entry.abort?.abort();
      if (error instanceof Refused) {
        drop(id);
        refuse(error.reason);
        return;
      }
      entry.failed = true;
      show(id, { step: "failed" });
      // One toast however many fail at once (offline): it retries them all.
      notify("Capture Did Not Finish", {
        id: "upload-failed",
        duration: 8000,
        action: { label: "Try Again", onClick: retryAll },
      });
    }
  }

  function drop(id: string) {
    const entry = entries.get(id);
    if (!entry) return false;
    entries.delete(id);
    entry.abort?.abort();
    removeLocal(id);
    URL.revokeObjectURL(entry.urls.url);
    URL.revokeObjectURL(entry.urls.thumbnailUrl);
    return true;
  }

  function refuse(reason: ImageRefusal | "invalid") {
    notify(REFUSALS[reason], { id: `refused-${reason}` });
  }

  /** Try Again on a failed upload: a new run, same Memory id. */
  function retry(id: string) {
    if (entries.get(id)?.failed) start(id);
  }
  const retryAll = () => {
    for (const id of [...entries.keys()]) retry(id);
  };

  /**
   * Captures `files` as image Memories. Each is checked against the Free
   * allowance first; a refused one never reaches the wall. The rest land as
   * soon as they are decoded, newest first, and upload in the background.
   * Returns the ids that landed, for Undo.
   */
  async function capture(files: File[]): Promise<string[]> {
    const { usedBytes } = await transport
      .storage()
      .catch(() => ({ usedBytes: 0 }));
    let used = usedBytes + reserved();
    const accepted: File[] = [];
    for (const file of files) {
      const refusal = checkImage(file, used);
      if (refusal) refuse(refusal);
      else {
        accepted.push(file);
        used += file.size;
      }
    }
    const ids: string[] = [];
    // Decoding is heavy: two at a time.
    const queue = [...accepted];
    const worker = async () => {
      for (let file = queue.shift(); file; file = queue.shift()) {
        const prepared = await prepareImage(file).catch((reason: unknown) => {
          refuse(reason === "file_too_large" ? reason : "unreadable");
        });
        if (prepared) ids.push(land(prepared));
      }
    };
    await Promise.all([worker(), worker()]);
    return ids;
  }

  function land(prepared: PreparedImage) {
    const id = crypto.randomUUID();
    const urls = {
      url: URL.createObjectURL(prepared.file),
      thumbnailUrl: URL.createObjectURL(prepared.thumbnail),
    };
    entries.set(id, { prepared, urls, run: 0, failed: false });
    const now = new Date().toISOString();
    const memory: WallMemory = {
      id,
      kind: "image",
      title: null,
      body: null,
      captureNote: null,
      preservation: "preserved",
      indexState: "indexing",
      indexError: null,
      indexTitle: null,
      aiOptOut: false,
      hasVectors: false,
      revision: 1,
      capturedAt: now,
      lastSavedAt: now,
      updatedAt: now,
      sourceUrl: null,
      pageTitle: null,
      description: null,
      image: {
        ...urls,
        mime: prepared.mime,
        bytes: prepared.file.size,
        width: prepared.width,
        height: prepared.height,
        thumbhash: prepared.thumbhash,
      },
      fresh: true,
    };
    setMemories((all) => [memory, ...all]);
    start(id);
    return id;
  }

  return {
    capture,
    retry,
    /** Stops an upload and takes its tile away; false when none was running. */
    cancel: drop,
    isUploading: (id: string) => entries.has(id),
  };
}

const REFUSALS: Record<ImageRefusal | "invalid", string> = {
  // The server could not accept what the browser made of it: retrying won't help.
  invalid: "Image Can't Be Captured",
  file_too_large: "Images Over 25 MB Can't Be Captured",
  storage_full: "Your 1 GB Free Allowance Is Full",
  unsupported: "This File Type Can't Be Captured",
  unreadable: "Image Can't Be Read",
};
