import { clearImportFiles, importFile } from "./import-files";
import { useEffect, useRef, useState } from "react";
import { checkImage } from "@spark/capture";
import { parseImport } from "@spark/capture/import";
import { FREE_ALLOWANCE, IMPORT_LIMITS, type ImportEntry } from "@spark/core";
import { Button, toast } from "@spark/ui";
import { createApiClient } from "@spark/api-client";
import { imageCapture } from "../library/image-capture";
import { importImageTransport } from "../library/use-library";
import type { WallMemory } from "../library/library-actions";

type Job = {
  id: string;
  state: "loading" | "running" | "paused" | "cancelled" | "done";
  total: number;
  loaded: number;
  done: number;
  skipped: number;
  spread: boolean;
  waitingForAllowance?: boolean;
  availableAt: string;
};
type Endpoint = ReturnType<typeof createApiClient>["api"]["imports"];
async function read<T>(request: Promise<Response>): Promise<T> {
  const response = await request;
  if (!response.ok) throw new Error("Import Did Not Finish");
  return response.json() as Promise<T>;
}

/** A large import can cross the request limiter; keep its committed offset while waiting. */
async function sendBatch(
  endpoint: Endpoint,
  id: string,
  offset: number,
  items: ImportEntry[]
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await endpoint[":id"].batch.$post(
      { param: { id }, json: { offset, items } },
      { init: { signal: AbortSignal.timeout(30_000) } }
    );
    if (response.status !== 429) return read(Promise.resolve(response));
    const seconds = Math.min(
      60,
      Math.max(1, Number(response.headers.get("retry-after")) || 60)
    );
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }
  throw new Error("Import Is Busy — Try Again");
}

/** Export bytes stay in the browser; only validated, bounded batches leave it. */
export function ImportSection({ userId }: { userId: string }) {
  const [endpoint] = useState(
    () =>
      createApiClient(window.location.origin, {
        headers: { "x-spark-user": userId },
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            signal: init?.signal ?? AbortSignal.timeout(30_000),
          }),
      }).api.imports
  );
  const [now, setNow] = useState(() => Date.now());
  const [job, setJob] = useState<Job | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [spread, setSpread] = useState(true);
  const [invalid, setInvalid] = useState(0);
  const [images, setImages] = useState<WallMemory[]>([]);
  const exportInput = useRef<HTMLInputElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (job?.state === "done" || job?.state === "cancelled")
      void clearImportFiles(userId, job.id).catch(() =>
        setError("Images Could Not Be Removed From This Device")
      );
  }, [job?.id, job?.state, userId]);
  const [captures] = useState(() => {
    let jobId: string | undefined;
    return {
      ...imageCapture({
        setMemories: setImages,
        transport: importImageTransport(userId, () => jobId),
        notify: toast,
        onSaved: () => {},
        inOrder: (_id, task) => task(),
      }),
      setJobId: (id: string | undefined) => {
        jobId = id;
      },
    };
  });
  useEffect(() => captures.setJobId(job?.id), [captures, job?.id]);
  const day = Math.floor(now / 86_400_000);
  useEffect(() => {
    if (job?.state !== "running") return;
    let stopped = false;
    void (async () => {
      const { ids } = await read<{ ids: string[] }>(
        endpoint[":id"].images.$get({ param: { id: job.id } })
      );
      for (const id of ids) {
        if (stopped) break;
        const file = await importFile(userId, `${job.id}/${id}`);
        if (!file) {
          setError("Open Import On The Original Device");
          continue;
        } // Another device can show progress; originals stay on the choosing device.
        await captures.capture([file], [id]);
        const outcome = await captures.outcome(id);
        if (outcome === "stored")
          await importFile(userId, `${job.id}/${id}`, null);
        else if (outcome === "full") {
          setError("Daily Allowance Or Storage Is Full");
          break;
        } else {
          setError("Image Could Not Be Captured");
          break;
        }
      }
    })().catch(() => !stopped && setError("Images Did Not Finish"));
    return () => {
      stopped = true;
    };
  }, [job?.id, job?.state, day, userId, captures, endpoint]);
  const loadImages = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (files.length > IMPORT_LIMITS.urls)
        throw new Error("Folder Exceeds 10,000 Images");
      if (files.some((file) => checkImage(file, 0)))
        throw new Error("Choose Supported Images Under 25 MB");
      if (
        files.reduce((bytes, file) => bytes + file.size, 0) >
        FREE_ALLOWANCE.storageBytes
      )
        throw new Error("Choose Images Under 1 GB In Total");
      const id = crypto.randomUUID();
      const created = await read<{ job: Job }>(
        endpoint.create.$post({ json: { id, total: files.length, spread } })
      );
      setJob(created.job);
      const items = [];
      for (const file of files) {
        const imageId = crypto.randomUUID();
        await importFile(userId, `${id}/${imageId}`, file);
        items.push({ imageId });
      }
      for (let offset = 0; offset < items.length; offset += IMPORT_LIMITS.batch)
        await sendBatch(
          endpoint,
          id,
          offset,
          items.slice(offset, offset + IMPORT_LIMITS.batch)
        );
      const started = await read<{ job: Job }>(
        endpoint[":id"].action.$post({
          param: { id },
          json: { action: "start" },
        })
      );
      setJob(started.job);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Images Did Not Finish"
      );
    } finally {
      setBusy(false);
    }
  };
  const reload = async () => {
    try {
      const data = await read<{ job: Job | null }>(endpoint.latest.$get());
      setJob(data.job);
      setError(undefined);
    } catch {
      setError("Import Is Unreachable");
    }
  };
  useEffect(() => {
    let live = true;
    const poll = async () => {
      setNow(Date.now());
      try {
        const data = await read<{ job: Job | null }>(endpoint.latest.$get());
        if (live) setJob(data.job);
      } catch {
        if (live) setError("Import Is Unreachable");
      }
    };
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [endpoint]);
  const action = async (action: "start" | "pause" | "resume" | "cancel") => {
    if (!job || busy) return;
    setBusy(true);
    try {
      const data = await read<{ job: Job }>(
        endpoint[":id"].action.$post({
          param: { id: job.id },
          json: { action },
        })
      );
      setJob(data.job);
      if (action === "cancel") {
        images.forEach((image) => captures.cancel(image.id));
        await clearImportFiles(userId, job.id);
      }
      setError(undefined);
    } catch {
      setError("Import Did Not Finish");
    } finally {
      setBusy(false);
    }
  };
  const load = async (file?: File) => {
    if (!file || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (file.size > IMPORT_LIMITS.bytes)
        throw new Error("File Exceeds 10 MB");
      const parsed = parseImport(await file.text());
      setInvalid(parsed.skipped);
      if (!parsed.items.length) throw new Error("No URLs Found");
      // A reload while uploading can re-select the export and replay identical batches.
      const id = job?.state === "loading" ? job.id : crypto.randomUUID();
      const created = await read<{ job: Job }>(
        endpoint.create.$post({
          json: {
            id,
            total: parsed.items.length,
            spread: job?.state === "loading" ? job.spread : spread,
          },
        })
      );
      setJob(created.job);
      for (
        let offset = created.job.loaded;
        offset < parsed.items.length;
        offset += IMPORT_LIMITS.batch
      ) {
        await sendBatch(
          endpoint,
          id,
          offset,
          parsed.items.slice(offset, offset + IMPORT_LIMITS.batch)
        );
        setJob({
          ...created.job,
          loaded: Math.min(parsed.items.length, offset + IMPORT_LIMITS.batch),
        });
      }
      const started = await read<{ job: Job }>(
        endpoint[":id"].action.$post({
          param: { id },
          json: { action: "start" },
        })
      );
      setJob(started.job);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Import Did Not Finish"
      );
    } finally {
      setBusy(false);
      if (exportInput.current) exportInput.current.value = "";
    }
  };
  const active = job && !["done", "cancelled"].includes(job.state);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || (!!active && job.state !== "loading")}
          onClick={() => exportInput.current?.click()}
        >
          Import URLs
        </Button>
        <Button
          variant="outline"
          disabled={busy || !!active}
          onClick={() => filesInput.current?.click()}
        >
          Choose Images
        </Button>
        <Button
          variant="outline"
          disabled={busy || !!active}
          onClick={() => folderInput.current?.click()}
        >
          Choose Folder
        </Button>
      </div>
      <input
        ref={exportInput}
        hidden
        aria-label="Import File"
        type="file"
        accept=".html,.htm,.csv,.txt"
        onChange={(e) => void load(e.target.files?.[0])}
      />
      <input
        ref={filesInput}
        hidden
        aria-label="Image Files"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          void loadImages([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        hidden
        aria-label="Image Folder"
        type="file"
        accept="image/*"
        multiple
        {...{ webkitdirectory: "" }}
        onChange={(e) => {
          void loadImages(
            [...(e.target.files ?? [])].filter((f) =>
              f.type.startsWith("image/")
            )
          );
          e.target.value = "";
        }}
      />
      {!active && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-ink"
            checked={!spread}
            onChange={(e) => setSpread(!e.target.checked)}
          />
          Import All Today
        </label>
      )}
      <div className="flex flex-col gap-2 text-sm tabular-nums">
        {job && (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span aria-live="polite">
                {
                  {
                    loading: "Uploading",
                    running: job.waitingForAllowance
                      ? "Waiting For Daily Allowance"
                      : "Importing",
                    paused: "Paused",
                    cancelled: "Cancelled",
                    done: "Complete",
                  }[job.state]
                }
              </span>
              <span>
                {job.done.toLocaleString()} Done /{" "}
                {job.skipped.toLocaleString()} Skipped /{" "}
                {job.total.toLocaleString()} Total
              </span>
            </div>
            <progress
              aria-label="Import Progress"
              className="h-2 w-full appearance-none [&::-webkit-progress-bar]:bg-sunken [&::-webkit-progress-value]:bg-ink [&::-moz-progress-bar]:bg-ink"
              max={job.total}
              value={
                job.state === "loading" ? job.loaded : job.done + job.skipped
              }
            />
            {active && (
              <div className="flex flex-wrap gap-2">
                {job.state === "running" && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void action("pause")}
                  >
                    Pause Import
                  </Button>
                )}
                {job.state === "paused" && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void action("resume")}
                  >
                    Resume Import
                  </Button>
                )}
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => void action("cancel")}
                >
                  Cancel Import
                </Button>
              </div>
            )}
          </>
        )}
        {invalid > 0 && (
          <span>{invalid.toLocaleString()} Unsupported URLs</span>
        )}
        {images.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span>
              {images.filter((m) => !m.upload).length} / {images.length} Images
            </span>
            {images.some((m) => m.upload?.step === "failed") && (
              <Button
                variant="outline"
                onClick={() => images.forEach((m) => captures.retry(m.id))}
              >
                Retry Images
              </Button>
            )}
          </div>
        )}
        {error && (
          <div className="flex flex-wrap items-center gap-2">
            <span role="alert">{error}</span>
            <Button variant="outline" onClick={() => void reload()}>
              Try Again
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
