import { and, eq, sql } from "drizzle-orm";
import {
  CATEGORY_NAMES,
  checkCategoryName,
  MAX_CUSTOM_CATEGORIES,
  type CategoryNameProblem,
} from "@spark/core";
import type { Database } from "./client";
import { categoriesStale, embeddable } from "./indexing";
import { lockOwner } from "./owner";
import { category, categoryRun, memory } from "./schema";

/** A person's own Category and how many of their Memories have it. */
export type OwnCategory = { id: string; name: string; memories: number };
/** Memories due for the newest Category, of those it began with. */
export type CategoryProgress = { done: number; total: number };
export type CategoryProblem = CategoryNameProblem | "limit";

/**
 * One person's own Categories (ADR-0008). Every call is scoped to the owner:
 * another person's Category is `undefined` or unknown, never an error that
 * says it exists.
 */
export function openCategories(db: Database, userId: string) {
  const mine = eq(category.userId, userId);
  // Written out: drizzle drops the table's name from columns in a one-table select,
  // and `user_id` would then read as the Memory's own.
  const memories = sql<number>`(select count(*)::int from memory m where m.user_id = "category"."user_id" and m.categories @> array["category"."name"]::text[])`;
  const columns = { id: category.id, name: category.name, memories };
  /** Their Memories the run still has to categorise. */
  const dueWhere = and(eq(memory.userId, userId), embeddable, categoriesStale);

  /** Memories of theirs that have `name`. */
  const holds = (name: string) =>
    sql`${memory.categories} @> array[${name}]::text[]`;

  /**
   * Locks the Memories that have `name`, in id order. A write to a Memory
   * takes the Memory and then (its trigger) the Category; this takes the
   * same order, so a rename or delete never waits for a Category while
   * holding what a write is waiting for. The owner lock keeps two of these apart.
   */
  const lockHolders = (tx: Pick<Database, "select">, name: string) =>
    tx
      .select({ id: memory.id })
      .from(memory)
      .where(and(eq(memory.userId, userId), holds(name)))
      .orderBy(memory.id)
      .for("update");

  /** A change to their Categories: a new generation, and for a new Category the one Memories are due at. */
  const bump = (tx: Pick<Database, "insert">, due: boolean) =>
    tx
      .insert(categoryRun)
      .values({
        userId,
        generation: 1,
        dueGeneration: due ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: categoryRun.userId,
        set: {
          generation: sql`${categoryRun.generation} + 1`,
          ...(due && {
            dueGeneration: sql`${categoryRun.generation} + 1`,
            startedAt: sql`now()`,
          }),
        },
      });

  async function pending() {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(memory)
      .where(dueWhere);
    return row?.n ?? 0;
  }

  return {
    /** The Categories in the order they were made, and how far the newest one's re-categorising has got. */
    async list(): Promise<{
      categories: OwnCategory[];
      run?: CategoryProgress;
    }> {
      const [categories, [run], left] = await Promise.all([
        db
          .select(columns)
          .from(category)
          .where(mine)
          .orderBy(category.createdAt, category.id),
        db.select().from(categoryRun).where(eq(categoryRun.userId, userId)),
        pending(),
      ]);
      // Edits during a run can make more Memories due than it began with.
      return {
        categories,
        ...(run && left > 0
          ? {
              run: {
                done: Math.max(0, run.total - left),
                total: Math.max(run.total, left),
              },
            }
          : {}),
      };
    },

    /** Whether a name is one a search or an edit may use: a built-in or the owner's own, whatever another person has. */
    async has(name: string): Promise<boolean> {
      if ((CATEGORY_NAMES as readonly string[]).includes(name)) return true;
      const [row] = await db
        .select({ id: category.id })
        .from(category)
        .where(and(mine, eq(category.name, name)));
      return !!row;
    },

    /**
     * Makes a Category, and every unlocked Memory is due for categorising
     * again (`recategorising` of those Indexing has reached). The caller
     * queues them (`due`); the hourly sweep finds any it does not. Nothing
     * of any Memory is written: the new generation alone makes them due,
     * and refuses a worker still holding the list from before.
     */
    async create(
      raw: string
    ): Promise<
      | { category: OwnCategory; recategorising: number }
      | { problem: CategoryProblem }
    > {
      return db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        const own = (
          await tx.select({ name: category.name }).from(category).where(mine)
        ).map((c) => c.name);
        if (own.length >= MAX_CUSTOM_CATEGORIES) {
          return { problem: "limit" as const };
        }
        const checked = checkCategoryName(raw, own);
        if ("problem" in checked) return checked;
        const [made] = await tx
          .insert(category)
          .values({ userId, name: checked.name })
          .returning({ id: category.id, name: category.name });
        await bump(tx, true);
        const [due] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(memory)
          .where(dueWhere);
        const total = due?.n ?? 0;
        await tx
          .update(categoryRun)
          .set({ total })
          .where(eq(categoryRun.userId, userId));
        return { category: { ...made!, memories: 0 }, recategorising: total };
      });
    },

    /**
     * A new name, on the Category and on every Memory that has it, locked or
     * not. Undefined when it is not theirs. Locks in the order a write to a
     * Memory does (the Memory, then the Category its trigger reads), so the
     * two can never wait on each other.
     */
    async rename(
      id: string,
      raw: string
    ): Promise<
      { category: OwnCategory } | { problem: CategoryProblem } | undefined
    > {
      return db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        const all = await tx
          .select({ id: category.id, name: category.name })
          .from(category)
          .where(mine);
        const target = all.find((c) => c.id === id);
        if (!target) return undefined;
        const checked = checkCategoryName(
          raw,
          all.filter((c) => c.id !== id).map((c) => c.name)
        );
        if ("problem" in checked) return checked;
        if (checked.name !== target.name) {
          await lockHolders(tx, target.name);
          await tx
            .update(category)
            .set({ name: checked.name })
            .where(and(mine, eq(category.id, id)));
          await bump(tx, false);
          await tx
            .update(memory)
            .set({
              categories: sql`array_replace(${memory.categories}, ${target.name}, ${checked.name})`,
            })
            .where(and(eq(memory.userId, userId), holds(target.name)));
        }
        const [renamed] = await tx
          .select(columns)
          .from(category)
          .where(and(mine, eq(category.id, id)));
        return { category: renamed! };
      });
    },

    /**
     * Takes the Category off every Memory that has it, never deleting one;
     * a Memory left with none is Other. How many had it, or undefined when
     * it is not theirs. Locks Memories first, like `rename`.
     */
    async remove(id: string): Promise<{ memories: number } | undefined> {
      return db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        const [target] = await tx
          .select({ name: category.name })
          .from(category)
          .where(and(mine, eq(category.id, id)));
        if (!target) return undefined;
        await lockHolders(tx, target.name);
        await tx.delete(category).where(and(mine, eq(category.id, id)));
        await bump(tx, false);
        const left = sql`array_remove(${memory.categories}, ${target.name})`;
        const changed = await tx
          .update(memory)
          .set({
            categories: sql`case when cardinality(${left}) = 0 then array['Other']::text[] else ${left} end`,
          })
          .where(and(eq(memory.userId, userId), holds(target.name)))
          .returning({ id: memory.id });
        return { memories: changed.length };
      });
    },

    /** The Memories the run still has to categorise, oldest first: to put on the queue now. */
    async due(limit: number): Promise<{ id: string; generation: string }[]> {
      return db
        .select({ id: memory.id, generation: memory.indexGeneration })
        .from(memory)
        .where(dueWhere)
        .orderBy(memory.capturedAt, memory.id)
        .limit(limit);
    },
  };
}

export type Categories = ReturnType<typeof openCategories>;
