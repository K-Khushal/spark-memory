import type { LinkCapture } from "@spark/core";

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
    save: async (owner: string, capture: LinkCapture): Promise<SavedMemory> =>
      (
        await call("memories/links", owner, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(capture),
        })
      ).json(),
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
