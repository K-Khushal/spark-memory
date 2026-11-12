import type { Reranker } from "./run";

const TIMEOUT_MS = 15_000;

/** No reranker: the order search gave. */
export const noRerank: Reranker = async (_query, candidates) =>
  candidates.map((c) => c.id);

/**
 * jina-reranker-m0 through Jina's rerank API (text only here: each Memory is
 * its title plus what Indexing found). Needs JINA_API_KEY. Sends the sample
 * Library's text, which is openly licensed, never a user's.
 */
export function jinaReranker(apiKey = process.env.JINA_API_KEY): Reranker {
  if (!apiKey) throw new Error("JINA_API_KEY is not set");
  return async (query, candidates) => {
    const res = await fetch("https://api.jina.ai/v1/rerank", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "jina-reranker-m0",
        query,
        documents: candidates.map((c) => c.text.slice(0, 4000)),
        top_n: candidates.length,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`jina rerank answered ${res.status}`);
    const { results } = (await res.json()) as { results: { index: number }[] };
    return results.map((r) => candidates[r.index]!.id);
  };
}

/**
 * Jev Noul as the judge of "is this what the user described?" (ADR-0008).
 * Not written: its request shape is only known second-hand
 * (docs/research/search.md, section 6), and #13 builds the real adapter
 * behind an interface with a timeout. Fill this in from that adapter.
 */
export const jevReranker = (): Reranker => {
  throw new Error(
    "the Jev adapter is built in #13; wire it here to include Jev in the experiment"
  );
};
