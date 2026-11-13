import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Category } from "@spark/core";
import { z } from "zod";
import { EVALS_ROOT } from "./manifest";

/** Sample Library ids to the Categories a person would accept for them. */
export const CategoryLabels = z.record(z.string(), z.array(Category).min(1));
export type CategoryLabels = z.infer<typeof CategoryLabels>;

export async function loadCategoryLabels(): Promise<CategoryLabels> {
  return CategoryLabels.parse(
    JSON.parse(await readFile(join(EVALS_ROOT, "categories.json"), "utf8"))
  );
}

export type CategoryScore = {
  labelled: number;
  /** The first (strongest) Category is an accepted one. */
  first: number;
  /** Every assigned Category is an accepted one. */
  all: number;
};

/**
 * Counts only, never a Memory's text. `assigned` is what Indexing chose for
 * each sample id; a labelled Memory with none counts as wrong.
 */
export function scoreCategories(
  labels: CategoryLabels,
  assigned: ReadonlyMap<string, readonly Category[]>
): CategoryScore {
  let first = 0;
  let all = 0;
  const ids = Object.keys(labels);
  for (const id of ids) {
    const got = assigned.get(id) ?? [];
    const accepted = labels[id]!;
    if (got.length && accepted.includes(got[0]!)) first++;
    if (got.length && got.every((c) => accepted.includes(c))) all++;
  }
  return { labelled: ids.length, first, all };
}
