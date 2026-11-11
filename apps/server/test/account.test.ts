import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import worker from "../src/index";
import { sweepAccounts } from "../src/account-jobs";
import { cronCalls } from "../src/cron-budget";
import {
  accountQueue,
  ctx,
  databaseUrl,
  deliverAccount,
  email,
  env,
  fakeTurnstile,
  files,
  lastCode,
  newClient,
  ORIGIN,
  sendCode,
} from "./worker";
import { unzip } from "./unzip";

// Sessions, Library export and account deletion through the Worker, against
// real Postgres; storage is the in-memory bucket, the account queue a
// recording one that each test delivers.
fakeTurnstile();

type Call = ReturnType<typeof newClient>;
type Session = {
  handle: string;
  device: string;
  lastActiveAt: string;
  current: boolean;
};
type Export = {
  state: string;
  expiresAt?: string;
  bytes?: number;
} | null;

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

/** Signs `address` in from a new browser; returns its client and the sign-in status. */
async function signInAs(address: string, userAgent = CHROME_MAC) {
  const call = newClient();
  await sendCode(call, address);
  const res = await call("/api/auth/sign-in/email-otp", {
    method: "POST",
    headers: { "user-agent": userAgent },
    json: { email: address, otp: await lastCode(call, address) },
  });
  return { call, status: res.status };
}

const me = async (call: Call) => (await call("/api/me")).status;

/** The signed-in person's id, from their session cookie (when the API would refuse them). */
async function userIdFromDb(call: Call) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const token = decodeURIComponent(
      call.cookie().match(/session_token=([^;.]+)/)![1]!
    );
    const { rows } = await client.query<{ user_id: string }>(
      `select user_id from session where token = $1`,
      [token]
    );
    return rows[0]!.user_id;
  } finally {
    await client.end();
  }
}
const userId = async (call: Call) =>
  ((await (await call("/api/me")).json()) as { id: string }).id;
const sessions = async (call: Call) =>
  (
    (await (await call("/api/account/sessions")).json()) as {
      sessions: Session[];
    }
  ).sessions;
const exportOf = async (call: Call) =>
  ((await (await call("/api/account/export")).json()) as { export: Export })
    .export;

/** What the browser does with a signed URL (here, the local stand-in for R2). */
const download = (url: string) =>
  worker.fetch(
    new Request<unknown, IncomingRequestCfProperties>(new URL(url, ORIGIN)),
    env(),
    ctx
  );

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 5, 6, 7]);

/** Captures an image Memory, uploaded and stored. */
async function captureImage(call: Call, bytes = png) {
  const id = crypto.randomUUID();
  const res = await call("/api/memories/images", {
    method: "POST",
    json: {
      id,
      mime: "image/png",
      bytes: bytes.byteLength,
      width: 10,
      height: 10,
      contentHash: "cd".repeat(32),
      thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
      thumbnail: { mime: "image/webp", bytes: 3 },
    },
  });
  const { uploads } = (await res.json()) as {
    uploads: { role: string; url: string; headers: Record<string, string> }[];
  };
  for (const u of uploads) {
    const body = u.role === "original" ? bytes : new Uint8Array([1, 2, 3]);
    const put = await worker.fetch(
      new Request<unknown, IncomingRequestCfProperties>(
        new URL(u.url, ORIGIN),
        {
          method: "PUT",
          headers: { ...u.headers, "content-length": String(body.length) },
          body,
        }
      ),
      env(),
      ctx
    );
    expect(put.status).toBe(200);
  }
  expect(
    (await call(`/api/memories/${id}/stored`, { method: "POST" })).status
  ).toBe(200);
  return id;
}

async function captureText(call: Call, body: string) {
  const res = await call("/api/memories", { method: "POST", json: { body } });
  return ((await res.json()) as { id: string }).id;
}

describe.skipIf(!databaseUrl)("account", () => {
  let db: Client;
  beforeAll(async () => {
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
  });
  afterAll(() => db.end());

  describe("sessions", () => {
    it("lists each device by name, marks this one, and never shows ids or tokens", async () => {
      const address = email();
      const laptop = await signInAs(address, CHROME_MAC);
      await signInAs(address, SAFARI_IPHONE);
      const res = await laptop.call("/api/account/sessions");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const text = await res.text();
      const { sessions: list } = JSON.parse(text) as { sessions: Session[] };
      // This device first, though the phone signed in later.
      expect(list.map((s) => [s.device, s.current])).toEqual([
        ["Chrome on macOS", true],
        ["Safari on iPhone", false],
      ]);
      expect(list.every((s) => /^[\da-f]{16}$/.test(s.handle))).toBe(true);
      const { rows } = await db.query<{ id: string; token: string }>(
        `select id, token from session where user_id = $1`,
        [await userId(laptop.call)]
      );
      for (const { id, token } of rows) {
        expect(text).not.toContain(id);
        expect(text).not.toContain(token);
      }
    });

    it("signs another device out, but not this one and not another person's", async () => {
      const address = email();
      const laptop = await signInAs(address);
      const phone = await signInAs(address, SAFARI_IPHONE);
      const stranger = await signInAs(email());
      const [theirs] = await sessions(stranger.call);
      const list = await sessions(laptop.call);
      const other = list.find((s) => !s.current)!;
      const here = list.find((s) => s.current)!;
      const revoke = (call: Call, handle: string) =>
        call(`/api/account/sessions/${handle}`, { method: "DELETE" });

      expect((await revoke(laptop.call, theirs!.handle)).status).toBe(404);
      expect((await revoke(laptop.call, here.handle)).status).toBe(404);
      expect((await revoke(laptop.call, other.handle)).status).toBe(204);
      expect(await me(phone.call)).toBe(401);
      expect(await me(laptop.call)).toBe(200);
      expect(await me(stranger.call)).toBe(200);
    });

    it("signs out everywhere, this device included", async () => {
      const address = email();
      const laptop = await signInAs(address);
      const phone = await signInAs(address, SAFARI_IPHONE);
      const res = await laptop.call("/api/account/sign-out-everywhere", {
        method: "POST",
      });
      expect(res.status).toBe(204);
      expect(res.headers.getSetCookie().join()).toMatch(/Max-Age=0/);
      expect(await me(laptop.call)).toBe(401);
      expect(await me(phone.call)).toBe(401);
    });

    it("refuses anonymous requests", async () => {
      const call = newClient();
      for (const [method, path] of [
        ["GET", "/api/account/sessions"],
        ["POST", "/api/account/sign-out-everywhere"],
        ["GET", "/api/account/export"],
        ["POST", "/api/account/export"],
        ["DELETE", "/api/account"],
      ] as const) {
        const res = await call(path, {
          method,
          json: method === "DELETE" ? { email: "x" } : undefined,
        });
        expect(res.status, path).toBe(401);
      }
    });
  });

  describe("export", () => {
    it("builds a ZIP of the whole Library in the background, with a link that expires", async () => {
      const { call } = await signInAs(email());
      const stranger = await signInAs(email());
      await captureText(stranger.call, "Not yours");
      const text = await captureText(call, "Lemon tart, short crust");
      // Larger than one 8 MiB part, so the ZIP is uploaded in several.
      const big = new Uint8Array(9 * 1024 * 1024).map((_, i) => (i * 31) % 251);
      big.set(png);
      const image = await captureImage(call, big);
      expect(await exportOf(call)).toBeNull();

      const start = await call("/api/account/export", { method: "POST" });
      expect(start.status).toBe(202);
      expect(await start.json()).toMatchObject({
        export: { state: "building" },
      });
      const again = await call("/api/account/export", { method: "POST" });
      expect(again.status).toBe(409);
      expect(await again.json()).toMatchObject({ error: "busy" });

      const [message] = await deliverAccount((m) => m.kind === "export");
      expect(message!.ack).toHaveBeenCalled();
      const ready = await exportOf(call);
      expect(ready).toMatchObject({ state: "ready" });
      expect(new Date(ready!.expiresAt!).getTime()).toBeGreaterThan(
        Date.now() + 23 * 3600_000
      );

      const link = await call("/api/account/export/download");
      expect(link.status).toBe(302);
      const res = await download(link.headers.get("location")!);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toMatch(
        /^attachment; filename="spark-library-\d{4}-\d{2}-\d{2}\.zip"$/
      );
      const zip = unzip(new Uint8Array(await res.arrayBuffer()));
      expect([...zip.keys()].sort()).toEqual(
        ["memories.json", `files/${image}.png`].sort()
      );
      // Compared as one hash: a byte-by-byte diff of 9 MiB is unreadable.
      const sha = async (b: Uint8Array | undefined) =>
        b &&
        Buffer.from(await crypto.subtle.digest("SHA-256", b)).toString("hex");
      expect(await sha(zip.get(`files/${image}.png`))).toBe(await sha(big));
      const memories = JSON.parse(
        new TextDecoder().decode(zip.get("memories.json"))
      ) as { id: string; body: string | null; file: { path: string } | null }[];
      expect(memories.map((m) => m.id).sort()).toEqual([text, image].sort());
      expect(memories.find((m) => m.id === text)).toMatchObject({
        body: "Lemon tart, short crust",
        file: null,
      });
      expect(memories.find((m) => m.id === image)).toMatchObject({
        file: { path: `files/${image}.png` },
      });
      expect(JSON.stringify(memories)).not.toContain("Not yours");
      expect(JSON.stringify(memories)).not.toContain('"key"');

      // Not again within the hour; the screen is told when it can.
      const soon = await call("/api/account/export", { method: "POST" });
      expect(await soon.json()).toMatchObject({ error: "too_soon" });
      const shown = (await exportOf(call)) as unknown as {
        requestedAt: string;
        nextExportAt: string;
      };
      expect(
        new Date(shown.nextExportAt).getTime() -
          new Date(shown.requestedAt).getTime()
      ).toBe(60 * 60_000);
      // Once it has passed, a new export starts while the ready one stays.
      await db.query(
        `update library_export set requested_at = now() - interval '61 minutes' where user_id = $1`,
        [await userId(call)]
      );
      expect(
        new Date(
          ((await exportOf(call)) as unknown as { nextExportAt: string })
            .nextExportAt
        ).getTime()
      ).toBeLessThanOrEqual(Date.now());
      expect(
        (await call("/api/account/export", { method: "POST" })).status
      ).toBe(202);
      await deliverAccount((m) => m.kind === "export");
    });

    it("tries a failed build again, then shows it Failed, and lets the person ask again", async () => {
      const { call } = await signInAs(email());
      await call("/api/account/export", { method: "POST" });
      const down = env({
        FILES: {
          ...files,
          createMultipartUpload: async () => {
            throw new Error("storage down");
          },
        },
      });
      const [message] = accountQueue.sent.filter(
        (m) => m.body.kind === "export"
      );
      accountQueue.sent = accountQueue.sent.filter((m) => m !== message);
      for (const outcome of ["retry", "retry", "ack"]) {
        accountQueue.sent.push({ body: message!.body });
        const [delivered] = await deliverAccount(
          (m) => m === message!.body,
          down
        );
        expect(
          outcome === "retry" ? delivered!.retry : delivered!.ack
        ).toHaveBeenCalled();
      }
      expect(await exportOf(call)).toMatchObject({ state: "failed" });
      const again = await call("/api/account/export", { method: "POST" });
      expect(again.status).toBe(202);
    });

    it("removes a replaced export's ZIP on the sweep, even if nothing removed it at the time", async () => {
      const { call } = await signInAs(email());
      await call("/api/account/export", { method: "POST" });
      await deliverAccount((m) => m.kind === "export");
      const id = await userId(call);
      const zips = () =>
        [...files.objects.keys()].filter((k) =>
          k.startsWith(`users/${id}/exports/`)
        );
      const [first] = zips();
      await db.query(
        `update library_export set requested_at = now() - interval '2 hours' where user_id = $1`,
        [id]
      );
      expect(
        (await call("/api/account/export", { method: "POST" })).status
      ).toBe(202);
      await deliverAccount((m) => m.kind === "export");
      expect(zips()).toHaveLength(2);
      // Due once a builder of the old export must have stopped.
      await db.query(
        `update object_removal set due_at = now() where key = $1`,
        [first]
      );
      await sweepAccounts(env());
      expect(zips()).toHaveLength(1);
      expect(zips()).not.toContain(first);
    });

    it("removes an export once it expires", async () => {
      const { call } = await signInAs(email());
      await call("/api/account/export", { method: "POST" });
      await deliverAccount((m) => m.kind === "export");
      const id = await userId(call);
      const zips = () =>
        [...files.objects.keys()].filter((k) =>
          k.startsWith(`users/${id}/exports/`)
        );
      expect(zips()).toHaveLength(1);
      await db.query(
        `update library_export set ready_at = now() - interval '25 hours' where user_id = $1`,
        [id]
      );
      await sweepAccounts(env());
      expect(zips()).toEqual([]);
      expect(await exportOf(call)).toBeNull();
      expect((await call("/api/account/export/download")).status).toBe(404);
    });

    it("sends only its share of stalled exports", async () => {
      const first = await signInAs(email());
      const second = await signInAs(email());
      expect(
        (await first.call("/api/account/export", { method: "POST" })).status
      ).toBe(202);
      expect(
        (await second.call("/api/account/export", { method: "POST" })).status
      ).toBe(202);
      const ids = [await userId(first.call), await userId(second.call)];
      await db.query(
        `update library_export set requested_at = now() - interval '2 hours'
         where user_id = $1 or user_id = $2`,
        ids
      );
      const sent = () =>
        accountQueue.sent.filter((message) => message.body.kind === "export")
          .length;
      const before = sent();
      await sweepAccounts(env(), cronCalls(4));
      expect(sent() - before).toBe(1);
    });
  });

  describe("deletion", () => {
    it("makes every session of an account being deleted useless at once", async () => {
      // A session that slipped past the sign-in check: the request is
      // recorded, the session row still exists.
      const { call } = await signInAs(email());
      await captureText(call, "Before");
      await db.query(`insert into account_deletion (user_id) values ($1)`, [
        await userIdFromDb(call),
      ]);
      for (const [method, path] of [
        ["GET", "/api/me"],
        ["GET", "/api/memories"],
        ["POST", "/api/memories"],
        ["GET", "/api/account/sessions"],
        ["POST", "/api/account/export"],
      ] as const) {
        const res = await call(path, {
          method,
          json: method === "POST" ? { body: "After" } : undefined,
        });
        expect(res.status, path).toBe(401);
      }
    });

    it("ends a session whose sign-in raced the request, and refuses that sign-in", async () => {
      const address = email();
      const first = await signInAs(address);
      const id = await userId(first.call);
      // The request commits between the sign-in's check and its insert: a
      // trigger records it just as the session row goes in.
      await db.query(`
        create or replace function t28_race() returns trigger as $$
        begin
          insert into account_deletion (user_id) values (new.user_id) on conflict do nothing;
          return new;
        end $$ language plpgsql;
        create trigger t28_race before insert on session
          for each row when (new.user_id = '${id}') execute function t28_race();`);
      try {
        const racing = await signInAs(address);
        expect(racing.status).toBe(403);
        expect(await me(racing.call)).toBe(401);
        const { rows } = await db.query(
          `select 1 from session where user_id = $1`,
          [id]
        );
        // The first session is still there (no request wiped it here), but
        // the racing one is gone.
        expect(rows).toHaveLength(1);
      } finally {
        await db.query(
          `drop trigger t28_race on session; drop function t28_race();`
        );
      }
    });

    it("needs the account's address typed to confirm", async () => {
      const { call } = await signInAs(email());
      for (const json of [{ email: "someone@example.com" }, {}]) {
        const res = await call("/api/account", { method: "DELETE", json });
        expect(res.status).toBe(400);
      }
      expect(await me(call)).toBe(200);
    });

    it("removes every row and file of the person, and nothing of anyone else", async () => {
      const address = email();
      const { call } = await signInAs(address);
      const phone = await signInAs(address, SAFARI_IPHONE);
      const id = await userId(call);
      await captureText(call, "Cardamom buns");
      await captureImage(call);
      await call("/api/account/export", { method: "POST" });
      await deliverAccount((m) => m.kind === "export");
      // An upload that landed without ever being confirmed.
      await files.put(`users/${id}/stray/original`, new ArrayBuffer(4), {
        httpMetadata: { contentType: "image/png", cacheControl: "" },
      });

      const ben = await signInAs(email());
      const bens = await captureImage(ben.call);
      const benId = await userId(ben.call);
      const benObjects = [...files.objects.keys()].filter((k) =>
        k.startsWith(`users/${benId}/`)
      );

      const res = await call("/api/account", {
        method: "DELETE",
        json: { email: ` ${address.toUpperCase()} ` },
      });
      expect(res.status).toBe(204);
      expect(res.headers.getSetCookie().join()).toMatch(/Max-Age=0/);
      expect(await me(call)).toBe(401);
      expect(await me(phone.call)).toBe(401);
      // Nobody signs in as them while the deletion runs.
      const blocked = await signInAs(address);
      expect(blocked.status).toBe(403);

      // First pass: files and Memories go; the account waits out the grace period.
      const [first] = await deliverAccount((m) => m.kind === "delete");
      expect(first!.ack).toHaveBeenCalled();
      expect(accountQueue.sent).toContainEqual({
        body: { kind: "delete", userId: id },
        delaySeconds: 21 * 60,
      });
      const mine = () =>
        [...files.objects.keys()].filter((k) => k.includes(id));
      expect(mine()).toEqual([]);

      await db.query(
        `update account_deletion set requested_at = now() - interval '21 minutes' where user_id = $1`,
        [id]
      );
      await deliverAccount((m) => m.kind === "delete" && m.userId === id);

      // Nothing of the person remains in any table, or in storage.
      const { rows: columns } = await db.query<{
        table_name: string;
        column_name: string;
      }>(
        `select table_name, column_name from information_schema.columns
         where table_schema = 'public' and data_type = 'text'`
      );
      for (const { table_name, column_name } of columns) {
        const { rows } = await db.query<{ n: number }>(
          `select count(*)::int as n from "${table_name}" where "${column_name}" = $1 or "${column_name}" like $2`,
          [id, `%${address}%`]
        );
        expect(rows[0]!.n, `${table_name}.${column_name}`).toBe(0);
      }
      expect(mine()).toEqual([]);

      // Ben is untouched.
      expect((await ben.call(`/api/memories/${bens}`)).status).toBe(200);
      expect(
        [...files.objects.keys()].filter((k) => k.startsWith(`users/${benId}/`))
      ).toEqual(benObjects);

      // The address can start again, as a new, empty account.
      const fresh = await signInAs(address);
      expect(fresh.status).toBe(200);
      expect(await userId(fresh.call)).not.toBe(id);
      const list = await (await fresh.call("/api/memories")).json();
      expect(list).toMatchObject({ memories: [] });
    });
  });

  describe("cross-site requests", () => {
    const from = (
      call: Call,
      path: string,
      method: string,
      origin?: string
    ) => {
      const headers = new Headers({
        cookie: call.cookie(),
        "content-type": "application/json",
        "cf-connecting-ip": "10.1.2.3",
      });
      if (origin) headers.set("origin", origin);
      return worker.fetch(
        new Request<unknown, IncomingRequestCfProperties>(`${ORIGIN}${path}`, {
          method,
          headers,
          body:
            method === "GET"
              ? undefined
              : JSON.stringify({ body: "x", email: "x" }),
        }),
        env(),
        ctx
      );
    };

    it("refuses every state change from another origin, or with none, and still serves reads", async () => {
      const { call } = await signInAs(email());
      const changes = [
        ["POST", "/api/account/export"],
        ["POST", "/api/account/sign-out-everywhere"],
        ["DELETE", "/api/account/sessions/0123456789abcdef"],
        ["DELETE", "/api/account"],
        ["POST", "/api/memories"],
        ["DELETE", `/api/memories/${crypto.randomUUID()}`],
      ] as const;
      for (const origin of [
        "https://evil.example",
        "http://localhost:8787.evil.example",
        undefined,
      ]) {
        for (const [method, path] of changes) {
          const res = await from(call, path, method, origin);
          expect(res.status, `${method} ${path} from ${origin}`).toBe(403);
        }
      }
      expect(await me(call)).toBe(200);
      expect((await from(call, "/api/account/sessions", "GET")).status).toBe(
        200
      );
      expect(
        (await from(call, "/api/account/export", "POST", ORIGIN)).status
      ).toBe(202);
    });
  });
});
