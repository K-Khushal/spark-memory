import { JUDGING } from "@spark/core";
import type { Embedder } from "@spark/indexing";
import { thresholdJudge, type MatchJudge } from "@spark/search";

/**
 * Jev's latency is not published and there is no key, so the harness
 * measures the machinery with a stand-in whose delay is log-normal with a
 * chosen median and 95th percentile. The numbers are assumptions; what the
 * run shows is how a search behaves around them: whether full mode stays
 * inside `JUDGING.fullBudgetMs` and how often Jev's answer is dropped.
 */
export type Delay = { medianMs: number; p95Ms: number };

/** A small seeded generator (mulberry32), so a latency run repeats. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The next delay in milliseconds: log-normal through the median and p95. */
export function delays({ medianMs, p95Ms }: Delay, seed = 1) {
  const next = random(seed);
  const sigma = Math.log(p95Ms / medianMs) / 1.645;
  return () => {
    // Box-Muller: one standard normal from two uniforms.
    const normal =
      Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
    return medianMs * Math.exp(sigma * normal);
  };
}

/** Nearest-rank percentile (0 to 1) of a list of numbers. */
export function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });

/** An embedder that answers after a delay, as a network call does. */
export function slowEmbedder(
  inner: Embedder,
  delay: Delay,
  seed = 2
): Embedder {
  const next = delays(delay, seed);
  return {
    ...inner,
    async embed(inputs, options) {
      await sleep(next());
      return inner.embed(inputs, options);
    },
  };
}

/**
 * Stands in for the Jev judge: waits its delay (giving up when aborted,
 * as the real fetch does), then rules like the thresholds. `answered`
 * counts the searches whose verdicts arrived in time.
 */
export function slowJudge(delay: Delay, seed = 3) {
  const next = delays(delay, seed);
  const thresholds = thresholdJudge();
  const stats = { asked: 0, answered: 0 };
  const judge: MatchJudge = {
    async judge(query, candidates, signal) {
      stats.asked++;
      await sleep(next(), signal);
      stats.answered++;
      return thresholds.judge(query, candidates, signal);
    },
  };
  return { judge, stats };
}

/** Full-mode scenarios: how slow the embedding call and Jev are assumed to be. */
export type Scenario = { name: string; embed: Delay; jev?: Delay };
const EMBED: Delay = { medianMs: 150, p95Ms: 350 };
export const SCENARIOS: Scenario[] = [
  { name: "no judge", embed: EMBED },
  { name: "Jev fast", embed: EMBED, jev: { medianMs: 120, p95Ms: 250 } },
  { name: "Jev assumed", embed: EMBED, jev: { medianMs: 300, p95Ms: 700 } },
  { name: "Jev slow", embed: EMBED, jev: { medianMs: 600, p95Ms: 1500 } },
];

export type LatencyRow = {
  name: string;
  samples: number;
  p50: number;
  p95: number;
  max: number;
  /** Searches that asked Jev, and how many of those got its verdicts in time. */
  asked: number;
  answered: number;
};

export function formatLatency(rows: LatencyRow[]) {
  return [
    `Full-mode latency (ms), budget ${JUDGING.fullBudgetMs}, Jev deadline ${JUDGING.jevTimeoutMs}, asked only before ${JUDGING.fullBudgetMs - JUDGING.reserveMs - JUDGING.jevMinMs}`,
    ...rows.map(
      (r) =>
        `  ${r.name.padEnd(12)} n ${String(r.samples).padEnd(4)} p50 ${r.p50.toFixed(0).padStart(4)}  p95 ${r.p95.toFixed(0).padStart(4)}  max ${r.max.toFixed(0).padStart(4)}  Jev answered ${r.answered}/${r.asked}`
    ),
  ].join("\n");
}
