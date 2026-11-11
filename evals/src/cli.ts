// `pnpm --filter @spark/evals eval [--check | --update-baseline | --real] [--json file]`
//   (default)          fake providers, print the report
//   --check            fake providers, fail when top-1 or top-5 fell below baseline.json
//   --update-baseline  fake providers, write baseline.json (do it on purpose, in the PR)
//   --real             real providers (GEMINI_API_KEY, GEMINI_PAID_TIER=true); spends money
// No search change merges without this (CLAUDE.md).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EVALS_ROOT, loadSet } from "./manifest";
import { runEvals } from "./run";
import {
  compare,
  formatReport,
  toBaseline,
  worstOf,
  type Baseline,
} from "./score";
import { fakeSetup, openLocalDatabase, realSetup } from "./setup";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const jsonPath = has("--json") ? args[args.indexOf("--json") + 1] : undefined;
const BASELINE_RUNS = 4;
const baselinePath = join(EVALS_ROOT, "baseline.json");

if (has("--real") && (has("--check") || has("--update-baseline"))) {
  console.error("the baseline is for the fake providers: drop --real");
  process.exit(2);
}

const set = await loadSet();
const setup = has("--real") ? realSetup() : await fakeSetup(set.items);
const { db, close } = openLocalDatabase();
try {
  const report = await runEvals({
    db,
    items: set.items,
    searches: set.searches,
    ...setup,
    log: (line) => console.error(`evals: ${line}`),
  });
  console.log(formatReport(report));
  if (jsonPath) await writeFile(jsonPath, JSON.stringify(report, null, 1));

  if (has("--update-baseline")) {
    // The fake run repeats almost exactly: take the worst of a few runs, so
    // the baseline is a floor that a lucky tie cannot set too high.
    const runs = [report.searches];
    for (let i = 1; i < BASELINE_RUNS; i++) {
      const again = await runEvals({
        db,
        items: set.items,
        searches: set.searches,
        ...setup,
      });
      runs.push(again.searches);
    }
    await writeFile(
      baselinePath,
      JSON.stringify(toBaseline(worstOf(runs)), null, 2) + "\n"
    );
    console.log(`\nbaseline.json updated (worst of ${BASELINE_RUNS} runs)`);
  }
  if (has("--check")) {
    const baseline: Baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    const result = compare(report.searches, baseline);
    if (result.newSearches.length) {
      console.log(
        `\nnot in the baseline yet (run eval:update-baseline): ${result.newSearches.join(", ")}`
      );
    }
    if (!result.ok) {
      console.error(
        `\nSearch quality regressed:\n- ${result.messages.join("\n- ")}`
      );
      if (result.lost.length)
        console.error(`searches that got worse: ${result.lost.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log("\nsearch quality: no regression against baseline.json");
    }
  }
} finally {
  await close();
}
