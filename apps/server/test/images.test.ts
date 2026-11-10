import { describe, expect, it } from "vitest";
import { Client } from "pg";
import worker from "../src/index";
import { fileStore } from "../src/files";
import { sweep } from "../src/sweep";
import {
  ctx,
  databaseUrl,
  env,
  fakeTurnstile,
  files,
  newClient,
  ORIGIN,
  signedIn,
} from "./worker";

// Image Capture through the Worker, against real Postgres. Storage is the
// in-memory bucket; uploads go to the local stand-in for R2's presigned URLs.
fakeTurnstile();

type Call = Awaited<ReturnType<typeof signedIn>>["call"];
type Upload = { role: string; url: string; headers: Record<string, string> };
type ImageMemory = {
  id: string;
  kind: string;
  image: { url: string; thumbnailUrl: string; width: number } | null;
};

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const webp = new Uint8Array([82, 73, 70, 70, 9, 9]);

const describe_ = (over: object = {}) => ({
  id: crypto.randomUUID(),
  mime: "image/png",
  bytes: png.byteLength,
  width: 640,
  height: 480,
  contentHash: "ef".repeat(32),
  thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
  thumbnail: { mime: "image/webp", bytes: webp.byteLength },
  ...over,
});

async function create(call: Call, json: object) {
  const res = await call("/api/memories/images", { method: "POST", json });
  return {
    status: res.status,
    cache: res.headers.get("cache-control"),
    body: (await res.json()) as {
      memory: ImageMemory;
      uploads: Upload[];
      error?: string;
    },
  };
}

/** What the browser does with a presigned URL. */
function send(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: Uint8Array }
) {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-length", String(init.body.byteLength));
  return worker.fetch(
    new Request<unknown, IncomingRequestCfProperties>(new URL(url, ORIGIN), {
      method: init.method ?? "GET",
      headers,
      body: init.body,
    }),
    env(),
    ctx
  );
}

async function uploadAll(uploads: Upload[]) {
  for (const u of uploads) {
    const body = u.role === "original" ? png : webp;
    const res = await send(u.url, { method: "PUT", headers: u.headers, body });
    expect(res.status, u.role).toBe(200);
  }
}

const stored = async (call: Call, id: string) => {
  const res = await call(`/api/memories/${id}/stored`, { method: "POST" });
  return { status: res.status, body: (await res.json()) as ImageMemory };
};

describe.skipIf(!databaseUrl)("image Capture", () => {
  it("creates the Memory, uploads straight to storage, checks, shows, serves and deletes it", async () => {
    const { call } = await signedIn();
    const input = describe_();
    const created = await create(call, input);
    expect(created).toMatchObject({
      status: 201,
      cache: "private, no-store",
      body: { memory: { id: input.id, kind: "image" } },
    });
    expect(created.body.uploads.map((u) => u.role)).toEqual([
      "original",
      "thumbnail",
    ]);
    // Not on the wall until its files are stored.
    expect(await (await call("/api/memories")).json()).toEqual({
      memories: [],
    });

    await uploadAll(created.body.uploads);
    const done = await stored(call, input.id);
    expect(done).toMatchObject({
      status: 200,
      body: { id: input.id, image: { width: 640 } },
    });
    const list = (await (await call("/api/memories")).json()) as {
      memories: ImageMemory[];
    };
    expect(list.memories.map((m) => m.id)).toEqual([input.id]);

    const image = await send(list.memories[0]!.image!.url, {});
    expect(image.status).toBe(200);
    expect(image.headers.get("cache-control")).toMatch(/^private/);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);
    // Keys stay on the server: clients only ever see signed URLs.
    expect(JSON.stringify(list)).not.toContain('"key"');

    const keys = [...files.objects.keys()].filter((k) => k.includes(input.id));
    expect(keys).toHaveLength(2);
    const del = await call(`/api/memories/${input.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect(keys.filter((k) => files.objects.has(k))).toEqual([]);
    expect((await call(`/api/memories/${input.id}`)).status).toBe(404);
  });

  it("answers a retried create with fresh URLs for the files still missing", async () => {
    const { call } = await signedIn();
    const input = describe_();
    await create(call, input);
    const retry = await create(call, input);
    expect(retry.status).toBe(200);
    await uploadAll(retry.body.uploads);
    expect((await stored(call, input.id)).status).toBe(200);
    expect(await create(call, input)).toMatchObject({
      status: 200,
      body: { uploads: [] },
    });
  });

  it("refuses to show an image whose upload has not arrived", async () => {
    const { call } = await signedIn();
    const input = describe_();
    await create(call, input);
    expect((await stored(call, input.id)).status).toBe(409);
  });

  it("refuses and deletes an upload that is not the file described", async () => {
    const { call } = await signedIn();
    const input = describe_();
    const { body } = await create(call, input);
    const original = body.uploads.find((u) => u.role === "original")!;
    // A different size: the signature does not cover it.
    const bigger = new Uint8Array(png.byteLength + 1);
    const put = await send(original.url, {
      method: "PUT",
      headers: original.headers,
      body: bigger,
    });
    expect(put.status).toBe(403);
    // Bytes that reached storage some other way are checked on arrival.
    await uploadAll(body.uploads.filter((u) => u.role === "thumbnail"));
    const originalKey = [...files.objects.keys()]
      .find((k) => k.includes(input.id))!
      .replace("thumbnail", "original");
    await files.put(originalKey, bigger.buffer, {
      httpMetadata: { contentType: "image/png", cacheControl: "" },
    });
    expect((await stored(call, input.id)).status).toBe(422);
    expect(files.objects.has(originalKey)).toBe(false);
  });

  it("refuses a file over the Free allowance before any upload", async () => {
    const { call } = await signedIn();
    const tooBig = await create(call, describe_({ bytes: 26 * 1024 * 1024 }));
    expect(tooBig).toMatchObject({
      status: 413,
      body: { error: "file_too_large" },
    });
  });

  it("refuses a signed URL that was changed or has expired", async () => {
    const { call } = await signedIn();
    const { body } = await create(call, describe_());
    const original = body.uploads.find((u) => u.role === "original")!;
    const other = original.url.replace(/users\/[^/]+/, "users/someone-else");
    const put = (url: string) =>
      send(url, { method: "PUT", headers: original.headers, body: png });
    expect((await put(other)).status).toBe(403);
    const expired = original.url.replace(/expires=\d+/, "expires=1000");
    expect((await put(expired)).status).toBe(403);
  });

  it("never lets another person check, read or delete an image", async () => {
    const ana = await signedIn();
    const ben = await signedIn();
    const input = describe_();
    const { body } = await create(ana.call, input);
    await uploadAll(body.uploads);
    await stored(ana.call, input.id);

    expect((await stored(ben.call, input.id)).status).toBe(404);
    expect((await ben.call(`/api/memories/${input.id}`)).status).toBe(404);
    const del = await ben.call(`/api/memories/${input.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(404);
    expect((await create(ben.call, input)).status).toBe(409);
    expect(
      [...files.objects.keys()].filter((k) => k.includes(input.id))
    ).toHaveLength(2);
  });

  it("refuses anonymous requests", async () => {
    const call = newClient();
    const id = crypto.randomUUID();
    for (const [method, path] of [
      ["POST", "/api/memories/images"],
      ["POST", `/api/memories/${id}/stored`],
      ["GET", "/api/storage"],
    ] as const) {
      const json = method === "POST" ? {} : undefined;
      const res = await call(path, { method, json });
      expect(res.status, path).toBe(401);
    }
  });

  it("reports storage in use", async () => {
    const { call } = await signedIn();
    await create(call, describe_());
    const res = await call("/api/storage");
    expect(await res.json()).toEqual({
      usedBytes: png.byteLength + webp.byteLength,
      limitBytes: 1024 * 1024 * 1024,
    });
  });

  it("sweeps an upload that never finished, with its objects", async () => {
    const { call } = await signedIn();
    const input = describe_();
    const { body } = await create(call, input);
    await uploadAll(body.uploads);
    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    await db.query(
      `update memory_file set created_at = now() - interval '2 days' where memory_id = $1`,
      [input.id]
    );
    await db.end();
    expect(await sweep(env())).toBeGreaterThanOrEqual(1);
    expect(
      [...files.objects.keys()].filter((k) => k.includes(input.id))
    ).toEqual([]);
    expect((await call(`/api/memories/${input.id}`)).status).toBe(404);
  });
});

describe("presigned URLs on R2", () => {
  const r2 = env({
    SPARK_ENV: "production",
    R2_ACCOUNT_ID: "acct",
    R2_BUCKET: "spark-files-prod",
    R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
    R2_SECRET_ACCESS_KEY: "secret",
  });
  const store = fileStore(r2, "https://spark.example.com/api/memories");
  const file = {
    role: "original" as const,
    key: "users/u1/m1/original",
    mime: "image/png",
    bytes: 1234,
  };

  it("sign an upload for one key, type and size, for 15 minutes", async () => {
    const { url, headers } = await store.signUpload(file);
    const signed = new URL(url);
    expect(signed.origin).toBe("https://acct.r2.cloudflarestorage.com");
    expect(signed.pathname).toBe("/spark-files-prod/users/u1/m1/original");
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(signed.searchParams.get("X-Amz-SignedHeaders")).toBe(
      "cache-control;content-length;content-type;host"
    );
    expect(headers).toEqual({
      "content-type": "image/png",
      "cache-control": "private, max-age=31536000, immutable",
    });
  });

  it("sign the same download URL within the hour, so browsers cache it", async () => {
    const a = await store.signDownload(file.key);
    const b = await store.signDownload(file.key);
    expect(a).toBe(b);
    expect(new URL(a).searchParams.get("X-Amz-Expires")).toBe("7200");
  });

  it("are never made without credentials outside local development", async () => {
    const bare = fileStore(env({ SPARK_ENV: "production" }), "https://x.com/");
    await expect(bare.signDownload(file.key)).rejects.toThrow(
      /R2_ACCESS_KEY_ID/
    );
  });
});
