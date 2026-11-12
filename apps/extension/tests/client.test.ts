import { expect, it, vi } from "vitest";
import { captureClient, ApiError } from "../lib/client";
it("uses only the API, includes cookies and binds requests to the outbox owner", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ id: "memory" }));
  const client = captureClient("https://sparkmemory.xyz", fetch);
  await client.save("ana", {
    id: crypto.randomUUID(),
    url: "https://garden.test",
  });
  expect(fetch).toHaveBeenCalledWith(
    "https://sparkmemory.xyz/api/memories/links",
    expect.objectContaining({
      credentials: "include",
      redirect: "error",
      headers: expect.objectContaining({ "x-spark-user": "ana" }),
    })
  );
});
it("distinguishes expired auth from retryable failures", async () => {
  const client = captureClient(
    "https://sparkmemory.xyz",
    vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
  );
  await expect(client.me()).rejects.toMatchObject({ status: 401 });
  expect(new ApiError(503).retryable).toBe(true);
  expect(new ApiError(403).retryable).toBe(false);
});
