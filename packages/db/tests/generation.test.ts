import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { embeddingSpace, type IndexingOutput } from "@spark/core";
import {
  createIndexer,
  type Embedder,
  type EmbedInput,
  type Provider,
} from "@spark/indexing";
import {
  indexingStore,
  openDatabase,
  openLibrary,
  schema,
  type Database,
} from "../index";
import { newUser, removeUser } from "./users";

// A Memory deleted while Indexing's provider call is out, and saved again
// with the same id (Captures choose their id), by its owner or by someone
// else. The new row restarts at run 1, so only its generation tells the
// two apart: nothing the old call brings back may land in the new one.
const databaseUrl = process.env.DATABASE_URL;

const found = (over: Partial<IndexingOutput> = {}): IndexingOutput => ({
  title: "Citrus dessert",
  description: "A pastry with a glossy zesty filling",
  ocrText: "",
  entities: ["Ottolenghi"],
  tags: ["baking"],
  language: "en",
  ...over,
});

const MODEL = "fence-embedding";
const DIMS = 3;
const space = embeddingSpace(MODEL, DIMS);

describe.skipIf(!databaseUrl)(
  "a Memory deleted and saved again with its id",
  () => {
    let db: Database;
    let close: () => Promise<void>;
    let ana: string;
    let ben: string;

    beforeAll(async () => {
      ({ db, close } = openDatabase(databaseUrl!));
      ana = await newUser(db);
      ben = await newUser(db);
    });
    afterAll(async () => {
      await removeUser(db, ana);
      await removeUser(db, ben);
      await close();
    });

    const library = (userId: string) => openLibrary(db, userId);
    const store = () => indexingStore(db);
    const capture = async (userId: string, body: string, id?: string) => {
      const result = await library(userId).capture({ body, ...(id && { id }) });
      if (!("memory" in result)) throw new Error("conflict");
      return result.memory;
    };
    const row = async (id: string) =>
      (
        await db
          .select({
            userId: schema.memory.userId,
            state: schema.memory.indexState,
            run: schema.memory.indexRun,
            generation: schema.memory.indexGeneration,
            lease: schema.memory.indexLeaseUntil,
            language: schema.memory.language,
            vectorsSpace: schema.memory.vectorsSpace,
          })
          .from(schema.memory)
          .where(eq(schema.memory.id, id))
      )[0];
    const indexRows = (id: string) =>
      db
        .select()
        .from(schema.memoryIndex)
        .where(eq(schema.memoryIndex.memoryId, id));
    const vectorRows = (id: string) =>
      db
        .select({ userId: schema.memoryVector.userId })
        .from(schema.memoryVector)
        .where(eq(schema.memoryVector.memoryId, id));
    const embedding = (revision = 1) => ({
      model: MODEL,
      dimensions: DIMS,
      revision,
      vectors: [{ kind: "overview" as const, embedding: [1, 0, 0] }],
    });
    /** Deletes `id` (owned by `from`) and saves a new Memory with it for `to`. */
    const recreate = async (id: string, from: string, to: string) => {
      expect(await library(from).remove(id)).toBe(true);
      return capture(to, "Ben's own words, nothing about baking", id);
    };

    for (const [who, owner] of [
      ["the same owner", () => ana],
      ["another owner", () => ben],
    ] as const) {
      describe(`by ${who}`, () => {
        it("keeps the old run's Extraction, index state and lease out of the new Memory", async () => {
          const old = await capture(ana, "Lemon tart with a short crust");
          const claim = (await store().load(old.id))!;
          expect(claim).toMatchObject({ userId: ana, run: 1 });
          const fresh = await recreate(old.id, ana, owner());
          const before = (await row(fresh.id))!;
          expect(before).toMatchObject({ userId: owner(), run: 1 });
          expect(before.generation).not.toBe(claim.generation);

          const work = { ...claim, memoryId: old.id };
          expect(await store().isCurrent(work)).toBe(false);
          expect(
            await store().complete(
              work,
              { output: found(), model: "fake" },
              embedding()
            )
          ).toBe(false);
          expect(await store().fail(work, "unavailable")).toBe(false);
          // The new Memory's own delivery holds its lease; the old one's
          // release must not hand it to a duplicate.
          expect(await store().load(fresh.id, 1)).toBeDefined();
          await store().release(work);
          expect(await store().load(fresh.id, 1)).toBeUndefined();

          expect(await row(fresh.id)).toMatchObject({
            userId: owner(),
            state: "indexing",
            language: null,
            vectorsSpace: null,
          });
          expect(await indexRows(fresh.id)).toEqual([]);
          expect(await vectorRows(fresh.id)).toEqual([]);
          const ids = (await library(owner()).search("zesty")).map((m) => m.id);
          expect(ids).not.toContain(fresh.id);
        });

        it("keeps the old Memory's vectors out of the new one", async () => {
          const old = await capture(ana, "Lemon tart with a short crust");
          const loaded = (await store().load(old.id))!;
          await store().complete(
            { ...loaded, memoryId: old.id },
            { output: found(), model: "fake" }
          );
          const claim = (await store().loadForEmbedding(old.id, space))!;
          const fresh = await recreate(old.id, ana, owner());
          // Searchable at run 1 and revision 1, like the old one was.
          const next = (await store().load(fresh.id))!;
          expect(
            await store().complete(
              { ...next, memoryId: fresh.id },
              { output: found({ description: "Ben's notes" }), model: "fake" }
            )
          ).toBe(true);

          const work = { ...claim, memoryId: old.id };
          expect(await store().stillEmbeddable(work, claim.revision)).toBe(
            false
          );
          expect(await store().writeVectors(work, embedding())).toBe(false);
          expect(await vectorRows(fresh.id)).toEqual([]);
          expect((await row(fresh.id))!.vectorsSpace).toBeNull();
        });

        it("drops the old Extraction even when its provider call was out during the delete", async () => {
          const old = await capture(ana, "Lemon tart with a short crust");
          let fresh: { id: string } | undefined;
          const provider: Provider = {
            name: "fake",
            model: "fake",
            async extract() {
              fresh = await recreate(old.id, ana, owner());
              return {
                text: JSON.stringify(found()),
                usage: { inputTokens: 10, outputTokens: 5 },
              };
            },
          };
          const { index } = createIndexer({
            store: store(),
            providers: [provider],
            readFile: async () => undefined,
          });
          expect(
            await index({
              memoryId: old.id,
              run: 1,
              priority: "fresh",
              attempt: 1,
            })
          ).toEqual({ result: "skipped" });
          expect(await row(fresh!.id)).toMatchObject({
            userId: owner(),
            state: "indexing",
          });
          expect(await indexRows(fresh!.id)).toEqual([]);
          // The call was paid for: counted for the person who sent it, and
          // named as the old Memory, not the new one.
          const calls = await db
            .select({
              userId: schema.aiCall.userId,
              generation: schema.aiCall.memoryGeneration,
            })
            .from(schema.aiCall)
            .where(eq(schema.aiCall.memoryId, old.id));
          expect(calls).toEqual([
            { userId: ana, generation: old.indexGeneration },
          ]);
          expect(old.indexGeneration).not.toBe(
            (await row(fresh!.id))!.generation
          );
        });

        it("drops the old vectors even when the embedding call was out during the delete", async () => {
          const old = await capture(ana, "Lemon tart with a short crust");
          const loaded = (await store().load(old.id))!;
          await store().complete(
            { ...loaded, memoryId: old.id },
            { output: found(), model: "fake" }
          );
          let fresh: { id: string } | undefined;
          const embedder: Embedder = {
            name: "fake",
            model: MODEL,
            dimensions: DIMS,
            async embed(inputs: EmbedInput[]) {
              fresh = await recreate(old.id, ana, owner());
              const next = (await store().load(fresh.id))!;
              await store().complete(
                { ...next, memoryId: fresh.id },
                { output: found(), model: "fake" }
              );
              return {
                vectors: inputs.map(() => [1, 0, 0]),
                usage: { textTokens: 10, imageTokens: 0 },
              };
            },
          };
          const { index } = createIndexer({
            store: store(),
            providers: [],
            embedder,
            readFile: async () => undefined,
          });
          expect(
            await index({
              memoryId: old.id,
              priority: "background",
              task: "embed",
              attempt: 1,
            })
          ).toEqual({ result: "skipped" });
          expect(await vectorRows(fresh!.id)).toEqual([]);
          expect((await row(fresh!.id))!.vectorsSpace).toBeNull();
        });
      });
    }

    it("does nothing for a queue message sent for an earlier Memory with the id", async () => {
      const old = await capture(ana, "Lemon tart with a short crust");
      const fresh = await recreate(old.id, ana, ben);
      const message = {
        memoryId: old.id,
        run: 1,
        generation: old.indexGeneration,
      };
      expect(
        await store().load(old.id, 1, old.indexGeneration)
      ).toBeUndefined();
      expect(
        await store().loadForEmbedding(old.id, space, old.indexGeneration)
      ).toBeUndefined();
      // The dead-letter queue gives up on the old message: the new Memory stays.
      expect(await store().giveUp(message)).toBe(false);
      // A message from before generations were sent cannot say which
      // Memory it was for: it changes nothing (the hourly sweep re-sends
      // whatever is still Indexing), even at the run the new one is at.
      expect(await store().giveUp({ memoryId: old.id, run: 1 })).toBe(false);
      expect(await store().giveUp({ memoryId: old.id })).toBe(false);
      expect(await row(fresh.id)).toMatchObject({ state: "indexing" });
      // Its own message still works.
      expect(
        await store().load(fresh.id, 1, fresh.indexGeneration)
      ).toMatchObject({ userId: ben, generation: fresh.indexGeneration });
    });

    it("gives every existing row its own generation", async () => {
      const [a, b] = [await capture(ana, "One"), await capture(ana, "Two")];
      expect(a.indexGeneration).toMatch(/^[0-9a-f-]{36}$/);
      expect(a.indexGeneration).not.toBe(b.indexGeneration);
      const { rows } = await db.execute<{ n: string }>(
        sql`select count(*) - count(distinct index_generation) as n from memory`
      );
      expect(Number(rows[0]!.n)).toBe(0);
      expect(
        await db
          .select({ id: schema.memory.id })
          .from(schema.memory)
          .where(
            and(
              eq(schema.memory.id, a.id),
              eq(schema.memory.indexGeneration, b.indexGeneration)
            )
          )
      ).toEqual([]);
    });
  }
);
