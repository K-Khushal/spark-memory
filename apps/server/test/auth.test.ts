import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Client } from "pg";
import worker from "../src/index";
import type { Bindings } from "../src/env";

// Integration test through the Worker's HTTP interface, against real Postgres
// with migrations applied. Turnstile's siteverify is the one faked boundary.
const databaseUrl = process.env.DATABASE_URL;
const ORIGIN = "http://localhost:8787";

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

function env(overrides: Partial<Bindings> = {}): Bindings {
  return {
    HYPERDRIVE: { connectionString: databaseUrl! },
    SPARK_ENV: "local",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
    BETTER_AUTH_URL: ORIGIN,
    TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    ...overrides,
  };
}

const octet = () => Math.floor(Math.random() * 254) + 1;

/** A client with its own cookie jar and a random IP, so rate limits never leak between tests. */
function newClient(origin = ORIGIN) {
  const address = `10.${octet()}.${octet()}.${octet()}`;
  let cookie = "";
  async function call(
    path: string,
    init: { method?: string; headers?: HeadersInit; json?: unknown } = {},
    bindings = env()
  ) {
    const headers = new Headers(init.headers);
    headers.set("cf-connecting-ip", address);
    headers.set("origin", origin);
    if (cookie) headers.set("cookie", cookie);
    if (init.json !== undefined)
      headers.set("content-type", "application/json");
    const res = await worker.fetch(
      new Request<unknown, IncomingRequestCfProperties>(`${origin}${path}`, {
        method: init.method,
        headers,
        body: init.json === undefined ? undefined : JSON.stringify(init.json),
      }),
      bindings,
      ctx
    );
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
    return res;
  }
  return Object.assign(call, { cookie: () => cookie });
}

const email = () => `person-${crypto.randomUUID()}@example.com`;

function sendCode(
  call: ReturnType<typeof newClient>,
  address: string,
  bindings = env()
) {
  return call(
    "/api/auth/email-otp/send-verification-otp",
    {
      method: "POST",
      headers: { "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" },
      json: { email: address, type: "sign-in" },
    },
    bindings
  );
}

async function lastCode(call: ReturnType<typeof newClient>, address: string) {
  const res = await call(
    `/api/dev/sign-in-code?email=${encodeURIComponent(address)}`
  );
  return ((await res.json()) as { code: string }).code;
}

/** Signs a new person in; returns their client and address. */
async function signedIn() {
  const call = newClient();
  const address = email();
  await sendCode(call, address);
  await call("/api/auth/sign-in/email-otp", {
    method: "POST",
    json: { email: address, otp: await lastCode(call, address) },
  });
  return { call, address };
}

beforeEach(() => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("challenges.cloudflare.com")) {
      return Response.json({ success: true, hostname: "localhost" });
    }
    return realFetch(input, init);
  });
});
afterEach(() => vi.restoreAllMocks());

describe.skipIf(!databaseUrl)("sign-in with an email code", () => {
  it("signs a new user in, on the Free plan, and keeps the session", async () => {
    const call = newClient();
    const address = email();
    expect((await sendCode(call, address)).status).toBe(200);

    const signIn = await call("/api/auth/sign-in/email-otp", {
      method: "POST",
      json: { email: address, otp: await lastCode(call, address) },
    });
    expect(signIn.status).toBe(200);

    const me = await call("/api/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ email: address, plan: "free" });
  });

  it("rejects a wrong code", async () => {
    const call = newClient();
    const address = email();
    await sendCode(call, address);
    const code = await lastCode(call, address);
    const res = await call("/api/auth/sign-in/email-otp", {
      method: "POST",
      json: { email: address, otp: code === "000000" ? "111111" : "000000" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_OTP" });
    expect((await call("/api/me")).status).toBe(401);
  });

  it("refuses to send a code without a Turnstile token", async () => {
    const call = newClient();
    const res = await call("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      json: { email: email(), type: "sign-in" },
    });
    expect(res.status).toBe(400);
  });

  it("refuses to send a code when Turnstile says no", async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async () =>
      Response.json({
        success: false,
        "error-codes": ["invalid-input-response"],
      })
    );
    const res = await sendCode(newClient(), email());
    expect(res.status).toBe(403);
  });

  it("rate limits code requests per IP", async () => {
    const call = newClient();
    const statuses = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await sendCode(call, email())).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("signs out", async () => {
    const call = newClient();
    const address = email();
    await sendCode(call, address);
    await call("/api/auth/sign-in/email-otp", {
      method: "POST",
      json: { email: address, otp: await lastCode(call, address) },
    });
    expect(
      (await call("/api/auth/sign-out", { method: "POST", json: {} })).status
    ).toBe(200);
    expect((await call("/api/me")).status).toBe(401);
  });
});

describe.skipIf(!databaseUrl)("protected API routes", () => {
  it("rejects anonymous requests", async () => {
    const res = await newClient()("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
  });
});

describe.skipIf(!databaseUrl)("GET /api/sign-in-options", () => {
  it("lists only the social providers with both keys set", async () => {
    const res = await newClient()(
      "/api/sign-in-options",
      {},
      env({
        GITHUB_CLIENT_ID: "id",
        GITHUB_CLIENT_SECRET: "secret",
        GOOGLE_CLIENT_ID: "id",
      })
    );
    expect(await res.json()).toEqual({
      socialProviders: ["github"],
      turnstileSiteKey: "1x00000000000000000000AA",
    });
  });
});

describe.skipIf(!databaseUrl)("the dev sign-in code outbox", () => {
  it("does not exist outside local development", async () => {
    for (const SPARK_ENV of ["dev", "production"] as const) {
      const res = await newClient()(
        "/api/dev/sign-in-code?email=a@example.com",
        {},
        env({ SPARK_ENV, RESEND_API_KEY: "re_test" })
      );
      expect(res.status).toBe(404);
    }
  });

  it("does not exist on a public host, even with the local vars", async () => {
    const res = await worker.fetch(
      new Request<unknown, IncomingRequestCfProperties>(
        "https://spark.example/api/dev/sign-in-code?email=a@example.com"
      ),
      env(),
      ctx
    );
    expect(res.status).toBe(404);
  });
});

describe.skipIf(!databaseUrl)("passwordless only", () => {
  const closed = [
    "/api/auth/sign-up/email",
    "/api/auth/sign-in/email",
    "/api/auth/forget-password",
    "/api/auth/request-password-reset",
    "/api/auth/reset-password",
    "/api/auth/change-password",
    "/api/auth/set-password",
    "/api/auth/forget-password/email-otp",
    "/api/auth/email-otp/request-password-reset",
    "/api/auth/email-otp/reset-password",
    "/api/auth/email-otp/check-verification-otp",
    "/api/auth/email-otp/verify-email",
    "/api/auth/email-otp/request-email-change",
    "/api/auth/email-otp/change-email",
    "/api/auth/send-verification-email",
    "/api/auth/change-email",
    "/api/auth/update-user",
    "/api/auth/delete-user",
  ];

  it("closes every password, reset and account-editing route", async () => {
    const call = newClient();
    const json = {
      email: email(),
      password: "a-password-1234",
      newPassword: "a-password-1234",
      otp: "123456",
      name: "Person",
    };
    for (const path of closed) {
      const res = await call(path, {
        method: "POST",
        headers: { "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" },
        json,
      });
      expect(res.status, path).toBe(404);
    }
  });

  it("sends codes only for signing in", async () => {
    for (const type of [
      "forget-password",
      "email-verification",
      "change-email",
    ]) {
      const res = await newClient()(
        "/api/auth/email-otp/send-verification-otp",
        {
          method: "POST",
          headers: { "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" },
          json: { email: email(), type },
        }
      );
      expect(res.status, type).toBe(400);
    }
  });
});

describe.skipIf(!databaseUrl)("session cookies", () => {
  const deployed = (overrides: Partial<Bindings> = {}) =>
    env({
      SPARK_ENV: "dev",
      BETTER_AUTH_URL: "https://spark.example",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "Spark <a@spark.example>",
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
      ...overrides,
    });

  it("are Secure outside local development", async () => {
    const call = newClient("https://spark.example");
    const res = await call(
      "/api/auth/sign-in/social",
      {
        method: "POST",
        headers: { "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" },
        json: { provider: "github", callbackURL: "/" },
      },
      deployed()
    );
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) expect(cookie).toMatch(/;\s*Secure/i);
  });

  it("refuse to start outside local development without an https BETTER_AUTH_URL", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const BETTER_AUTH_URL of [undefined, "http://spark.example"]) {
      const res = await newClient("https://spark.example")(
        "/api/auth/get-session",
        {},
        deployed({ BETTER_AUTH_URL })
      );
      expect(res.status, String(BETTER_AUTH_URL)).toBe(500);
    }
    log.mockRestore();
  });
});

describe.skipIf(!databaseUrl)("logs when the database fails", () => {
  it("never contain a session token, email or code", async () => {
    const { call, address } = await signedIn();
    const cookie = call.cookie();
    const token = decodeURIComponent(cookie.split("=")[1] ?? "").split(".")[0]!;
    expect(token.length).toBeGreaterThan(10);

    const logged: unknown[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args) => {
        logged.push(...args);
      });
    }
    const down = env({
      HYPERDRIVE: {
        connectionString: "postgres://spark:spark@127.0.0.1:1/spark",
      },
    });
    await call("/api/me", {}, down);
    await call("/api/auth/get-session", {}, down);
    await sendCode(call, address, down);
    await call(
      "/api/auth/sign-in/email-otp",
      {
        method: "POST",
        json: { email: address, otp: "123456" },
      },
      down
    );

    const text = logged
      .map((x) =>
        x instanceof Error
          ? `${x.message} ${x.stack} ${JSON.stringify(x)}`
          : typeof x === "string"
            ? x
            : JSON.stringify(x)
      )
      .join("\n");
    expect(text).toContain("refused");
    expect(text).not.toContain(token);
    expect(text).not.toContain(address);
    expect(text).not.toContain("123456");
  });
});

/** Collects everything printed through any console method. */
function captureConsole() {
  const logged: unknown[] = [];
  for (const level of [
    "log",
    "info",
    "warn",
    "error",
    "debug",
    "trace",
  ] as const) {
    vi.spyOn(console, level).mockImplementation((...args) => {
      logged.push(...args);
    });
  }
  return () =>
    logged
      .map((x) =>
        x instanceof Error
          ? `${x.message} ${x.stack} ${JSON.stringify(x)} ${String(x.cause)}`
          : typeof x === "string"
            ? x
            : JSON.stringify(x)
      )
      .join("\n");
}

// Real Postgres failures whose messages carry the secret, raised by triggers
// that fire only for these tests' addresses.
const LEAK = "LEAKED-VALUE";
describe.skipIf(!databaseUrl)(
  "logs when writing a session or user fails",
  () => {
    const db = new Client({ connectionString: databaseUrl });
    beforeAll(async () => {
      await db.connect();
      await db.query(`
      create or replace function spark_test_fail_user() returns trigger as $$
      begin
        if new.email like 'leak-user-%' then
          raise exception '${LEAK} user %', new.email;
        end if;
        return new;
      end $$ language plpgsql;
      create or replace function spark_test_fail_session() returns trigger as $$
      begin
        if exists (select 1 from "user" where id = new.user_id and email like 'leak-session-%') then
          raise exception '${LEAK} session %', new.token;
        end if;
        return new;
      end $$ language plpgsql;
      drop trigger if exists spark_test_fail_user on "user";
      create trigger spark_test_fail_user before insert on "user"
        for each row execute function spark_test_fail_user();
      drop trigger if exists spark_test_fail_session on "session";
      create trigger spark_test_fail_session before insert on "session"
        for each row execute function spark_test_fail_session();
    `);
    });
    afterAll(async () => {
      await db.query(`
      drop trigger if exists spark_test_fail_user on "user";
      drop trigger if exists spark_test_fail_session on "session";
      drop function if exists spark_test_fail_user();
      drop function if exists spark_test_fail_session();
    `);
      await db.end();
    });

    it("creating the user while signing in by code", async () => {
      const call = newClient();
      const address = `leak-user-${crypto.randomUUID()}@example.com`;
      await sendCode(call, address);
      const otp = await lastCode(call, address);
      const printed = captureConsole();
      const res = await call("/api/auth/sign-in/email-otp", {
        method: "POST",
        json: { email: address, otp },
      });
      expect(res.status).toBe(500);
      expect(printed()).not.toContain(LEAK);
      expect(printed()).not.toContain(address);
    });

    it("creating the session while signing in by code", async () => {
      const address = `leak-session-${crypto.randomUUID()}@example.com`;
      await db.query(
        `insert into "user" (id, name, email, email_verified, updated_at) values ($1, '', $2, true, now())`,
        [crypto.randomUUID(), address]
      );
      const call = newClient();
      await sendCode(call, address);
      const otp = await lastCode(call, address);
      const printed = captureConsole();
      const res = await call("/api/auth/sign-in/email-otp", {
        method: "POST",
        json: { email: address, otp },
      });
      expect(res.status).toBe(500);
      expect(printed()).not.toContain(LEAK);
      expect(printed()).not.toContain(address);
    });

    it("creating the user in the GitHub callback", async () => {
      const address = `leak-user-${crypto.randomUUID()}@example.com`;
      const github = env({
        GITHUB_CLIENT_ID: "id",
        GITHUB_CLIENT_SECRET: "secret",
      });
      const realFetch = vi.mocked(globalThis.fetch).getMockImplementation()!;
      vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.startsWith("https://github.com/login/oauth/access_token")) {
          return Response.json({
            access_token: "gho_test",
            token_type: "bearer",
            scope: "user:email",
          });
        }
        if (url === "https://api.github.com/user") {
          return Response.json({
            id: 4242,
            login: "leak",
            name: "Leak",
            email: address,
            avatar_url: "",
          });
        }
        if (url === "https://api.github.com/user/emails") {
          return Response.json([
            { email: address, primary: true, verified: true },
          ]);
        }
        return realFetch(input, init);
      });

      const call = newClient();
      const start = await call(
        "/api/auth/sign-in/social",
        {
          method: "POST",
          headers: { "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" },
          json: { provider: "github", callbackURL: "/" },
        },
        github
      );
      const { url } = (await start.json()) as { url: string };
      const state = new URL(url).searchParams.get("state")!;

      const printed = captureConsole();
      const res = await call(
        `/api/auth/callback/github?code=abc&state=${state}`,
        {},
        github
      );
      expect(res.headers.get("location")).toContain(
        "error=unable_to_create_user"
      );
      expect(printed()).not.toContain(LEAK);
      expect(printed()).not.toContain(address);
    });
  }
);
