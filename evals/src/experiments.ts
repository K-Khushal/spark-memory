// `pnpm --filter @spark/evals experiments <dimensions|passages|rerank> --yes`
// ADR-0004's three open choices, each run through the real providers on the
// sample Library and printed as a Markdown table for evals/reports/. It
// spends money (Gemini paid tier), so it refuses without --yes. Not run in
// CI; the owner runs it once keys exist (see evals/README.md).
import { EMBEDDING } from "@spark/core";
import { loadSet } from "./manifest";
import { jevReranker, jinaReranker, noRerank } from "./rerankers";
import { runEvals, type Reranker } from "./run";
import { refuseOwnerMemories } from "./manifest";
import { score } from "./score";
import { openLocalDatabase, realSetup } from "./setup";

const [experiment, ...flags] = process.argv.slice(2);
if (
  !flags.includes("--yes") ||
  !["dimensions", "passages", "rerank"].includes(experiment ?? "")
) {
  console.error(
    "usage: experiments <dimensions|passages|rerank> --yes   (spends money: real Gemini calls)"
  );
  process.exit(2);
}

type Variant = {
  label: string;
  dimensions?: number;
  passageChars?: number;
  /** Built when its turn comes, so one missing key skips one row, not the experiment. */
  rerank?: () => Reranker;
};
const VARIANTS: Record<string, () => Variant[]> = {
  dimensions: () =>
    [768, 1536, 3072].map((dimensions) => ({
      label: `${dimensions} dimensions`,
      dimensions,
    })),
  // About 250, 500 and 1,000 tokens at ~4 characters a token.
  passages: () =>
    [1000, 2000, 4000].map((passageChars) => ({
      label: `${passageChars} characters`,
      passageChars,
    })),
  rerank: () => [
    { label: "none", rerank: () => noRerank },
    { label: "jina-reranker-m0", rerank: jinaReranker },
    { label: "Jev Noul", rerank: jevReranker },
  ],
};

const variants = VARIANTS[experiment!]!();
const set = await loadSet();
// Only the Jina reranker leaves the machine, but Gemini sees every Memory too.
refuseOwnerMemories(set.memories, "experiments");
const { db, close } = openLocalDatabase();
const original = {
  passageChars: EMBEDDING.passageChars,
  passageOverlapChars: EMBEDDING.passageOverlapChars,
};
const rows: string[] = [];
try {
  for (const v of variants) {
    // EMBEDDING is `as const` for types only; Passages read it on every call.
    Object.assign(EMBEDDING, {
      passageChars: v.passageChars ?? original.passageChars,
      passageOverlapChars: v.passageChars
        ? Math.round(v.passageChars / 10)
        : original.passageOverlapChars,
    });
    let rerank: Reranker | undefined;
    try {
      rerank = v.rerank?.();
    } catch (error) {
      rows.push(
        `| ${v.label} | skipped | skipped | ${(error as Error).message} |`
      );
      continue;
    }
    const report = await runEvals({
      db,
      memories: set.memories,
      searches: set.searches,
      ...realSetup({ dimensions: v.dimensions }),
      rerank,
      log: (line) => console.error(`${v.label}: ${line}`),
    });
    const s = score(report.searches);
    rows.push(
      `| ${v.label} | ${s.top1}/${s.total} | ${s.top5}/${s.total} | $${(report.costMicros / 1e6).toFixed(3)} |`
    );
  }
} finally {
  Object.assign(EMBEDDING, original);
  await close();
}
console.log(
  `| ${experiment} | top-1 | top-5 | AI cost |\n| --- | --- | --- | --- |\n${rows.join("\n")}`
);
