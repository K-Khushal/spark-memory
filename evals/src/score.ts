import { z } from "zod";
import type { Report, SearchOutcome } from "./run";

export type Tally = { total: number; top1: number; top5: number };

const tally = (outcomes: SearchOutcome[]): Tally => ({
  total: outcomes.length,
  top1: outcomes.filter((o) => o.rank === 1).length,
  top5: outcomes.filter((o) => o.rank !== null && o.rank <= 5).length,
});

export function score(outcomes: SearchOutcome[]) {
  const byKind: Record<string, Tally> = {};
  for (const kind of new Set(outcomes.map((o) => o.kind))) {
    byKind[kind] = tally(outcomes.filter((o) => o.kind === kind));
  }
  return { ...tally(outcomes), byKind };
}

/**
 * The worst rank each search got across several runs of the same set. The
 * fake run is not perfectly repeatable (the SQL breaks some ties by physical
 * order), so the baseline records the floor, not a lucky run.
 */
export function worstOf(runs: SearchOutcome[][]): SearchOutcome[] {
  const rankValue = (rank: number | null) => rank ?? Infinity;
  return runs[0]!.map((first, i) =>
    runs.reduce(
      (worst, run) =>
        rankValue(run[i]!.rank) > rankValue(worst.rank) ? run[i]! : worst,
      first
    )
  );
}

/** What `baseline.json` holds: every search's rank, and how much a drop may be. */
export const Baseline = z.object({
  /** The most the top-1 or top-5 rate may fall (0.02 = two points) before the gate fails. */
  tolerance: z.number().min(0).max(1),
  ranks: z.record(z.string(), z.number().int().positive().nullable()),
});
export type Baseline = z.infer<typeof Baseline>;

export const DEFAULT_TOLERANCE = 0.02;

export const toBaseline = (
  outcomes: SearchOutcome[],
  tolerance = DEFAULT_TOLERANCE
): Baseline => ({
  tolerance,
  ranks: Object.fromEntries(outcomes.map((o) => [o.id, o.rank])),
});

const within = (rank: number | null, n: number) => rank !== null && rank <= n;
const pct = (n: number, of: number) =>
  of ? `${((100 * n) / of).toFixed(1)}%` : "n/a";

/**
 * The CI gate: over the searches the baseline knows, top-1 and top-5 may not
 * fall by more than its tolerance. Searches added since (the owner's 20) are
 * reported, not gated, until the baseline is updated.
 */
export function compare(outcomes: SearchOutcome[], baseline: Baseline) {
  const known = outcomes.filter((o) => o.id in baseline.ranks);
  const newSearches = outcomes
    .filter((o) => !(o.id in baseline.ranks))
    .map((o) => o.id);
  const messages: string[] = [];
  const total = known.length;
  for (const [label, n] of [
    ["top-1", 1],
    ["top-5", 5],
  ] as const) {
    const now = known.filter((o) => within(o.rank, n)).length;
    const before = known.filter((o) =>
      within(baseline.ranks[o.id] ?? null, n)
    ).length;
    if (total && (before - now) / total > baseline.tolerance) {
      messages.push(
        `${label} fell from ${pct(before, total)} to ${pct(now, total)} (${before} to ${now} of ${total} searches; tolerance ${(baseline.tolerance * 100).toFixed(1)} points)`
      );
    }
  }
  const lost = known
    .filter((o) => {
      const was = baseline.ranks[o.id] ?? null;
      return (
        (within(was, 1) && !within(o.rank, 1)) ||
        (within(was, 5) && !within(o.rank, 5))
      );
    })
    .map((o) => o.id);
  const fellBack = outcomes.filter((o) => o.fellBack).map((o) => o.id);
  if (fellBack.length) {
    messages.push(
      `full search fell back to keywords for: ${fellBack.join(", ")}`
    );
  }
  return { ok: messages.length === 0, messages, lost, newSearches };
}

export function formatReport(report: Report) {
  const s = score(report.searches);
  const lines = [
    `Memories  ${report.memories}`,
    `Searches  ${s.total}`,
    `top-1  ${s.top1}/${s.total}  ${pct(s.top1, s.total)}`,
    `top-5  ${s.top5}/${s.total}  ${pct(s.top5, s.total)}`,
    "",
    "By kind",
    ...Object.entries(s.byKind).map(
      ([kind, t]) =>
        `  ${kind.padEnd(14)} top-1 ${t.top1}/${t.total}  top-5 ${t.top5}/${t.total}`
    ),
    "",
    "Per search",
    ...report.searches.map((o) => {
      const where = o.rank === null ? "not found" : `#${o.rank}`;
      const legs = o.matchedBy.length ? `  (${o.matchedBy.join("+")})` : "";
      return `  ${o.id.padEnd(26)} ${where.padEnd(10)} ${o.kind.padEnd(14)} ${o.query}${legs}`;
    }),
  ];
  if (report.costMicros) {
    lines.push("", `AI cost  $${(report.costMicros / 1e6).toFixed(4)}`);
  }
  return lines.join("\n");
}
