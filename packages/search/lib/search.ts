import { understandQuery, type QueryFilters } from "./query";
import { EMBEDDING } from "@spark/core";
import {
  embedCostMicros,
  ProviderError,
  queryText,
  type AiCall,
  type Embedder,
} from "@spark/indexing";

/** The query's side of the vector leg (as @spark/db's Library takes it). */
export type Probe = { model: string; dimensions: number } & (
  { vector: number[] } | { like: string }
);

/** What a search leg returns per Memory, at least. */
export type Hit = { matched: string[]; distance: number | null };

/** Instant: keyword and typo only, per keystroke. Full: with the vector leg, after a pause. */
export type Mode = "instant" | "full";

export type Ranked<R> = R & { match: "direct" | "related" };

/**
 * Recent query vectors in this Worker isolate, keyed by person first
 * (`userId\0model\0dimensions\0query`), so one person's can be forgotten.
 */
const cache = new Map<string, { vector: number[]; at: number }>();
/**
 * People with a query embedding in flight: how many, and how often their
 * vectors were forgotten meanwhile. An entry lives only while a search
 * runs, so this never grows with the people ever forgotten.
 */
const inFlight = new Map<string, { searches: number; purges: number }>();

/** How many people this isolate is tracking a search for (tests). */
export const searchesTracked = () => inFlight.size;
const ownKeys = (userId: string) =>
  [...cache.keys()].filter((key) => key.startsWith(`${userId}\0`));

/**
 * Forgets a person's cached query vectors (their account is being
 * deleted). Other isolates' copies expire within EMBEDDING.queryCacheMs.
 */
export function forgetQueryVectors(userId: string) {
  for (const key of ownKeys(userId)) cache.delete(key);
  // A query embedding still in flight must not put one back.
  const running = inFlight.get(userId);
  if (running) running.purges++;
}

/** How many of a person's query vectors this isolate holds (tests, admin). */
export const queryVectorsCached = (userId: string) => ownKeys(userId).length;

function cached(key: string, now: number) {
  const hit = cache.get(key);
  if (!hit || now - hit.at > EMBEDDING.queryCacheMs) return undefined;
  // Most recently used last: the first key is the one to drop.
  cache.delete(key);
  cache.set(key, hit);
  return hit.vector;
}

function remember(key: string, vector: number[], now: number) {
  cache.set(key, { vector, at: now });
  if (cache.size > EMBEDDING.queryCacheSize) {
    cache.delete(cache.keys().next().value!);
  }
}

/**
 * Direct when a keyword matched or a vector came very close (ADR-0008's
 * judge replaces this, PLAN.md §6.4); Related otherwise. Order is kept.
 */
const split = <R extends Hit>(hits: R[]): Ranked<R>[] =>
  hits.map((hit) => ({
    ...hit,
    match:
      hit.matched.includes("keyword") ||
      hit.matched.includes("filter") ||
      (hit.distance !== null && hit.distance <= EMBEDDING.directDistance)
        ? "direct"
        : "related",
  }));

/**
 * One person's search (ADR-0004, PLAN.md §6): instant mode per keystroke,
 * full mode with the query embedded, and More Like This. Full mode falls
 * back to instant, silently, when there is no embedder, the daily budget
 * is spent, or the provider fails or is slow. Query vectors are cached
 * briefly per person; queries, vectors and content are never logged.
 */
export function createSearch<R extends Hit>({
  userId,
  find,
  embedder,
  spend,
  now = Date.now,
}: {
  userId: string;
  /** The Library's hybrid search. */
  find: (
    query: string,
    options: {
      probe?: Probe;
      maxDistance: number;
      filters?: QueryFilters;
      offset?: number;
    }
  ) => Promise<R[]>;
  embedder?: Embedder;
  /** The budget breaker's side of the database (`indexingStore`). */
  spend: {
    spentTodayMicros(): Promise<number>;
    /** The admin's daily budget, else the default. */
    dailyBudgetMicros(): Promise<number>;
    recordCall(call: AiCall): Promise<void>;
  };
  now?: () => number;
}) {
  const space = embedder && {
    model: embedder.model,
    dimensions: embedder.dimensions,
  };

  async function embedQuery(query: string): Promise<number[] | undefined> {
    if (!embedder) return undefined;
    const key = [userId, embedder.model, embedder.dimensions, query].join("\0");
    const hit = cached(key, now());
    if (hit) return hit;
    const tracked = inFlight.get(userId) ?? { searches: 0, purges: 0 };
    inFlight.set(userId, tracked);
    tracked.searches++;
    try {
      return await embedFresh(query, key, tracked, tracked.purges);
    } finally {
      if (--tracked.searches === 0) inFlight.delete(userId);
    }
  }

  async function embedFresh(
    query: string,
    key: string,
    tracked: { purges: number },
    purgesAtStart: number
  ): Promise<number[] | undefined> {
    if (!embedder) return undefined;
    const [spent, limit] = await Promise.all([
      spend.spentTodayMicros(),
      spend.dailyBudgetMicros(),
    ]);
    if (spent >= limit) return undefined;
    // Bookkeeping after the call: if it fails, the vector (already paid
    // for) is still used. Only the category is logged.
    const record = (textTokens: number, estimated?: boolean) =>
      spend
        .recordCall({
          userId,
          memoryId: null,
          provider: embedder.name,
          model: embedder.model,
          usage: { inputTokens: textTokens, outputTokens: 0 },
          costMicros: embedCostMicros(embedder.model, {
            textTokens,
            imageTokens: 0,
          }),
          ...(estimated && { estimated }),
        })
        .catch(() => console.error("search: query cost not recorded"));
    try {
      const { vectors, usage } = await embedder.embed(
        [{ text: queryText(query) }],
        { timeoutMs: EMBEDDING.queryTimeoutMs }
      );
      await record(usage.textTokens);
      // Forgotten meanwhile (account deletion): used once, never kept.
      if (tracked.purges === purgesAtStart) {
        remember(key, vectors[0]!, now());
      }
      return vectors[0];
    } catch (error) {
      if (error instanceof ProviderError && error.estimate) {
        await record(error.estimate.inputTokens, true);
      }
      return undefined;
    }
  }

  return {
    /**
     * `mode` in the answer is the search that actually ran: "instant" when
     * full mode fell back, so a client knows not to keep it as final.
     */
    async search(
      query: string,
      mode: Mode,
      context: {
        timezone?: string;
        filters?: QueryFilters;
        offset?: number;
      } = {}
    ): Promise<{ results: Ranked<R>[]; mode: Mode }> {
      const parsed = understandQuery(query, {
        now: new Date(now()),
        ...(context.timezone && { timezone: context.timezone }),
      });
      const q = parsed.text;
      const filters = {
        ...parsed.filters,
        ...context.filters,
        ...(context.filters?.colour && { strictColour: true }),
      };
      // Colour helps ranking in prose, but is a strict filter for an explicit chip.
      const keyword = parsed.filters.colour
        ? `${q} ${query.match(/\b(red|orange|yellow|green|blue|purple|pink|black|white)\b/i)?.[0] ?? ""}`.trim()
        : q;
      if (!q && !Object.keys(filters).length)
        return { results: [], mode: "instant" };
      const options = {
        maxDistance: EMBEDDING.maxDistance,
        ...(Object.keys(filters).length && { filters }),
        ...(context.offset && { offset: context.offset }),
      };
      if (q && mode === "full" && space) {
        // Anything wrong on the way to the vector leg (the budget, the
        // provider, the SQL with a vector) falls back to keywords.
        try {
          const vector = await embedQuery(keyword);
          if (vector) {
            const probe = { ...space, vector };
            return {
              results: split(await find(keyword, { ...options, probe })),
              mode: "full",
            };
          }
        } catch {
          console.error("search: full search fell back to keywords");
        }
      }
      return { results: split(await find(keyword, options)), mode: "instant" };
    },

    /** More Like This: the Memory's own vectors as the query, no provider call. */
    async similar(memoryId: string): Promise<Ranked<R>[]> {
      if (!space) return [];
      return split(
        await find("", {
          probe: { ...space, like: memoryId },
          maxDistance: EMBEDDING.maxDistance,
        })
      );
    },
  };
}

export type Search<R extends Hit> = ReturnType<typeof createSearch<R>>;
