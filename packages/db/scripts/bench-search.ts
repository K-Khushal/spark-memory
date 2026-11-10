// `pnpm --filter @spark/db bench:search`: instant search latency on a 1,000
// Memory Library (PLAN.md §6.2 asks for p95 under 100 ms). Builds a throwaway
// Library next to 4,000 other people's Memories, runs typed-as-you-go,
// keyword, typo and no-match queries through openLibrary, prints percentiles,
// then deletes everything it made. Local databases only.
import { existsSync } from "node:fs";
import { inArray } from "drizzle-orm";
import { openDatabase, openLibrary, schema } from "../index";
import { DEMO_LIBRARY } from "./demo-library";

const rootEnv = new URL("../../../.env", import.meta.url);
if (!process.env.DATABASE_URL && existsSync(rootEnv))
  process.loadEnvFile(rootEnv);
const url = process.env.DATABASE_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("bench:search needs a local DATABASE_URL");
}

const LIBRARY_SIZE = 1000;
const OTHER_LIBRARIES = 4;
const RUNS = 3;

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
  for (const userId of users) {
    for (let start = 0; start < LIBRARY_SIZE; start += 500) {
      await db.insert(schema.memory).values(
        Array.from({ length: 500 }, (_, j) => ({
          userId,
          kind: "text" as const,
          indexState: "searchable" as const,
          ...fakeMemory(start + j),
        }))
      );
    }
  }
  await db.execute("analyze memory");

  const library = openLibrary(db, users[0]!);
  for (const q of QUERIES) await library.search(q); // warm up

  const timings: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    for (const q of QUERIES) {
      const start = performance.now();
      await library.search(q);
      timings.push(performance.now() - start);
    }
  }
  timings.sort((a, b) => a - b);
  const at = (p: number) =>
    timings[Math.min(timings.length - 1, Math.floor(p * timings.length))]!;
  console.log(
    `bench:search: ${timings.length} searches over ${LIBRARY_SIZE} Memories ` +
      `(${(OTHER_LIBRARIES + 1) * LIBRARY_SIZE} in the table): ` +
      `p50 ${at(0.5).toFixed(1)} ms, p95 ${at(0.95).toFixed(1)} ms, ` +
      `max ${at(1).toFixed(1)} ms`
  );
} finally {
  await db.delete(schema.user).where(inArray(schema.user.id, users));
  await close();
}
