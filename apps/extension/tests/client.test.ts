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

it("uploads a reel's copy without credentials, frame by frame, then confirms it", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        uploads: [
          {
            role: "video",
            page: 0,
            url: "https://files.test/v",
            headers: { a: "1" },
          },
          { role: "frame", page: 0, url: "https://files.test/f0", headers: {} },
          { role: "frame", page: 1, url: "https://files.test/f1", headers: {} },
        ],
      })
    )
    .mockResolvedValue(new Response(null));
  const data = (text: string, type: string) =>
    `data:${type};base64,${btoa(text)}`;
  const result = await captureClient("https://spark.test", request).copy(
    "ana",
    "m1",
    {
      ok: true,
      video: data("VIDEO", "video/mp4"),
      bytes: 5,
      duration: 30,
      frames: [
        {
          seconds: 5,
          data: data("F0", "image/jpeg"),
          bytes: 2,
          width: 540,
          height: 960,
        },
        {
          seconds: 20,
          data: data("F1", "image/jpeg"),
          bytes: 2,
          width: 540,
          height: 960,
        },
      ],
    }
  );
  expect(result).toBe("stored");
  const [describe, ...rest] = request.mock.calls;
  expect(describe![0]).toBe("https://spark.test/api/memories/m1/copy");
  // The description carries sizes and moments, never the bytes.
  expect(JSON.parse(describe![1].body)).toEqual({
    bytes: 5,
    duration: 30,
    frames: [
      { seconds: 5, bytes: 2, width: 540, height: 960 },
      { seconds: 20, bytes: 2, width: 540, height: 960 },
    ],
  });
  const puts = rest.slice(0, 3);
  expect(puts.map(([url]) => url)).toEqual([
    "https://files.test/v",
    "https://files.test/f0",
    "https://files.test/f1",
  ]);
  expect(puts.every(([, init]) => init.credentials === "omit")).toBe(true);
  expect(new TextDecoder().decode(puts[2]![1].body)).toBe("F1");
  expect(rest[3]![0]).toBe("https://spark.test/api/memories/m1/copy/stored");
});

it("sends nothing when Spark already has the reel's transcript, and refuses a failed upload", async () => {
  const read = {
    ok: true as const,
    video: "data:video/mp4;base64,AA==",
    bytes: 1,
    duration: 3,
    frames: [
      {
        seconds: 1,
        data: "data:image/jpeg;base64,AA==",
        bytes: 1,
        width: 1,
        height: 1,
      },
    ],
  };
  const again = vi
    .fn()
    .mockResolvedValue(Response.json({ ok: true, already: true }));
  expect(
    await captureClient("https://spark.test", again).copy("ana", "m1", read)
  ).toBe("already");
  expect(again).toHaveBeenCalledTimes(1);
  const broken = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        uploads: [
          { role: "video", page: 0, url: "https://files.test/v", headers: {} },
        ],
      })
    )
    .mockResolvedValue(new Response(null, { status: 403 }));
  await expect(
    captureClient("https://spark.test", broken).copy("ana", "m1", read)
  ).rejects.toThrow();
  // The copy is never confirmed after a failed PUT.
  expect(broken).toHaveBeenCalledTimes(2);
});

it("asks whether Spark would use a reel's copy before anything is downloaded", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ wanted: true }))
    .mockResolvedValueOnce(Response.json({ wanted: false }))
    .mockResolvedValueOnce(Response.json({}));
  const client = captureClient("https://spark.test", request);
  expect(await client.copyWanted("ana", "m1")).toBe(true);
  expect(await client.copyWanted("ana", "m1")).toBe(false);
  expect(await client.copyWanted("ana", "m1")).toBe(false);
  expect(request.mock.calls[0]![0]).toBe(
    "https://spark.test/api/memories/m1/copy"
  );
  expect(request.mock.calls[0]![1].credentials).toBe("include");
});

it("keeps the captured title for the popup", async () => {
  const request = vi
    .fn()
    .mockResolvedValue(Response.json({ id: "memory", title: "Growing Basil" }));
  const memory = await captureClient("https://spark.test", request).save(
    "ana",
    { id: crypto.randomUUID(), url: "https://garden.test" }
  );
  expect(memory.title).toBe("Growing Basil");
});
