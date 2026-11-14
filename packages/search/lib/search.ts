import {
  EMBEDDING,
  INDEXING,
  JUDGING,
  maxTokens,
  SEARCH_COLOURS,
  signalsOf,
  SEARCH_KINDS,
  SEARCH_PAGE_SIZE,
  sourceHosts,
  type Hold,
  type MemoryKind,
  type SearchChips,
  type SearchFilters,
} from "@spark/core";
import { understandQuery } from "./query";
import { thresholdJudge, type Candidate, type MatchJudge } from "./judge";
import {
  embedCostMicros,
  ProviderError,
  queryText,
  type AiCall,
  type Embedder,
} from "@spark/indexing";

/** The query's side of the vector leg (as @spark/db's Library takes it). */
export type Probe = { model: string; dimensions: number; imageQuery?: true } & (
  { vector: number[] } | { like: string }
);

/** What a search leg returns per Memory, at least. */
export type Hit = {
  id: string;
  matched: string[];
  distance: number | null;
  /** The fused rank score; the judge reads it beside the best one in the same search. */
  score: number;
};

/** The Library's narrowing, in its own words (hosts, hex colours); see `scopeOf`. */
export type Scope = {
  kinds?: MemoryKind[];
  filters?: {
    hosts?: string[];
    after?: string;
    before?: string;
    colour?: string;
    prefer?: string;
    /** A Memory has at least one of these Categories. */
    categories?: string[];
  };
};

/**
 * What a search is narrowed to: what the words said, then what the person
 * chose with a chip, which wins where they disagree. A colour from a chip
 * is required; one from the words only ranks higher, unless the words
 * are nothing but filters ("orange pdfs from last month").
 */
export function scopeOf(
  spoken: SearchFilters,
  chosen: SearchFilters,
  text: string
): Scope {
  const dated = chosen.after || chosen.before;
  const merged: SearchFilters = {
    ...spoken,
    ...chosen,
    ...(dated && { after: chosen.after, before: chosen.before }),
  };
  const filters = {
    ...(merged.categories && { categories: merged.categories }),
    ...(merged.source && { hosts: sourceHosts(merged.source) }),
    ...(merged.after && { after: merged.after }),
    ...(merged.before && { before: merged.before }),
    ...(chosen.colour || (spoken.colour && !text)
      ? { colour: SEARCH_COLOURS[(chosen.colour ?? spoken.colour)!] }
      : spoken.colour && { prefer: SEARCH_COLOURS[spoken.colour] }),
  };
  return {
    ...(merged.kinds && { kinds: merged.kinds }),
    ...(Object.keys(filters).length > 0 && { filters }),
  };
}

/** Instant: keyword and typo only, per keystroke. Full: with the vector leg, after a pause. */
export type Mode = "instant" | "full";

export type Ranked<R> = R & { match: "direct" | "related" };

/**
 * Recent query vectors in this Worker isolate, keyed by person first
 * (`userId\0model\0dimensions\0query`), so one person's can be forgotten.
 */
const cache = new Map<string, { vector: number[]; at: number }>();
const imageInFlight = new Map<string, Promise<number[]>>();
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

const thresholds = thresholdJudge();

/**
 * Splits results into Direct and Related Matches, keeping their order.
 * Only the first `JUDGING.window` results of a search with words can be
 * Direct (`from` is the rank of the first one). Thresholds decide for
 * everything; the Jev judge, when there is one and time, overrules them for
 * the Memories it may read. A judge that fails or is late changes nothing.
 */
async function split<R extends Hit>(
  hits: R[],
  {
    query,
    judge,
    from = 0,
    budgetMs = 0,
    imageQuery = false,
  }: {
    /** The words searched for; none (a browse) means every hit is a filter's. */
    query: string;
    imageQuery?: boolean;
    judge?: MatchJudge | undefined;
    from?: number;
    /** What is left of `JUDGING.fullBudgetMs` after the reserve; the judge only runs with enough. */
    budgetMs?: number;
  }
): Promise<Ranked<R>[]> {
  const candidates: Candidate[] = signalsOf(
    hits
      .slice(
        0,
        query || imageQuery ? Math.max(0, JUDGING.window - from) : hits.length
      )
      .map((hit) => (imageQuery ? { ...hit, matched: ["vector"] } : hit)),
    from
  );
  const controller = new AbortController();
  const verdicts = await thresholds.judge(query, candidates, controller.signal);
  if (
    !imageQuery &&
    judge &&
    query &&
    candidates.length &&
    budgetMs >= JUDGING.jevMinMs
  ) {
    const ms = Math.min(JUDGING.jevTimeoutMs, budgetMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("judging timed out"));
        }, ms);
      });
      const judged = await Promise.race([
        judge.judge(query, candidates, controller.signal),
        late,
      ]);
      for (const [id, verdict] of judged) verdicts.set(id, verdict);
    } catch {
      console.error("search: Direct Matches fell back to thresholds");
    } finally {
      clearTimeout(timer);
    }
  }
  return hits.map((hit) => ({
    ...hit,
    match: verdicts.get(hit.id) ?? "related",
  }));
}

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
  judge,
  now = Date.now,
}: {
  userId: string;
  /** The Library's hybrid search. */
  find: (
    query: string,
    options: Scope & {
      probe?: Probe;
      maxDistance: number;
      limit?: number;
      offset?: number;
      /** The id of the last Memory of the page before (browsing with no words). */
      cursor?: string;
    }
  ) => Promise<R[]>;
  embedder?: Embedder;
  /** The budget breaker's side of the database (`indexingStore`). */
  spend: {
    /**
     * Holds a call's cost (an upper bound) before it is made, refused when
     * the person's share of today's budget, or all of it, is spent or held
     * (`recordCall({ reservation })` settles that hold, so parallel
     * searches cannot overshoot).
     */
    reserve(input: { userId: string; micros: number }): Promise<Hold>;
    releaseHold(id: string): Promise<void>;
    recordCall(call: AiCall): Promise<void>;
  };
  /** Jev's judge of Direct Matches (ADR-0008); without one, thresholds decide. */
  judge?: MatchJudge;
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
    // An upper bound: the text at its UTF-8 bytes, whatever the language.
    const held = await spend.reserve({
      userId,
      micros: embedCostMicros(embedder.model, {
        textTokens: Math.min(
          maxTokens(queryText(query)),
          EMBEDDING.maxInputTokens
        ),
        imageTokens: 0,
      }),
    });
    if ("refused" in held) return undefined;
    // Bookkeeping after the call: if it fails, the vector (already paid
    // for) is still used. Only the category is logged.
    const record = (textTokens: number, estimated?: boolean) =>
      spend
        .recordCall({
          userId,
          memoryId: null,
          reservation: held.id,
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
      } else {
        await spend.releaseHold(held.id).catch(() => {});
      }
      return undefined;
    }
  }

  async function embedImage(image: {
    data: string;
    mime: string;
  }): Promise<number[]> {
    const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
    if (bytes.length > 1_048_576) throw new Error("image_search_too_large");
    const tracked = inFlight.get(userId) ?? { searches: 0, purges: 0 };
    inFlight.set(userId, tracked);
    tracked.searches++;
    const purges = tracked.purges;
    try {
      // Only a short-lived vector and digest survive a request, never image bytes.
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes)
      );
      const key = [
        userId,
        embedder!.model,
        embedder!.dimensions,
        "image",
        image.mime,
        [...digest].map((n) => n.toString(16).padStart(2, "0")).join(""),
      ].join("\0");
      const hit = cached(key, now());
      if (hit) return hit;
      const pending = imageInFlight.get(key);
      if (pending) return await pending;
      const run = async () => {
        const held = await spend.reserve({
          userId,
          micros: embedCostMicros(embedder!.model, {
            textTokens: 0,
            imageTokens: INDEXING.heldImageTokens,
          }),
        });
        if ("refused" in held) throw new Error("image_search_budget");
        const record = async (
          textTokens: number,
          imageTokens: number,
          estimated = false
        ) => {
          await spend.recordCall({
            userId,
            memoryId: null,
            reservation: held.id,
            provider: embedder!.name,
            model: embedder!.model,
            usage: { inputTokens: textTokens + imageTokens, outputTokens: 0 },
            costMicros: embedCostMicros(embedder!.model, {
              textTokens,
              imageTokens,
            }),
            ...(estimated && { estimated }),
          });
        };
        let embedded;
        try {
          embedded = await embedder!.embed(
            [{ image: { bytes, mime: image!.mime } }],
            { timeoutMs: EMBEDDING.queryTimeoutMs }
          );
        } catch (error) {
          if (error instanceof ProviderError && error.estimate) {
            const images = error.estimate.imageTokens ?? 0;
            await record(
              Math.max(0, error.estimate.inputTokens - images),
              images,
              true
            );
          } else {
            await spend.releaseHold(held.id).catch(() => {});
          }
          throw new Error("image_search_unavailable", { cause: error });
        }
        await record(embedded.usage.textTokens, embedded.usage.imageTokens);
        return embedded.vectors[0]!;
      };
      const promise = run()
        .then((vector) => {
          if (tracked.purges === purges) remember(key, vector, now());
          return vector;
        })
        .finally(() => {
          imageInFlight.delete(key);
        });
      imageInFlight.set(key, promise);
      return await promise;
    } finally {
      if (--tracked.searches === 0) inFlight.delete(userId);
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
      {
        timezone,
        chips = {},
        page,
        image,
        memory,
      }: {
        /** The person's IANA timezone, for "last month". */
        timezone?: string;
        /** Filter chips; they win over what the words said. */
        chips?: SearchChips;
        /** Where the page begins: the `next` an earlier answer gave. */
        page?: string;
        image?: { mime: string; data: string };
        memory?: string;
      } = {}
    ): Promise<{ results: Ranked<R>[]; mode: Mode; next?: string }> {
      const started = now();
      const when = {
        now: new Date(started),
        ...(timezone && { timezone }),
      };
      const { text, filters: spoken } = understandQuery(query, when);
      const chosen: SearchFilters = {
        ...(chips.kind && { kinds: [...SEARCH_KINDS[chips.kind]] }),
        ...(chips.source && { source: chips.source }),
        ...(chips.colour && { colour: chips.colour }),
        ...(chips.category && { categories: [chips.category] }),
        // A chip's time range is read by the parser, like a typed one.
        ...(chips.when && understandQuery(chips.when, when).filters),
      };
      const scope = scopeOf(spoken, chosen, text);
      const narrowed = scope.kinds || scope.filters;
      // Nothing to look for and nothing to narrow by: no results, not the whole Library.
      if (!text && !narrowed && !image && !memory)
        return { results: [], mode: "instant" };
      // With no words and no colour, results are the newest first and page by
      // the last Memory; every other order is a score, and pages by count.
      const newestFirst = !text && !image && !memory && !scope.filters?.colour;
      const start = page?.startsWith("c:")
        ? { cursor: page.slice(2) }
        : page?.startsWith("o:")
          ? { offset: Number(page.slice(2)) }
          : {};
      const options = {
        ...scope,
        maxDistance: EMBEDDING.maxDistance,
        limit: SEARCH_PAGE_SIZE,
        ...(newestFirst ? start : { offset: start.offset ?? 0 }),
      };
      const answer = (results: Ranked<R>[], mode: Mode) => {
        const last = results.at(-1);
        return {
          results,
          mode,
          ...(results.length >= SEARCH_PAGE_SIZE &&
            last && {
              next: newestFirst
                ? `c:${last.id}`
                : `o:${(options.offset ?? 0) + results.length}`,
            }),
        };
      };
      // Image queries never silently become a different, text-only search.
      if (image || memory) {
        if (mode !== "full") return { results: [], mode: "instant" };
        if (!space) throw new Error("image_search_unavailable");
        let probe: Probe;
        if (memory) probe = { ...space, like: memory, imageQuery: true };
        else {
          probe = {
            ...space,
            vector: await embedImage(image!),
            imageQuery: true,
          };
        }
        const hits = await find(text, { ...options, probe });
        return answer(
          await split(hits, {
            query: text,
            imageQuery: true,
            from: options.offset ?? 0,
          }),
          "full"
        );
      }
      // Filters alone browse the Library, with no provider call.
      if (text && mode === "full" && space) {
        // Anything wrong on the way to the vector leg (the budget, the
        // provider, the SQL with a vector) falls back to keywords.
        try {
          const vector = await embedQuery(text);
          if (vector) {
            const probe = { ...space, vector };
            const hits = await find(text, { ...options, probe });
            return answer(
              await split(hits, {
                query: text,
                judge,
                from: options.offset ?? 0,
                budgetMs:
                  JUDGING.fullBudgetMs - JUDGING.reserveMs - (now() - started),
              }),
              "full"
            );
          }
        } catch {
          console.error("search: full search fell back to keywords");
        }
      }
      return answer(
        await split(await find(text, options), {
          query: text,
          from: options.offset ?? 0,
        }),
        "instant"
      );
    },

    /** More Like This: the Memory's own vectors as the query, no provider call. */
    async similar(memoryId: string): Promise<Ranked<R>[]> {
      if (!space) return [];
      return split(
        await find("", {
          probe: { ...space, like: memoryId },
          maxDistance: EMBEDDING.maxDistance,
        }),
        { query: "" }
      );
    },
  };
}

export type Search<R extends Hit> = ReturnType<typeof createSearch<R>>;
