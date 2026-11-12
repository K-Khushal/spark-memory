import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./client";
import { deletionRequested, lockOwner } from "./owner";
import { memory, onboarding } from "./schema";

export type OnboardingStep = typeof onboarding.$inferSelect.step;
const initial = {
  step: "disclosure" as const,
  paused: false,
  samplesSeeded: false,
  firstSuccessfulSearchAt: null,
};
// Authored Samples: the database's normal text triggers build the keyword index.
// No queue, provider, vectors, storage objects, or allowance usage.
const samples = [
  {
    title: "Orange Cardamom Buns",
    body: "A weekend baking recipe. Soft dough, crushed cardamom and orange zest. Let the dough rise overnight, shape into swirls, then bake until golden. A warm spiced breakfast for a rainy morning.",
    captureNote: "something with citrus for a slow weekend",
  },
  {
    title: "A Quiet Place to Read",
    body: "A small bookshop tucked behind the station. Blue shelves, a window seat, coffee and a sleepy cat. A peaceful stop for the next trip, away from busy streets.",
    captureNote: "that little place with books and a cat",
  },
  {
    title: "A Garden That Waters Itself",
    body: "A simple balcony garden: herbs in terracotta pots with cotton wicks leading to a water reservoir. The plants drink slowly while you travel. Basil, mint and rosemary need sunshine and drainage.",
    captureNote: "keeping plants alive while away",
  },
];

/** Server-owned progress and one atomic, query-free activation record. */
export function openOnboarding(db: Database, userId: string) {
  async function read() {
    const [row] = await db
      .select()
      .from(onboarding)
      .where(eq(onboarding.userId, userId));
    if (!row) return initial;
    const { userId: _, ...state } = row;
    return state;
  }
  return {
    read,
    async start() {
      await db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        if (await deletionRequested(tx, userId)) return;
        await tx.insert(onboarding).values({ userId }).onConflictDoNothing();
        const [row] = await tx
          .select()
          .from(onboarding)
          .where(eq(onboarding.userId, userId));
        if (row!.samplesSeeded) return;
        await tx.insert(memory).values(
          samples.map((sample) => ({
            ...sample,
            userId,
            kind: "text" as const,
            sample: true,
            indexState: "searchable" as const,
            firstSearchableAt: sql`now()`,
          }))
        );
        await tx
          .update(onboarding)
          .set({ samplesSeeded: true, step: "extension" })
          .where(eq(onboarding.userId, userId));
      });
      return read();
    },
    async update(step: OnboardingStep, paused: boolean) {
      await db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        if (await deletionRequested(tx, userId)) return;
        const [row] = await tx
          .select()
          .from(onboarding)
          .where(eq(onboarding.userId, userId));
        // A stale tab cannot skip the first step (it seeds the Samples) or
        // reopen a finished flow.
        if (row?.step === "done" && step !== "done") return;
        if (!row?.samplesSeeded && step !== "disclosure") return;
        await tx
          .insert(onboarding)
          .values({ userId, step, paused })
          .onConflictDoUpdate({
            target: onboarding.userId,
            set: { step, paused },
          });
      });
      return read();
    },
    async removeSamples() {
      await db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        // A later start never recreates Samples the person removed.
        await tx
          .insert(onboarding)
          .values({ userId, samplesSeeded: true })
          .onConflictDoUpdate({
            target: onboarding.userId,
            set: { samplesSeeded: true },
          });
        await tx
          .delete(memory)
          .where(and(eq(memory.userId, userId), eq(memory.sample, true)));
      });
    },
    async activate(id: string) {
      // Only an opened Memory from this Library can count. The event stores no
      // query or Memory content. The owner lock and the conditional update
      // let exactly one request win.
      return db.transaction(async (tx) => {
        await lockOwner(tx, userId);
        if (await deletionRequested(tx, userId)) return false;
        await tx.insert(onboarding).values({ userId }).onConflictDoNothing();
        const rows = await tx
          .update(onboarding)
          .set({ firstSuccessfulSearchAt: sql`now()` })
          .where(
            and(
              eq(onboarding.userId, userId),
              sql`${onboarding.firstSuccessfulSearchAt} is null`,
              sql`exists (select 1 from ${memory} where ${memory.id} = ${id}::uuid and ${memory.userId} = ${userId})`
            )
          )
          .returning({ at: onboarding.firstSuccessfulSearchAt });
        await tx
          .update(onboarding)
          .set({ step: "done" })
          .where(
            and(
              eq(onboarding.userId, userId),
              eq(onboarding.step, "search"),
              sql`${onboarding.firstSuccessfulSearchAt} is not null`
            )
          );
        return rows.length > 0;
      });
    },
  };
}
