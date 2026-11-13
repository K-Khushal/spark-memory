import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { FREE_ALLOWANCE } from "@spark/core";
import type { RateLimiter } from "../src/env";
import {
  databaseUrl,
  env,
  fakeTurnstile,
  newClient,
  postSearch,
  queues,
  signedIn,
} from "./worker";

// The Free allowance through the Worker (#27), against real Postgres. The
// Rate Limiting binding is the one boundary faked, at its interface.
fakeTurnstile();

const image = () => ({
  id: crypto.randomUUID(),
  mime: "image/png",
  bytes: 12,
  width: 640,
  height: 480,
  contentHash: "ef".repeat(32),
  thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
  thumbnail: { mime: "image/webp", bytes: 6 },
});

/** A limiter that lets `allow` calls through and records every key it was asked about. */
function limiter(allow: number) {
  const keys: string[] = [];
  const fake: RateLimiter = {
    limit: async ({ key }) => {
      keys.push(key);
      return { success: keys.length <= allow };
    },
  };
  return Object.assign(fake, { keys });
}

async function userId(call: Awaited<ReturnType<typeof signedIn>>["call"]) {
  const session = (await (await call("/api/auth/get-session")).json()) as {
    user: { id: string };
  };
  return session.user.id;
}

async function setCaptures(id: string, n: number) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `insert into usage_day (user_id, day, captures)
       values ($1, (now() at time zone 'utc')::date, $2)
       on conflict (user_id, day) do update set captures = $2`,
      [id, n]
    );
  } finally {
    await client.end();
  }
}

describe.skipIf(!databaseUrl)("the Free allowance API", () => {
  it("answers 429 with Retry-After once a person's Capture limit is spent, for each Capture route", async () => {
    const { call } = await signedIn();
    const capture = limiter(0);
    const bindings = env({ CAPTURE_LIMITER: capture });
    const routes: [string, object][] = [
      ["/api/memories", { body: "a note" }],
      ["/api/memories/links", { url: "https://garden.test/x" }],
      ["/api/memories/images", image()],
      ["/api/memories/pdfs", {}],
    ];
    for (const [path, json] of routes) {
      const res = await call(path, { method: "POST", json }, bindings);
      expect(res.status, path).toBe(429);
      expect(res.headers.get("retry-after"), path).toBe("60");
      expect(await res.json()).toEqual({ ok: false, error: "rate_limited" });
    }
    const list = (await (await call("/api/memories")).json()) as {
      memories: unknown[];
    };
    expect(list.memories).toHaveLength(0);
  });

  it("limits each person by their own id, and lets the rest through", async () => {
    const ana = await signedIn();
    const ben = await signedIn();
    const capture = limiter(2);
    const bindings = env({ CAPTURE_LIMITER: capture });
    const post = (call: typeof ana.call) =>
      call("/api/memories", { method: "POST", json: { body: "x" } }, bindings);
    const statuses = [
      (await post(ana.call)).status,
      (await post(ana.call)).status,
      (await post(ben.call)).status,
    ];
    expect(statuses).toEqual([201, 201, 429]);
    expect(capture.keys).toEqual([
      await userId(ana.call),
      await userId(ana.call),
      await userId(ben.call),
    ]);
  });

  it("limits search and More Like This separately from Capture, and never Capture's other reads", async () => {
    const { call } = await signedIn();
    const search = limiter(1);
    const bindings = env({ SEARCH_LIMITER: search });
    expect(
      (await postSearch(call, { q: "soup", mode: "instant" }, bindings)).status
    ).toBe(200);
    const denied = await postSearch(
      call,
      { q: "soup", mode: "instant" },
      bindings
    );
    expect(denied.status).toBe(429);
    expect(denied.headers.get("retry-after")).toBe("60");
    const similar = await call(
      `/api/memories/${crypto.randomUUID()}/similar`,
      {},
      bindings
    );
    expect(similar.status).toBe(429);
    // Reading the Library is not a Capture or a search.
    expect((await call("/api/memories", {}, bindings)).status).toBe(200);
  });

  it("does not limit when no binding is set, as locally", async () => {
    const { call } = await signedIn();
    for (let i = 0; i < 5; i++) {
      const res = await call("/api/memories", {
        method: "POST",
        json: { body: `n${i}` },
      });
      expect(res.status).toBe(201);
    }
  });

  it("refuses a file once today's Captures are used, saying when it is allowed again", async () => {
    const { call } = await signedIn();
    const id = await userId(call);
    await setCaptures(id, FREE_ALLOWANCE.capturesPerDay);
    const res = await call("/api/memories/images", {
      method: "POST",
      json: image(),
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, error: "captures_full" });
    const wait = Number(res.headers.get("retry-after"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(86_400);
  });

  it("takes the last Capture of the day whole and keeps a link past it as Reference only", async () => {
    const { call } = await signedIn();
    await setCaptures(await userId(call), FREE_ALLOWANCE.capturesPerDay - 1);
    queues.fresh.sent.length = 0;

    const last = await call("/api/memories/links", {
      method: "POST",
      json: { id: crypto.randomUUID(), url: "https://garden.test/last" },
    });
    expect(last.status).toBe(201);
    expect(await last.json()).toMatchObject({ indexState: "indexing" });
    expect(queues.fresh.sent).toHaveLength(1);

    const over = await call("/api/memories/links", {
      method: "POST",
      json: { id: crypto.randomUUID(), url: "https://garden.test/over" },
    });
    expect(over.status).toBe(201);
    expect(await over.json()).toMatchObject({
      sourceUrl: "https://garden.test/over",
      preservation: "reference_only",
      indexState: "searchable",
    });
    // No Gather, no AI work: nothing more was sent to Indexing.
    expect(queues.fresh.sent).toHaveLength(1);
  });

  it("reports usage: storage, Captures and Deep fetches today, and the largest Memories", async () => {
    const { call } = await signedIn();
    await call("/api/memories", { method: "POST", json: { body: "one" } });
    const file = image();
    await call("/api/memories/images", { method: "POST", json: file });
    const res = await call("/api/usage");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const usage = (await res.json()) as Record<string, unknown>;
    expect(usage).toMatchObject({
      storage: { used: 12 + 6, limit: FREE_ALLOWANCE.storageBytes },
      captures: { used: 2, limit: FREE_ALLOWANCE.capturesPerDay },
      deepFetches: { used: 0, limit: FREE_ALLOWANCE.deepFetchesPerDay },
      largest: [{ id: file.id, kind: "image", bytes: 18 }],
    });
    expect(new Date(usage.resetsAt as string).getUTCHours()).toBe(0);
  });

  it("answers usage to the signed-in only", async () => {
    const res = await newClient()("/api/usage");
    expect(res.status).toBe(401);
  });
});
