import { indexingStore, type Library } from "@spark/db";
import { embedderFor, jevJudge } from "@spark/indexing";
import { createSearch, jevMatchJudge } from "@spark/search";
import type { AppEnv } from "./env";
import { providers } from "./indexing";

/** The person's search: instant, full (with their query embedded) and More Like This. */
export const searchFor = (
  env: AppEnv["Bindings"],
  db: Parameters<typeof indexingStore>[0],
  userId: string,
  library: Library,
  { excludeSamples = false }: { excludeSamples?: boolean } = {}
) => {
  const embedder = embedderFor(providers(env));
  const spend = indexingStore(db);
  // Off unless the owner set the key and JEV_ENABLED (docs/research/jev.md);
  // then Jev judges Direct Matches within full search's time, else thresholds do.
  const client = jevJudge({
    apiKey: env.JEV_API_KEY,
    enabled: env.JEV_ENABLED === "true",
    model: env.JEV_MODEL,
  });
  return createSearch({
    userId,
    find: (query, options) =>
      library.search(query, { ...options, excludeSamples }),
    ...(embedder && { embedder }),
    spend,
    ...(client && {
      judge: jevMatchJudge({
        client,
        describe: library.judgingTexts,
        userId,
        spend,
      }),
    }),
  });
};
