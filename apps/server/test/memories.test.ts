import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "pg";
import { FREE_ALLOWANCE } from "@spark/core";
import { databaseUrl, fakeTurnstile, newClient, signedIn } from "./worker";

// The Memory API through the Worker, against real Postgres.
fakeTurnstile();

type Call = Awaited<ReturnType<typeof signedIn>>["call"];

async function capture(call: Call, json: unknown) {
  const res = await call("/api/memories", { method: "POST", json });
  return { status: res.status, body: (await res.json()) as { id: string } };
}

describe.skipIf(!databaseUrl)("the Memory API", () => {
  it("refuses anonymous requests on every route", async () => {
    const call = newClient();
    const id = crypto.randomUUID();
    const requests: [string, string][] = [
      ["GET", "/api/memories"],
      ["POST", "/api/memories"],
      ["GET", `/api/memories/${id}`],
      ["PATCH", `/api/memories/${id}`],
      ["DELETE", `/api/memories/${id}`],
      ["GET", "/api/search?q=soup"],
    ];
    for (const [method, path] of requests) {
      const json = method === "GET" ? undefined : { body: "x" };
      const res = await call(path, { method, json });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("captures, lists, reads, edits, finds and deletes a text Memory", async () => {
    const { call } = await signedIn();
    const id = crypto.randomUUID();

    const created = await capture(call, {
      id,
      body: "Cardamom buns with orange zest",
      captureNote: "bake on Sunday",
    });
    expect(created).toMatchObject({
      status: 201,
      body: { id, kind: "text", captureNote: "bake on Sunday" },
    });

    const list = await (await call("/api/memories")).json();
    expect(list).toMatchObject({ memories: [{ id }] });
    expect(await (await call(`/api/memories/${id}`)).json()).toMatchObject({
      body: "Cardamom buns with orange zest",
    });

    const edit = await call(`/api/memories/${id}`, {
      method: "PATCH",
      json: { title: "Buns" },
    });
    expect(await edit.json()).toMatchObject({ id, title: "Buns" });

    const found = await (await call("/api/search?q=cardamon")).json();
    expect(found).toMatchObject({ results: [{ id, matched: ["typo"] }] });

    const del = await call(`/api/memories/${id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await call(`/api/memories/${id}`)).status).toBe(404);
  });

  it("returns the saved Memory when a Capture is retried", async () => {
    const { call } = await signedIn();
    const id = crypto.randomUUID();
    await capture(call, { id, body: "Once" });
    expect(await capture(call, { id, body: "Once" })).toMatchObject({
      status: 200,
      body: { id },
    });
  });

  it("refuses empty text and text over the Free allowance", async () => {
    const { call } = await signedIn();
    expect((await capture(call, { body: " " })).status).toBe(400);
    const huge = "a".repeat(FREE_ALLOWANCE.textMaxChars + 1);
    expect((await capture(call, { body: huge })).status).toBe(400);
    const edit = await call(`/api/memories/${crypto.randomUUID()}`, {
      method: "PATCH",
      json: { title: "a".repeat(FREE_ALLOWANCE.titleMaxChars + 1) },
    });
    expect(edit.status).toBe(400);
  });

  it("refuses a request body far over the Free allowance before reading it", async () => {
    const { call } = await signedIn();
    const res = await call("/api/memories", {
      method: "POST",
      json: { body: "a".repeat(FREE_ALLOWANCE.textMaxChars * 5) },
    });
    expect(res.status).toBe(413);
  });

  it("answers 404 for an id that is not a uuid", async () => {
    const { call } = await signedIn();
    expect((await call("/api/memories/not-a-uuid")).status).toBe(404);
  });

  it("never shows, changes or deletes another person's Memory", async () => {
    const ana = await signedIn();
    const ben = await signedIn();
    const { body: secret } = await capture(ana.call, {
      body: "Ana's locker code is under the plant",
    });
    const path = `/api/memories/${secret.id}`;

    expect((await ben.call(path)).status).toBe(404);
    const edit = await ben.call(path, { method: "PATCH", json: { body: "x" } });
    expect(edit.status).toBe(404);
    expect((await ben.call(path, { method: "DELETE" })).status).toBe(404);
    const taken = await capture(ben.call, { id: secret.id, body: "mine" });
    expect(taken.status).toBe(409);
    const list = await (await ben.call("/api/memories")).json();
    expect(list).toEqual({ memories: [] });
    const search = await (await ben.call("/api/search?q=locker")).json();
    expect(search).toEqual({ results: [] });

    expect(await (await ana.call(path)).json()).toMatchObject({
      body: "Ana's locker code is under the plant",
    });
  });
});

describe.skipIf(!databaseUrl)("logs when saving a Memory fails", () => {
  const db = new Client({ connectionString: databaseUrl });
  beforeAll(async () => {
    await db.connect();
    // A real Postgres failure whose message and parameters carry the text.
    await db.query(`
      create or replace function spark_test_fail_memory() returns trigger as $$
      begin
        if new.body like 'LEAK-%' then raise exception 'failed %', new.body; end if;
        return new;
      end $$ language plpgsql;
      drop trigger if exists spark_test_fail_memory on memory;
      create trigger spark_test_fail_memory before insert or update on memory
        for each row execute function spark_test_fail_memory();
    `);
  });
  afterAll(async () => {
    await db.query(`
      drop trigger if exists spark_test_fail_memory on memory;
      drop function if exists spark_test_fail_memory();
    `);
    await db.end();
  });

  it("never contain the Memory's text", async () => {
    const { call } = await signedIn();
    const logged: unknown[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args) => {
        logged.push(...args);
      });
    }
    expect((await capture(call, { body: "LEAK-secret-recipe" })).status).toBe(
      500
    );
    const printed = logged.map((x) => String(x)).join("\n");
    expect(printed).toContain("unhandled error");
    expect(printed).not.toContain("secret-recipe");
  });
});
