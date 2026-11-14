import { parseOwnerBudgetShare } from "@spark/core";
import { indexingStore } from "@spark/db";
import type { Bindings } from "./env";

/**
 * Indexing's side of the database, with the Worker's per-person share of the
 * daily AI budget (`AI_OWNER_BUDGET_PERCENT`, 20% unless set): every AI call
 * holds its estimated cost against that share first.
 */
export const spendStore = (
  env: Pick<Bindings, "AI_OWNER_BUDGET_PERCENT">,
  db: Parameters<typeof indexingStore>[0]
) =>
  indexingStore(db, {
    ownerBudgetShare: parseOwnerBudgetShare(env.AI_OWNER_BUDGET_PERCENT),
  });
