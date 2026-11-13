import { describe, expect, it, vi } from "vitest";
import { openDatabase, openImports } from "@spark/db";
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
