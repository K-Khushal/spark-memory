import type { LinkCapture, TextCapture, ImageCapture } from "@spark/core";
import { decodeData, type ImageBytes } from "./image";
import type { ReelRead } from "./sites/reel";

export class ApiError extends Error {
  constructor(readonly status: number) {
    super("Capture request failed");
  }
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}
export type SavedMemory = {
  id: string;
  revision: number;
  captureNote: string | null;
  title?: string | null;
};
/** Cookies stay in Chrome's jar; no token ever enters extension storage. */
export function captureClient(origin: string, request: typeof fetch = fetch) {
  async function call(path: string, owner?: string, init: RequestInit = {}) {
    const response = await request(`${origin}/api/${path}`, {
      ...init,
      credentials: "include",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { ...(owner && { "x-spark-user": owner }), ...init.headers },
    });
    if (!response.ok) throw new ApiError(response.status);
    return response;
  }
  return {
    me: async (): Promise<{ id: string }> => (await call("me")).json(),
    save: async (
      owner: string,
      capture: LinkCapture | TextCapture | ImageCapture,
      image?: ImageBytes
    ): Promise<SavedMemory> => {
      const result = await (
        await call(
          "mime" in capture
            ? "memories/images"
            : "body" in capture
              ? "memories"
              : "memories/links",
          owner,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(capture),
          }
        )
      ).json();
      if (!image)
        return {
          ...result,
          title:
            result.title ?? ("pageTitle" in capture ? capture.pageTitle : null),
        };
      for (const upload of result.uploads as {
        role: "original" | "thumbnail";
        url: string;
        headers: Record<string, string>;
      }[]) {
        const response = await request(new URL(upload.url, origin).href, {
          method: "PUT",
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
          headers: upload.headers,
          body: decodeData(image[upload.role]),
        });
        if (!response.ok)
          throw new ApiError(response.status >= 500 ? response.status : 503);
      }
      try {
        return (
          await call(`memories/${result.memory.id}/stored`, owner, {
            method: "POST",
          })
        ).json();
      } catch (error) {
        // Missing/expired storage can recover by obtaining fresh generation URLs.
        if (error instanceof ApiError && error.status === 409)
          throw new ApiError(503);
        throw error;
      }
    },
    /** Whether Spark would use a copy of this reel: asked before anything is downloaded. */
    copyWanted: async (owner: string, id: string): Promise<boolean> =>
      (await (await call(`memories/${id}/copy`, owner)).json()).wanted === true,
    /**
     * A reel's copy for Indexing (ADR-0010): described, then PUT straight to
     * storage without credentials, then confirmed. "already" when Spark has
     * its transcript. The bytes live only in this call, never in storage.
     */
    copy: async (
      owner: string,
      id: string,
      read: Extract<ReelRead, { ok: true }>
    ): Promise<"stored" | "already"> => {
      const reply = await (
        await call(`memories/${id}/copy`, owner, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bytes: read.bytes,
            duration: read.duration,
            frames: read.frames.map(({ seconds, bytes, width, height }) => ({
              seconds,
              bytes,
              width,
              height,
            })),
          }),
        })
      ).json();
      // Already transcribed, or nothing here could read a copy.
      if (!reply.uploads) return "already";
      for (const upload of reply.uploads as {
        role: "video" | "frame";
        page: number;
        url: string;
        headers: Record<string, string>;
      }[]) {
        const data =
          upload.role === "video" ? read.video : read.frames[upload.page]?.data;
        if (!data) throw new ApiError(400);
        const response = await request(new URL(upload.url, origin).href, {
          method: "PUT",
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(60_000),
          headers: upload.headers,
          body: decodeData(data),
        });
        if (!response.ok) throw new ApiError(503);
      }
      await call(`memories/${id}/copy/stored`, owner, { method: "POST" });
      return "stored";
    },
    screenshot: async (owner: string, id: string, data: string) => {
      const bytes = Uint8Array.from(atob(data.split(",")[1]!), (c) =>
        c.charCodeAt(0)
      );
      await call(`memories/${id}/screenshot`, owner, {
        method: "POST",
        headers: { "content-type": "image/jpeg" },
        body: bytes,
      });
    },
    note: async (
      owner: string,
      memory: SavedMemory,
      captureNote: string
    ): Promise<SavedMemory> =>
      (
        await call(`memories/${memory.id}`, owner, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ captureNote, revision: memory.revision }),
        })
      ).json(),
  };
}
