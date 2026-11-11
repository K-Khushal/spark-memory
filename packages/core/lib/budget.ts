import { INDEXING } from "./indexing";

/** Settings-table key for the daily AI budget, in micro-dollars. */
export const DAILY_BUDGET_KEY = "daily_budget_micros";

/**
 * Above this ($20) a value is refused, so a stray zero cannot lift the
 * breaker. $0 is allowed: it pauses background Indexing immediately.
 */
export const DAILY_BUDGET_MAX_MICROS = 20_000_000;

/**
 * The budget the breaker uses. A missing or unreadable stored value falls
 * back to INDEXING.dailyBudgetMicros ($1). A stored value above the cap
 * clamps to the cap, so an old row cannot raise the breaker.
 */
export function effectiveDailyBudgetMicros(
  stored: string | null | undefined
): number {
  if (stored == null || !/^\d+$/.test(stored))
    return INDEXING.dailyBudgetMicros;
  const micros = Number(stored);
  if (!Number.isSafeInteger(micros) || micros > DAILY_BUDGET_MAX_MICROS) {
    return DAILY_BUDGET_MAX_MICROS;
  }
  return micros;
}

/** What an admin may save. Integers only, from $0 up to the cap. */
export function parseDailyBudgetMicros(
  input: unknown
): { ok: true; micros: number } | { ok: false } {
  if (typeof input !== "number" || !Number.isInteger(input))
    return { ok: false };
  if (input < 0 || input > DAILY_BUDGET_MAX_MICROS) return { ok: false };
  return { ok: true, micros: input };
}

/** Background Indexing waits once today's spend has reached the limit. */
export function budgetPaused(
  spentMicros: number,
  limitMicros: number
): boolean {
  return spentMicros >= limitMicros;
}
