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
     * Makes a Category, and every unlocked Memory Indexing has reached is
     * due for categorising again (`recategorising` of them). The caller
     * queues them (`due`); the hourly sweep finds any it does not.
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
        // Not a revision: the text is the same. Only the categoriser's say is.
        const due = await tx
          .update(memory)
          .set({
            categoriesVersion: null,
            // Not an edit: the sweep's order (oldest change first) stays.
            updatedAt: sql`${memory.updatedAt}`,
          })
          .where(
            and(
              eq(memory.userId, userId),
              embeddable,
              sql`not ${memory.categoriesLocked}`
            )
          )
          .returning({ id: memory.id });
        await tx
          .insert(categoryRun)
          .values({ userId, total: due.length, startedAt: sql`now()` })
          .onConflictDoUpdate({
            target: categoryRun.userId,
            set: { total: due.length, startedAt: sql`now()` },
          });
        return {
          category: { ...made!, memories: 0 },
          recategorising: due.length,
        };
      });
    },

    /** A new name, on the Category and on every Memory that has it, locked or not. Undefined when it is not theirs. */
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
        await tx
          .update(category)
          .set({ name: checked.name })
          .where(and(mine, eq(category.id, id)));
        if (checked.name !== target.name) {
          await tx
            .update(memory)
            .set({
              categories: sql`array_replace(${memory.categories}, ${target.name}, ${checked.name})`,
            })
            .where(
              and(
                eq(memory.userId, userId),
                sql`${memory.categories} @> array[${target.name}]::text[]`
              )
            );
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
     * it is not theirs.
     */
    async remove(id: string): Promise<{ memories: number } | undefined> {
      return db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        const [gone] = await tx
          .delete(category)
          .where(and(mine, eq(category.id, id)))
          .returning({ name: category.name });
        if (!gone) return undefined;
        const had = sql`${memory.categories} @> array[${gone.name}]::text[]`;
        const left = sql`array_remove(${memory.categories}, ${gone.name})`;
        const changed = await tx
          .update(memory)
          .set({
            categories: sql`case when cardinality(${left}) = 0 then array['Other']::text[] else ${left} end`,
          })
          .where(and(eq(memory.userId, userId), had))
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
