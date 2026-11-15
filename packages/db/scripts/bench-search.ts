// `pnpm --filter @spark/db bench:search`: search latency on a 1,000 Memory
// Library (PLAN.md §6.2 asks instant p95 under 100 ms; #8 asks full p95
// under 600 ms). Builds a throwaway Library next to 4,000 other people's
// Memories, each with an Overview and 1 to 3 Passage vectors (a third with
// a Visual), runs typed-as-you-go, keyword, typo and no-match queries
// through openLibrary (instant) and through @spark/search's full mode with
// a stub embedder that waits like Gemini Embedding does, and More Like
// This. Prints percentiles, then deletes everything it made. Local only.
import { inArray } from "drizzle-orm";
import { loadRootEnv } from "@spark/config/load-env";
import type { Embedder } from "@spark/indexing";
import { createSearch } from "@spark/search";
import { openDatabase, openLibrary, schema } from "../index";
import { DEMO_LIBRARY } from "./demo-library";

loadRootEnv();
const url = process.env.DATABASE_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("bench:search needs a local DATABASE_URL");
}

const LIBRARY_SIZE = 1000;
const OTHER_LIBRARIES = 4;
const RUNS = 3;
const DIMS = 768;
/** A query embedding's round trip: 150-350 ms (a guess; measure in dev). */
const PROVIDER_MS = [150, 350] as const;

// Deterministic filler so runs are comparable.
let seed = 42;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]!;
const WORDS = DEMO_LIBRARY.flatMap((m) =>
  `${m.title ?? ""} ${m.body}`.split(/\s+/)
).filter((w) => w.length > 2);
const sentence = (n: number) => Array.from({ length: n }, () => pick(WORDS));

function fakeMemory(i: number) {
  const base = DEMO_LIBRARY[i % DEMO_LIBRARY.length]!;
  return {
    title: random() < 0.6 ? sentence(4).join(" ") : null,
    body: `${base.body} ${sentence(20 + Math.floor(random() * 150)).join(" ")}`,
    captureNote: random() < 0.3 ? sentence(5).join(" ") : null,
  };
}

const unit = () => {
  const v = Array.from({ length: DIMS }, () => random() * 2 - 1);
  const length = Math.hypot(...v);
  return v.map((x) => x / length);
};

const stub: Embedder = {
  name: "gemini",
  model: "bench-embedding",
  dimensions: DIMS,
  embed: async (inputs) => {
    const [min, max] = PROVIDER_MS;
    await new Promise((r) => setTimeout(r, min + random() * (max - min)));
    return {
      vectors: inputs.map(unit),
      usage: { textTokens: 10, imageTokens: 0 },
    };
  },
};

const percentiles = (label: string, timings: number[]) => {
  timings.sort((a, b) => a - b);
  const at = (p: number) =>
    timings[Math.min(timings.length - 1, Math.floor(p * timings.length))]!;
  console.log(
    `bench:search ${label}: ${timings.length} runs, ` +
      `p50 ${at(0.5).toFixed(1)} ms, p95 ${at(0.95).toFixed(1)} ms, ` +
      `max ${at(1).toFixed(1)} ms`
  );
};

async function time<T>(timings: number[], run: () => Promise<T>) {
  const start = performance.now();
  const result = await run();
  timings.push(performance.now() - start);
  return result;
}

// What people type: each prefix of a word as they go, whole words, typos,
// several words, and things that match nothing.
const QUERIES = [
  ..."paprika".split("").map((_, i) => "paprika".slice(0, i + 1)),
  ..."sourdough schedule"
    .split("")
    .map((_, i) => "sourdough schedule".slice(0, i + 1)),
  "tomato soup",
  "marathon",
  "kyoto inari",
  "git log",
  "papricka",
  "sourdogh",
  "maraton training",
  "interveiw questions",
  "hallway paint sage",
  "दाल",
  "猫",
  "zzqx nothing here",
  "the",
];

const { db, close } = openDatabase(url);
const users = Array.from({ length: OTHER_LIBRARIES + 1 }, () =>
  crypto.randomUUID()
);
try {
  await db
    .insert(schema.user)
    .values(
      users.map((id) => ({ id, name: "", email: `bench-${id}@example.com` }))
    );
  let vectors = 0;
  for (const userId of users) {
    for (let start = 0; start < LIBRARY_SIZE; start += 250) {
      const rows = await db
        .insert(schema.memory)
        .values(
          Array.from({ length: 250 }, (_, j) => ({
            userId,
            kind: "text" as const,
            indexState: "searchable" as const,
            ...fakeMemory(start + j),
          }))
        )
        .returning({ id: schema.memory.id });
      const values = rows.flatMap(({ id }) =>
        (["overview", "visual", "passage", "passage", "passage"] as const)
          .filter(
            (kind, i) => i === 0 || random() < (kind === "visual" ? 0.33 : 0.6)
          )
          .map((kind) => ({
            memoryId: id,
            userId,
            kind,
            model: stub.model,
            dimensions: DIMS,
            embedding: unit(),
          }))
      );
      vectors += values.length;
      await db.insert(schema.memoryVector).values(values);
    }
  }
  await db.execute("analyze memory");
  await db.execute("analyze memory_vector");

  const userId = users[0]!;
  const library = openLibrary(db, userId);
  const sqlTimings: number[] = [];
  const search = createSearch({
    userId,
    find: (q, options) => time(sqlTimings, () => library.search(q, options)),
    embedder: stub,
    spend: {
      reserve: async () => ({ id: "hold" }),
      releaseHold: async () => {},
      recordCall: async () => {},
    },
  });
  for (const q of QUERIES) await library.search(q); // warm up

  const instant: number[] = [];
  const full: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    for (const q of QUERIES) {
      await time(instant, () => search.search(q, "instant"));
    }
  }
  sqlTimings.length = 0;
  for (let run = 0; run < RUNS; run++) {
    // A new word each run, so no query vector comes from the cache.
    for (const q of QUERIES) {
      await time(full, () => search.search(`${q} r${run}`, "full"));
    }
  }
  const fullSql = sqlTimings.splice(0);
  const similar: number[] = [];
  const ids = (await library.list({ limit: 30 }))!.memories.map((m) => m.id);
  for (const id of ids) await time(similar, () => search.similar(id));

  console.log(
    `bench:search: ${LIBRARY_SIZE} Memories, ${vectors / (OTHER_LIBRARIES + 1)} vectors a Library ` +
      `(${(OTHER_LIBRARIES + 1) * LIBRARY_SIZE} Memories, ${vectors} vectors in the tables); ` +
      `stub provider ${PROVIDER_MS.join("-")} ms`
  );
  percentiles("instant", instant);
  percentiles("full, end to end", full);
  percentiles("full, SQL only", fullSql);
  percentiles("More Like This", similar);
} finally {
  await db.delete(schema.user).where(inArray(schema.user.id, users));
  await close();
}
