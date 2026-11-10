import { afterEach, beforeEach, vi } from "vitest";
import worker from "../src/index";
import type { Bindings } from "../src/env";

// Integration test through the Worker's HTTP interface, against real Postgres
// with migrations applied. Turnstile's siteverify is the one faked boundary.
export const databaseUrl = process.env.DATABASE_URL;
export const ORIGIN = "http://localhost:8787";

export const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

export function env(overrides: Partial<Bindings> = {}): Bindings {
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
export function newClient(origin = ORIGIN) {
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

export const email = () => `person-${crypto.randomUUID()}@example.com`;

export function sendCode(
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

export async function lastCode(
  call: ReturnType<typeof newClient>,
  address: string
) {
  const res = await call(
    `/api/dev/sign-in-code?email=${encodeURIComponent(address)}`
  );
  return ((await res.json()) as { code: string }).code;
}

/** Signs a new person in; returns their client and address. */
export async function signedIn() {
  const call = newClient();
  const address = email();
  await sendCode(call, address);
  await call("/api/auth/sign-in/email-otp", {
    method: "POST",
    json: { email: address, otp: await lastCode(call, address) },
  });
  return { call, address };
}

/** Fakes Turnstile's siteverify (always passes) for every test in the file. */
export function fakeTurnstile() {
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
}
