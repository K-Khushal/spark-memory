import { describe, expect, it } from "vitest";
import {
  databaseUrl,
  signedIn,
  fakeTurnstile,
  env,
  drain,
  ctx,
} from "./worker";
import worker from "../src/index";
fakeTurnstile();
const extension = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const bindings = () => env({ EXTENSION_ORIGIN: extension });
describe.skipIf(!databaseUrl)("extension Capture", () => {
  it("reuses a dashboard session, preserves client text, dedupes, and skips gathering", async () => {
    const { call } = await signedIn();
    const user = (await (await call("/api/me")).json()) as { id: string };
    const id = crypto.randomUUID();
    const request = () =>
      call(
        "/api/memories/links",
        {
          method: "POST",
          headers: { "x-spark-user": user.id },
          json: {
            id,
            url: `https://garden.test/${id}`,
            page: {
              title: "Basil",
              text: "Basil wants six hours of light and warm soil. ".repeat(12),
            },
          },
        },
        bindings()
      );
    const res = await request();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id,
      pageTitle: "Basil",
      preservation: "preserved",
    });
    expect((await request()).status).toBe(200);
    await drain(id, bindings());
    expect(await (await call(`/api/memories/${id}`)).json()).toMatchObject({
      pageTitle: "Basil",
      indexState: "searchable",
    });
  });
  it("allows only the pinned extension and checks the outbox owner before writing", async () => {
    const { call } = await signedIn();
    const cookie = call.cookie();
    const send = (origin: string, owner?: string) =>
      worker.fetch(
        new Request("http://localhost:8787/api/memories/links", {
          method: "POST",
          headers: {
            origin,
            cookie,
            "content-type": "application/json",
            ...(owner && { "x-spark-user": owner }),
          },
          body: JSON.stringify({
            url: "https://garden.test/pinned",
            page: { title: "Basil" },
          }),
        }),
        bindings(),
        ctx
      );
    expect(
      (await send("chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")).status
    ).toBe(403);
    expect((await send(extension, "someone-else")).status).toBe(409);
    const res = await send(extension);
    expect(res.status).toBe(201);
    expect(res.headers.get("access-control-allow-origin")).toBe(extension);
    const preflight = await worker.fetch(
      new Request("http://localhost:8787/api/memories/links", {
        method: "OPTIONS",
        headers: { origin: extension },
      }),
      bindings(),
      ctx
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      extension
    );
    expect(
      (
        await worker.fetch(
          new Request("http://localhost:8787/api/memories", {
            headers: { origin: extension },
          }),
          bindings(),
          ctx
        )
      ).status
    ).toBe(401);
  });
  it("keeps just one screenshot in a concurrent upload and respects ownership", async () => {
    const { call } = await signedIn();
    const result = await call("/api/memories/links", {
      method: "POST",
      json: {
        url: `https://garden.test/${crypto.randomUUID()}`,
        page: { title: "Basil" },
      },
    });
    const { id } = (await result.json()) as { id: string };
    const upload = () =>
      worker.fetch(
        new Request(`http://localhost:8787/api/memories/${id}/screenshot`, {
          method: "POST",
          headers: {
            origin: extension,
            cookie: call.cookie(),
            "content-type": "image/jpeg",
          },
          body: new Uint8Array([255, 216, 255, 217]),
        }),
        bindings(),
        ctx
      );
    const results = await Promise.all([upload(), upload()]);
    expect(results.some((res) => res.status === 200)).toBe(true);
    expect((await upload()).status).toBe(200);
    const screenshot = await call(`/api/memories/${id}/screenshot`);
    expect(screenshot.status).toBe(200);
    expect(await screenshot.json()).toMatchObject({
      url: expect.stringContaining("sig="),
    });
    expect(await (await call("/api/storage")).json()).toMatchObject({
      usedBytes: 4,
    });
    const other = await signedIn();
    const denied = await other.call(`/api/memories/${id}/screenshot`, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
    });
    expect([400, 404]).toContain(denied.status);
  });
});
describe.skipIf(!databaseUrl)("extension preservation on resurface", () => {
  it("fills missing text once and invalidates a previous Indexing run", async () => {
    const { call } = await signedIn();
    const url = `https://garden.test/${crypto.randomUUID()}`;
    const first = await call("/api/memories/links", {
      method: "POST",
      json: { url, page: { title: "Login Wall" } },
    });
    const { id } = (await first.json()) as { id: string };
    const text = "Basil wants six hours of light and warm soil. ".repeat(12);
    const captures = await Promise.all(
      [1, 2].map(() =>
        call("/api/memories/links", {
          method: "POST",
          json: { url, page: { title: "Growing Basil", text } },
        })
      )
    );
    expect(captures.every((response) => response.status === 200)).toBe(true);
    await drain(id);
    expect(await (await call(`/api/memories/${id}`)).json()).toMatchObject({
      id,
      pageTitle: "Growing Basil",
      body: text.trim(),
      preservation: "preserved",
      indexState: "searchable",
    });
  });
});
describe.skipIf(!databaseUrl)("extension session revocation", () => {
  it("refuses a deleted account's existing cookie and never trusts a wildcard", async () => {
    const { call, address } = await signedIn();
    const cookie = call.cookie();
    const capture = (config = bindings()) =>
      worker.fetch(
        new Request("http://localhost:8787/api/memories/links", {
          method: "POST",
          headers: {
            origin: extension,
            cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ url: "https://garden.test/revoked" }),
        }),
        config,
        ctx
      );
    expect(
      (await capture(env({ EXTENSION_ORIGIN: "chrome-extension://*" }))).status
    ).toBe(403);
    expect(
      (
        await call("/api/account", {
          method: "DELETE",
          json: { email: address },
        })
      ).status
    ).toBe(204);
    expect((await capture()).status).toBe(401);
  });
});
