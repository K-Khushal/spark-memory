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

/** One person's share of the daily budget, unless the Worker sets `AI_OWNER_BUDGET_PERCENT`. */
export const OWNER_BUDGET_SHARE_DEFAULT = 0.2;

/**
 * The share of the daily budget one person may spend, from the Worker's
 * `AI_OWNER_BUDGET_PERCENT` (1 to 100). Anything else falls back to the
 * default, so a typo cannot lift the limit.
 */
export function parseOwnerBudgetShare(percent: string | undefined): number {
  if (percent === undefined || !/^\d{1,3}(\.\d+)?$/.test(percent.trim()))
    return OWNER_BUDGET_SHARE_DEFAULT;
  const value = Number(percent);
  return value >= 1 && value <= 100 ? value / 100 : OWNER_BUDGET_SHARE_DEFAULT;
}

/** What one person may spend of today's budget, in micro-dollars. */
export function ownerBudgetMicros(
  dailyBudgetMicros: number,
  share: number
): number {
  return Math.floor(dailyBudgetMicros * share);
}

/**
 * What asking to hold an AI call's cost answers: the hold's id, or why not.
 * `spent`: the person's share (or the day's budget) is used up, wait for the
 * next UTC day. `busy`: other calls' holds in flight leave no room right
 * now, try again soon.
 */
export type Hold = { id: string } | { refused: "spent" | "busy" };
