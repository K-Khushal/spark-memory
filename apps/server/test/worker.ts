import { afterEach, beforeEach, vi } from "vitest";
import worker from "../src/index";
import type {
  AccountMessage,
  AccountQueue,
  Bindings,
  DeepFetchMessage,
  DeepFetchQueue,
  FileBucket,
  IndexMessage,
  IndexQueue,
} from "../src/env";

// Integration test through the Worker's HTTP interface, against real Postgres
// with migrations applied. Turnstile's siteverify is the one faked boundary.
export const databaseUrl = process.env.DATABASE_URL;
export const ORIGIN = "http://localhost:8787";

export const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

type Stored = {
  body: ArrayBuffer;
  size: number;
  httpMetadata: {
    contentType?: string;
    cacheControl?: string;
    contentDisposition?: string;
  };
};

/** An in-memory stand-in for the R2 bucket binding (the other faked boundary). */
export function memoryBucket() {
  const objects = new Map<string, Stored>();
  const bucket: FileBucket = {
    head: async (key) => objects.get(key) ?? null,
    get: async (key) => {
      const o = objects.get(key);
      return o ? { ...o, body: new Response(o.body).body! } : null;
    },
    put: async (key, body, { httpMetadata }) => {
      objects.set(key, { body, size: body.byteLength, httpMetadata });
    },
    delete: async (keys) => {
      for (const key of [keys].flat()) objects.delete(key);
    },
    list: async ({ prefix, limit = 1000 }) => {
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
      return {
        objects: keys.slice(0, limit).map((key) => ({ key })),
        truncated: keys.length > limit,
      };
    },
    // As R2: every part but the last the same size; nothing shows until complete.
    createMultipartUpload: async (key, { httpMetadata }) => {
      const parts = new Map<number, Uint8Array>();
      return {
        uploadPart: async (partNumber, value) => {
          parts.set(partNumber, value.slice());
          return { partNumber, etag: `etag-${partNumber}` };
        },
        complete: async (done) => {
          const sizes = done.map((p) => parts.get(p.partNumber)!.length);
          if (sizes.slice(0, -1).some((n) => n !== sizes[0])) {
            throw new Error("parts must be the same size but the last");
          }
          const body = new Uint8Array(sizes.reduce((a, b) => a + b, 0));
          let at = 0;
          for (const p of done) {
            body.set(parts.get(p.partNumber)!, at);
            at += parts.get(p.partNumber)!.length;
          }
          objects.set(key, {
            body: body.buffer,
            size: body.length,
            httpMetadata,
          });
        },
        abort: async () => parts.clear(),
      };
    },
  };
  return Object.assign(bucket, { objects });
}

export const files = memoryBucket();

/** A queue that keeps what was sent, for a test to deliver (the third faked boundary). */
export function recordingQueue(name: string) {
  const sent: { body: IndexMessage; delaySeconds?: number }[] = [];
  const queue: IndexQueue = {
    send: async (body, options) => {
      sent.push({ body, delaySeconds: options?.delaySeconds });
    },
    sendBatch: async (messages) => {
      for (const { body, delaySeconds } of messages) {
        sent.push({ body, delaySeconds });
      }
    },
  };
  return Object.assign(queue, { name, sent });
}

/** The Deep fetch queue, kept for a test to deliver. */
export const deepFetchQueue = Object.assign(
  {
    send: async (
      body: DeepFetchMessage,
      options?: { delaySeconds?: number }
    ) => {
      deepFetchQueue.sent.push({ body, delaySeconds: options?.delaySeconds });
    },
  } satisfies DeepFetchQueue,
  { sent: [] as { body: DeepFetchMessage; delaySeconds?: number }[] }
);

/** Delivers (once each) the Deep fetch messages sent so far for `memoryId`. */
export async function drainDeepFetch(memoryId: string, bindings = env()) {
  const mine = deepFetchQueue.sent.filter((m) => m.body.memoryId === memoryId);
  deepFetchQueue.sent = deepFetchQueue.sent.filter((m) => !mine.includes(m));
  const messages = mine.map(({ body }) => ({
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  }));
  for (const message of messages) {
    await worker.queue(
      {
        queue: "spark-deepfetch-local",
        messages: [message],
      } as unknown as MessageBatch<DeepFetchMessage>,
      bindings
    );
  }
  return messages;
}

export const queues = {
  fresh: recordingQueue("spark-index-local"),
  background: recordingQueue("spark-reindex-local"),
};

/** The account queue, kept for a test to deliver. */
export const accountQueue = Object.assign(
  {
    send: async (body: AccountMessage, options?: { delaySeconds?: number }) => {
      accountQueue.sent.push({ body, delaySeconds: options?.delaySeconds });
    },
  } satisfies AccountQueue,
  { sent: [] as { body: AccountMessage; delaySeconds?: number }[] }
);

/** Delivers (once each) the account messages sent so far that match `which`. */
export async function deliverAccount(
  which: (body: AccountMessage) => boolean,
  bindings = env()
) {
  const mine = accountQueue.sent.filter((m) => which(m.body));
  accountQueue.sent = accountQueue.sent.filter((m) => !mine.includes(m));
  const messages = mine.map(({ body }) => ({
    body,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  }));
  await worker.queue(
    {
      queue: "spark-account-local",
      messages,
    } as unknown as MessageBatch<AccountMessage>,
    bindings
  );
  return messages;
}

/** One delivery of `body` to the consumer, as Cloudflare Queues would make it. */
export async function deliver(
  queue: string,
  body: IndexMessage,
  attempts = 1,
  bindings = env()
) {
  const message = { body, attempts, ack: vi.fn(), retry: vi.fn() };
  await worker.queue(
    { queue, messages: [message] } as unknown as MessageBatch<IndexMessage>,
    bindings
  );
  return message;
}

/** Delivers (once each) every message sent so far for `memoryId`, fresh first. */
export async function drain(memoryId: string, bindings = env()) {
  const delivered = [];
  for (const queue of [queues.fresh, queues.background]) {
    const mine = queue.sent.filter((m) => m.body.memoryId === memoryId);
    queue.sent.splice(
      0,
      queue.sent.length,
      ...queue.sent.filter((m) => !mine.includes(m))
    );
    for (const { body } of mine) {
      delivered.push(await deliver(queue.name, body, 1, bindings));
    }
  }
  return delivered;
}

export function env(overrides: Partial<Bindings> = {}): Bindings {
  return {
    HYPERDRIVE: { connectionString: databaseUrl! },
    FILES: files,
    INDEX_QUEUE: queues.fresh,
    REINDEX_QUEUE: queues.background,
    ACCOUNT_QUEUE: accountQueue,
    DEEP_FETCH_QUEUE: deepFetchQueue,
    INDEXING_PROVIDER: "fake",
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
    init: {
      method?: string;
      headers?: HeadersInit;
      json?: unknown;
      form?: Record<string, string>;
    } = {},
    bindings = env()
  ) {
    const headers = new Headers(init.headers);
    headers.set("cf-connecting-ip", address);
    headers.set("origin", origin);
    if (cookie) headers.set("cookie", cookie);
    if (init.json !== undefined)
      headers.set("content-type", "application/json");
    if (init.form)
      headers.set("content-type", "application/x-www-form-urlencoded");
    const res = await worker.fetch(
      new Request<unknown, IncomingRequestCfProperties>(`${origin}${path}`, {
        method: init.method,
        headers,
        body: init.form
          ? new URLSearchParams(init.form).toString()
          : init.json === undefined
            ? undefined
            : JSON.stringify(init.json),
      }),
      bindings,
      ctx
    );
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) {
      const jar = new Map(
        cookie
          .split("; ")
          .filter(Boolean)
          .map((v) => [v.slice(0, v.indexOf("=")), v])
      );
      for (const entry of set) {
        const pair = entry.split(";")[0]!;
        jar.set(pair.slice(0, pair.indexOf("=")), pair);
      }
      cookie = [...jar.values()].join("; ");
    }
    return res;
  }
  return Object.assign(call, { cookie: () => cookie });
}

/** `POST /api/search`: words and chips travel in the body, never in a URL. */
export const postSearch = (
  call: ReturnType<typeof newClient>,
  body: Record<string, unknown>,
  bindings?: ReturnType<typeof env>
) => call("/api/search", { method: "POST", json: body }, bindings);

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
