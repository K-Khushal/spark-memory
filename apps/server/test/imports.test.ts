import type { ImportMessage } from "../src/env";
import { describe, expect, it, vi } from "vitest";
import { openDatabase, openImports, openLibrary } from "@spark/db";
import { consumeImports } from "../src/imports";
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
    const bindings = env({ IMPORT_QUEUE: { send } });
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
        bindings = env({ IMPORT_QUEUE: { send } });
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
      expect(first.lease).toBeTruthy();
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
