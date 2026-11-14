/** Local, synthetic 10k-Library benchmark. See docs/reviews/t36b-performance.md. */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { chromium, expect, type Request } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { embeddingSpace } from "@spark/core";
import { indexingStore, openDatabase, openLibrary, schema } from "@spark/db";
import { createIndexer, fakeEmbedder, fakeProvider } from "@spark/indexing";
import { createSearch, forgetQueryVectors } from "@spark/search";
import {
  perfDatabaseUrl,
  requireFakeIndexing,
  requireWorkerDatabase,
} from "./guard";
import { percentile } from "../src/latency";

// Read the explicit opt-in first. Never import setup.ts: it loads .env into process.env.
const explicitDatabaseUrl = process.env.PERF_DATABASE_URL;
const rootEnv = new URL("../../.env", import.meta.url);
const devDatabaseUrl = existsSync(rootEnv)
  ? parseEnv(readFileSync(rootEnv, "utf8")).DATABASE_URL
  : undefined;
const databaseUrl = perfDatabaseUrl(explicitDatabaseUrl, devDatabaseUrl);

const baseURL = process.env.PERF_BASE_URL ?? "http://localhost:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname))
  throw new Error(
    "perf only runs against a local stack with INDEXING_PROVIDER=fake"
  );
const size = Number(process.env.PERF_MEMORIES ?? 10_000);
const runs = Number(process.env.PERF_RUNS ?? 40);
if (
  !Number.isInteger(size) ||
  size < 100 ||
  !Number.isInteger(runs) ||
  runs < 20
)
  throw new Error("PERF_MEMORIES must be >=100; PERF_RUNS must be >=20");
const output = resolve(process.env.PERF_OUTPUT ?? "perf-results.json");
const phase = process.env.PERF_PHASE ?? "after";
const topics = [
  "Sunset over the dock",
  "Sourdough baking schedule",
  "Kyoto walking itinerary",
  "Marathon training plan",
  "Tomato soup recipe",
  "Git log commands",
  "Interview questions",
  "Hallway paint sage",
  "दाल recipe",
  "猫 illustration",
];
const queries = [
  "sunset",
  "twilight harbor",
  "sourdough",
  "sourdogh",
  "kyoto",
  "marathon",
  "tomato soup",
  "git log",
  "दाल",
  "zzqx nothing here",
];
const summary = (values: number[]) => ({
  n: values.length,
  p50: percentile(values, 0.5),
  p95: percentile(values, 0.95),
  max: Math.max(...values),
});
async function time<T>(values: number[], fn: () => Promise<T>) {
  const start = performance.now();
  const value = await fn();
  values.push(performance.now() - start);
  return value;
}
const { db, close } = openDatabase(databaseUrl);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL });
const page = await context.newPage();
let userId: string | undefined;
try {
  const stack = await context.request.get("/api/dev/indexing-provider", {
    timeout: 15_000,
  });
  if (!stack.ok())
    throw new Error(
      "perf requires a local Worker exposing /api/dev/indexing-provider"
    );
  const config = (await stack.json()) as {
    provider?: unknown;
    jevEnabled?: unknown;
    database?: unknown;
  };
  requireFakeIndexing(config.provider, config.jevEnabled);
  requireWorkerDatabase(databaseUrl, config.database);
  const address = `perf-${crypto.randomUUID()}@example.test`;
  const headers = {
    origin: baseURL,
    "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX",
  };
  const sent = await context.request.post(
    "/api/auth/email-otp/send-verification-otp",
    { headers, data: { email: address, type: "sign-in" }, timeout: 15_000 }
  );
  if (!sent.ok()) throw new Error(`local sign-in failed: ${sent.status()}`);
  const { code } = (await (
    await context.request.get(
      `/api/dev/sign-in-code?email=${encodeURIComponent(address)}`
    )
  ).json()) as { code: string };
  const signed = await context.request.post("/api/auth/sign-in/email-otp", {
    headers,
    data: { email: address, otp: code },
  });
  if (!signed.ok()) throw new Error(`local sign-in failed: ${signed.status()}`);
  const [owner] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, address));
  if (!owner)
    throw new Error("stack and PERF_DATABASE_URL must use the same database");
  userId = owner.id;
  const embedder = fakeEmbedder();
  const library = openLibrary(db, userId, {
    vectorsSpace: embeddingSpace(embedder.model, embedder.dimensions),
  });
  // The daily AI budget protects users, not this throwaway Library.
  const store = indexingStore(db, {
    budget: async () => Number.MAX_SAFE_INTEGER,
    ownerBudgetShare: 1,
  });
  const indexer = createIndexer({
    store,
    providers: [fakeProvider()],
    embedder,
    readFile: async () => undefined,
  });
  console.log(`Seeding ${size} synthetic text Memories through fake Indexing`);
  for (let offset = 0; offset < size; offset += 100) {
    const rows = await db
      .insert(schema.memory)
      .values(
        Array.from({ length: Math.min(100, size - offset) }, (_, j) => ({
          userId: owner.id,
          kind: "text" as const,
          body: `${topics[(offset + j) % topics.length]} reference ${offset + j}`,
        }))
      )
      .returning({ id: schema.memory.id, run: schema.memory.indexRun });
    // Five connections in openDatabase; bounded batches avoid overwhelming Postgres.
    for (let start = 0; start < rows.length; start += 4)
      await Promise.all(
        rows.slice(start, start + 4).map(async ({ id, run }) => {
          const outcome = await indexer.index({
            memoryId: id,
            run,
            priority: "fresh",
            attempt: 1,
          });
          if (outcome.result !== "searchable")
            throw new Error(`seed Indexing: ${outcome.result}`);
        })
      );
    if ((offset + 100) % 1000 === 0) console.log(`Indexed ${offset + 100}`);
  }
  await db.execute(sql`analyze memory`);
  await db.execute(sql`analyze memory_vector`);
  const counts = await db.execute(
    sql`select count(*)::int as memories, count(*) filter (where index_state = 'searchable')::int as searchable from memory where user_id = ${userId}`
  );
  const vectors = await db.execute(
    sql`select count(*)::int as vectors from memory_vector where user_id = ${userId}`
  );
  const search = createSearch({
    userId,
    find: (q, options) => library.search(q, options),
    embedder,
    spend: store,
  });
  for (const q of queries) await search.search(q, "full");
  const server = { instant: [] as number[], full: [] as number[] };
  for (let i = 0; i < runs; i++)
    for (const mode of ["instant", "full"] as const) {
      forgetQueryVectors(userId);
      const result = await time(server[mode], () =>
        search.search(queries[i % queries.length]!, mode)
      );
      if (result.mode !== mode)
        throw new Error("full search fell back; invalid measurement");
    }
  let listRequests = 0;
  let listResponses = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/api/memories" &&
      request.method() === "GET"
    )
      listRequests++;
  });
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname === "/api/memories" &&
      response.request().method() === "GET"
    )
      listResponses++;
  });
  await page.goto("/");
  await expect(page.getByRole("list", { name: "All Memories" })).toBeVisible({
    timeout: 30_000,
  });
  // useLibrary eagerly loads every 200-row page. Wait until the last page is read.
  await expect
    .poll(() => listResponses, { timeout: 120_000 })
    .toBeGreaterThanOrEqual(Math.ceil(size / 200));
  await page.waitForTimeout(500);
  const browserHttp = { instant: [] as number[], full: [] as number[] };
  for (let i = 0; i < runs; i++)
    for (const mode of ["instant", "full"] as const) {
      const elapsed = await page.evaluate(
        async ({ q, mode }) => {
          const start = performance.now();
          const res = await fetch("/api/search", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ q, mode, timezone: "UTC" }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) throw new Error(`search HTTP ${res.status}`);
          const body = (await res.json()) as { mode: string };
          if (body.mode !== mode) throw new Error("full search fell back");
          return performance.now() - start;
        },
        { q: queries[i % queries.length]!, mode }
      );
      browserHttp[mode].push(elapsed);
    }
  const ui = { instant: [] as number[], full: [] as number[] };
  // A new Library mount clears the per-mount result cache. Each query is unique here.
  await page.keyboard.press("ControlOrMeta+k");
  for (const q of queries) {
    const times: Partial<Record<"instant" | "full", number>> = {};
    const start = await page.evaluate(() => performance.now());
    const observed = async (mode: "instant" | "full") => {
      const response = await page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/search") &&
          r.request().postDataJSON()?.q === q &&
          r.request().postDataJSON()?.mode === mode,
        { timeout: 15_000 }
      );
      if (!response.ok())
        throw new Error(`menu search HTTP ${response.status()}`);
      await response.finished();
      await expect(page.getByRole("listbox")).toHaveAttribute(
        "data-search-key",
        `q:${q}`
      );
      await expect(page.getByRole("listbox")).toHaveAttribute(
        "data-search-mode",
        mode === "instant" ? /instant|full/ : "full"
      );
      // Allow React to commit and the browser to paint, not merely receive headers.
      times[mode] =
        (await page.evaluate(
          () =>
            new Promise<number>((done) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => done(performance.now()))
              )
            )
        )) - start;
    };
    const instant = observed("instant");
    const full = observed("full");
    await page.getByPlaceholder("Search…").fill(q);
    await Promise.all([instant, full]);
    ui.instant.push(times.instant!);
    ui.full.push(times.full!);
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  const scriptTime = async () =>
    (await cdp.send("Performance.getMetrics")).metrics.find(
      (m) => m.name === "ScriptDuration"
    )!.value * 1000;
  const cpuStart = await scriptTime();
  const cachedUi: number[] = [];
  let cachedRequests = 0;
  const countSearch = (request: Request) => {
    if (new URL(request.url()).pathname === "/api/search") cachedRequests++;
  };
  page.on("request", countSearch);
  for (let i = 0; i < runs; i++) {
    const q = queries[i % queries.length]!;
    await time(cachedUi, async () => {
      await page.getByPlaceholder("Search…").fill(q);
      await expect(page.getByRole("listbox")).toHaveAttribute(
        "data-search-key",
        `q:${q}`
      );
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done()))
          )
      );
    });
  }
  const cachedScriptMs = (await scriptTime()) - cpuStart;
  page.off("request", countSearch);
  const screenshots = process.env.PERF_SCREENSHOT_DIR;
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    await page.getByPlaceholder("Search…").fill("sunset");
    for (const width of [1440, 390])
      for (const theme of ["light", "dark"] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        await page.screenshot({
          path: resolve(
            screenshots,
            `t36-b-${phase}-search-${width}-${theme}.png`
          ),
        });
      }
  }
  await page.keyboard.press("Escape");
  const searchable: number[] = [];
  // Real Capture -> local Queue -> fake Indexing -> Searchable, with 100ms observation resolution.
  for (let i = 0; i < 10; i++)
    await time(searchable, async () => {
      const res = await context.request.post("/api/memories", {
        headers,
        data: { body: `Perf fresh Capture ${crypto.randomUUID()}` },
        timeout: 15_000,
      });
      if (res.status() !== 201) throw new Error(`Capture HTTP ${res.status()}`);
      const { id } = (await res.json()) as { id: string };
      await expect
        .poll(
          async () =>
            (
              (await (
                await context.request.get(`/api/memories/${id}`, {
                  timeout: 15_000,
                })
              ).json()) as { indexState: string }
            ).indexState,
          { timeout: 30_000, intervals: [100] }
        )
        .toBe("searchable");
    });
  const report = {
    phase,
    date: new Date().toISOString(),
    node: process.version,
    cpu: cpus()[0]?.model,
    fixture: {
      ...counts.rows[0],
      ...vectors.rows[0],
      provider: "fake",
      kind: "text",
      seedConcurrency: 4,
    },
    server: { instant: summary(server.instant), full: summary(server.full) },
    browserHttp: {
      instant: summary(browserHttp.instant),
      full: summary(browserHttp.full),
    },
    browserUi: {
      instant: summary(ui.instant),
      fullIncluding350msPause: summary(ui.full),
    },
    cachedUi: {
      ...summary(cachedUi),
      scriptMs: cachedScriptMs,
      requests: cachedRequests,
    },
    captureToSearchable: summary(searchable),
    listRequests,
    raw: { server, browserHttp, ui, cachedUi, searchable },
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, raw: undefined }, null, 2));
} finally {
  await browser.close();
  if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  await close();
}
