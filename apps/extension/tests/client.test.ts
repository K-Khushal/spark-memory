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

it("uploads image bytes with signed generation headers before confirming storage", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        memory: { id: "image" },
        uploads: [
          {
            role: "original",
            url: "https://files.test/put",
            headers: { "x-amz-meta-generation": "2" },
          },
        ],
      })
    )
    .mockResolvedValueOnce(new Response(null))
    .mockResolvedValueOnce(Response.json({ id: "image", revision: 1 }));
  const { ImageCapture } = await import("@spark/core");
  const capture = ImageCapture.parse({
    id: crypto.randomUUID(),
    mime: "image/png",
    bytes: 3,
    width: 1,
    height: 1,
    contentHash: "a".repeat(64),
    thumbhash: "AAAA",
    thumbnail: { mime: "image/webp", bytes: 3 },
  });
  const result = await captureClient("https://spark.test", request).save(
    "ana",
    capture,
    {
      original: "data:image/png;base64,YWJj",
      thumbnail: "data:image/webp;base64,YWJj",
    }
  );
  expect(result.id).toBe("image");
  expect(request.mock.calls[1]).toMatchObject([
    "https://files.test/put",
    {
      credentials: "omit",
      headers: { "x-amz-meta-generation": "2" },
      body: new Uint8Array([97, 98, 99]),
    },
  ]);
  expect(request.mock.calls[2]![0]).toBe(
    "https://spark.test/api/memories/image/stored"
  );
});
