import { Client } from "pg";
import { cronCalls } from "../src/cron-budget";
import type { ImportMessage } from "../src/env";
import { describe, expect, it, vi } from "vitest";
import { openDatabase, openImports, openLibrary } from "@spark/db";
import { consumeImports, requeueImports } from "../src/imports";
import { databaseUrl, env, fakeTurnstile, queues, signedIn } from "./worker";
fakeTurnstile();
describe.skipIf(!databaseUrl)("import API and background queue", () => {
  it("stores batches owner-scoped and delivers only background Indexing", async () => {
    const { call } = await signedIn();
    const session = (await (await call("/api/auth/get-session")).json()) as {
      user: { id: string };
    };
    const id = crypto.randomUUID(),
      send = vi.fn(async () => {});
    const bindings = env({ IMPORT_QUEUE: { send, sendBatch: async () => {} } });
    expect(
      (
        await call(
          "/api/imports/create",
          { method: "POST", json: { id, total: 1, spread: true } },
          bindings
        )
      ).status
    ).toBe(200);
    const bad = await call(
      `/api/imports/${id}/batch`,
      {
        method: "POST",
        json: { offset: 0, items: [{ url: "javascript:alert(1)" }] },
      },
      bindings
    );
    expect(bad.status).toBe(400);
    expect(
      (
        await call(
          `/api/imports/${id}/batch`,
          {
            method: "POST",
            json: {
              offset: 0,
              items: [{ url: "https://import.test/tea", title: "Tea" }],
            },
          },
          bindings
        )
      ).status
    ).toBe(200);
    expect(
      (
        await call(
          `/api/imports/${id}/action`,
          { method: "POST", json: { action: "start" } },
          bindings
        )
      ).status
    ).toBe(200);
    expect(send).toHaveBeenCalled();
    const other = await signedIn();
    expect(
      (
        await other.call(
          `/api/imports/${id}/action`,
          { method: "POST", json: { action: "cancel" } },
          bindings
        )
      ).status
    ).toBe(404);
    const message = {
      body: { id, userId: session.user.id },
      ack: vi.fn(),
      retry: vi.fn(),
    };
    await consumeImports({ messages: [message] }, bindings);
    await consumeImports({ messages: [message] }, bindings);
    expect(message.retry).not.toHaveBeenCalled();
    expect(queues.fresh.sent).toHaveLength(0);
    expect(queues.background.sent).toHaveLength(1);
    const { db, close } = openDatabase(databaseUrl!);
    try {
      expect(await openImports(db, session.user.id).get(id)).toMatchObject({
        state: "done",
        done: 1,
      });
    } finally {
      await close();
    }
  });
});

describe.skipIf(!databaseUrl)("image import wake-ups", () => {
  it("ends a waiting delivery chain and wakes exactly once when the Capture confirms its bytes", async () => {
    const { call } = await signedIn();
    const { user } = (await (await call("/api/auth/get-session")).json()) as {
      user: { id: string };
    };
    const { db, close } = openDatabase(databaseUrl!);
    try {
      const id = crypto.randomUUID(),
        imageId = crypto.randomUUID();
      const jobs = openImports(db, user.id);
      await jobs.create({ id, total: 1, spread: true });
      await jobs.append(id, { offset: 0, items: [{ imageId }] });
      await jobs.action(id, "start");
      const send = vi.fn(async () => {}),
        bindings = env({ IMPORT_QUEUE: { send, sendBatch: async () => {} } });
      const message = {
        body: { id, userId: user.id },
        ack: vi.fn(),
        retry: vi.fn(),
      };
      await consumeImports({ messages: [message] }, bindings);
      expect(message.retry).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect((await jobs.get(id))!.availableAt.getTime()).toBeGreaterThan(
        Date.now() + 14 * 60_000
      );
      expect(await jobs.pendingImages(id)).toEqual([imageId]);
      await consumeImports({ messages: [message] }, bindings);
      expect(send).not.toHaveBeenCalled();
      const library = openLibrary(db, user.id);
      await library.captureImage({
        id: imageId,
        importJobId: id,
        mime: "image/png",
        bytes: 2048,
        width: 800,
        height: 600,
        contentHash: "ab".repeat(32),
        thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
        thumbnail: { mime: "image/webp", bytes: 300 },
      });
      await library.markStored(imageId);
      expect(
        (
          await call(
            `/api/memories/${imageId}/stored`,
            { method: "POST" },
            bindings
          )
        ).status
      ).toBe(200);
      expect(
        (
          await call(
            `/api/memories/${imageId}/stored`,
            { method: "POST" },
            bindings
          )
        ).status
      ).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
      await consumeImports({ messages: [message] }, bindings);
      expect(await jobs.get(id)).toMatchObject({ state: "done", done: 1 });
    } finally {
      await close();
    }
  });
});

describe.skipIf(!databaseUrl)("import continuation leases", () => {
  it("a duplicate continuation cannot start another delivery chain", async () => {
    const { call } = await signedIn();
    const { user } = (await (await call("/api/auth/get-session")).json()) as {
      user: { id: string };
    };
    const { db, close } = openDatabase(databaseUrl!);
    try {
      const id = crypto.randomUUID(),
        jobs = openImports(db, user.id);
      await jobs.create({ id, total: 3, spread: true });
      await jobs.append(id, {
        offset: 0,
        items: [
          { url: "https://continuation.test/1" },
          { url: "https://continuation.test/2" },
          { url: "https://continuation.test/3" },
        ],
      });
      await jobs.action(id, "start");
      const sent: ImportMessage[] = [];
      const bindings = env({
        IMPORT_QUEUE: {
          sendBatch: async () => {},
          send: async (body) => {
            sent.push(body);
          },
        },
      });
      const deliver = async (body: ImportMessage) => {
        const retry = vi.fn();
        await consumeImports(
          { messages: [{ body, ack: vi.fn(), retry }] },
          bindings
        );
        expect(retry).not.toHaveBeenCalled();
      };
      await deliver({ id, userId: user.id });
      expect(sent).toHaveLength(1);
      const first = sent.shift()!;
      expect("lease" in first && first.lease).toBeTruthy();
      await Promise.all([deliver(first), deliver(first)]);
      expect(await jobs.get(id)).toMatchObject({ done: 2, state: "running" });
      expect(sent).toHaveLength(1);
      await deliver(sent.shift()!);
      expect(sent).toHaveLength(0);
      expect(await jobs.get(id)).toMatchObject({ done: 3, state: "done" });
    } finally {
      await close();
    }
  });
});

describe.skipIf(!databaseUrl)("allowance timers and fleet recovery", () => {
  it("caps delayed deliveries at 12 hours and fences duplicate early messages", async () => {
    const { call } = await signedIn();
    const { user } = (await (await call("/api/auth/get-session")).json()) as {
      user: { id: string };
    };
    const { db, close } = openDatabase(databaseUrl!);
    const fixture = new Client({ connectionString: databaseUrl! });
    await fixture.connect();
    try {
      const now = new Date();
      now.setUTCDate(now.getUTCDate() + 1);
      now.setUTCHours(0, 1, 0, 0);
      const due = new Date(now);
      due.setUTCHours(24, 0, 0, 0);
      await fixture.query(
        "insert into usage_day (user_id, day, captures) values ($1, $2, 50)",
        [user.id, now.toISOString().slice(0, 10)]
      );
      const id = crypto.randomUUID(),
        jobs = openImports(db, user.id);
      await jobs.create({ id, total: 1, spread: true });
      await jobs.append(id, {
        offset: 0,
        items: [{ url: "https://timer.test/one" }],
      });
      await jobs.action(id, "start");
      const sent: { body: ImportMessage; delaySeconds?: number }[] = [];
      const bindings = env({
        IMPORT_QUEUE: {
          sendBatch: async () => {},
          send: async (body, options) => {
            sent.push({ body, ...options });
          },
        },
      });
      const deliver = async (body: ImportMessage, at: Date) => {
        const retry = vi.fn();
        await consumeImports(
          { messages: [{ body, ack: vi.fn(), retry }] },
          bindings,
          at
        );
        expect(retry).not.toHaveBeenCalled();
      };
      const initial = { id, userId: user.id };
      await deliver(initial, now);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.delaySeconds).toBe(43200);
      await deliver(initial, now);
      expect(sent).toHaveLength(1);
      const early = new Date(now.getTime() + 43200_000),
        first = sent.shift()!;
      await deliver(first.body, early);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.delaySeconds).toBe(43140);
      await deliver(first.body, early);
      expect(sent).toHaveLength(1);
      expect(await jobs.get(id)).toMatchObject({ done: 0 });
      await deliver(sent.shift()!.body, due);
      expect(sent).toHaveLength(0);
      expect(await jobs.get(id)).toMatchObject({ done: 1, state: "done" });
    } finally {
      await fixture.end();
      await close();
    }
  });

  it("recovers every midnight waiter in one cron batch and queued pages, without hourly starvation", async () => {
    const { db, close } = openDatabase(databaseUrl!);
    const fixture = new Client({ connectionString: databaseUrl! });
    await fixture.connect();
    const owners: string[] = [];
    try {
      const now = new Date();
      now.setUTCDate(now.getUTCDate() + 1);
      now.setUTCHours(23, 59, 0, 0);
      const due = new Date(now);
      due.setUTCHours(24, 0, 0, 0);
      const jobs: { id: string; userId: string }[] = [];
      for (let n = 0; n < 125; n++) {
        const userId = crypto.randomUUID(),
          id = crypto.randomUUID();
        owners.push(userId);
        await fixture.query(
          'insert into "user" (id, name, email) values ($1, $2, $3)',
          [userId, "", `fleet-${userId}@example.test`]
        );
        await fixture.query(
          "insert into usage_day (user_id, day, captures) values ($1, $2, 50)",
          [userId, now.toISOString().slice(0, 10)]
        );
        const imports = openImports(db, userId);
        await imports.create({ id, total: 1, spread: true });
        await imports.append(id, {
          offset: 0,
          items: [{ url: "https://fleet.test/one" }],
        });
        await imports.action(id, "start");
        expect(await imports.step(id, now)).toMatchObject({
          dueAt: due.toISOString(),
        });
        jobs.push({ id, userId });
      }
      const queued: ImportMessage[] = [],
        send = vi.fn(async () => {});
      const sendBatch = vi.fn(async (messages: { body: ImportMessage }[]) => {
        expect(messages.length).toBeLessThanOrEqual(100);
        queued.push(...messages.map((m) => m.body));
      });
      const bindings = env({ IMPORT_QUEUE: { send, sendBatch } }),
        calls = cronCalls();
      await requeueImports(bindings, calls, now);
      expect(sendBatch).not.toHaveBeenCalled();
      await requeueImports(bindings, cronCalls(), due);
      expect(sendBatch).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      while (queued.length) {
        const retry = vi.fn();
        await consumeImports(
          { messages: [{ body: queued.shift()!, ack: vi.fn(), retry }] },
          bindings,
          due
        );
        expect(retry).not.toHaveBeenCalled();
      }
      expect(sendBatch).toHaveBeenCalledTimes(2);
      for (const job of jobs)
        expect(await openImports(db, job.userId).get(job.id)).toMatchObject({
          done: 1,
          state: "done",
        });
    } finally {
      for (const id of owners)
        await fixture.query('delete from "user" where id = $1', [id]);
      await fixture.end();
      await close();
    }
  }, 120_000);
});
