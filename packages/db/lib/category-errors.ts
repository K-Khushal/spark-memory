/** The Postgres error the `memory_categories_known` trigger raises, wherever drizzle wrapped it. */
export function isUnknownCategory(error: unknown): boolean {
  for (
    let e = error as { cause?: unknown; constraint?: string } | undefined,
      i = 0;
    e && i < 5;
    i++
  ) {
    if (e.constraint === "memory_categories_known") return true;
    e = e.cause as typeof e;
  }
  return false;
}
