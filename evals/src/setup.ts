import { loadRootEnv } from "@spark/config/load-env";
import { EMBEDDING } from "@spark/core";
import { openDatabase } from "@spark/db";
import {
  embedderFor,
  fakeEmbedder,
  geminiEmbedding,
  providerChain,
  type Embedder,
  type Provider,
} from "@spark/indexing";
import { readLibraryFile, type SampleMemory } from "./manifest";
import { replayProvider } from "./replay";

loadRootEnv();

/** Throwaway Libraries are written here, so only a database on this machine will do. */
export function openLocalDatabase() {
  const url = process.env.DATABASE_URL;
  if (
    !url ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
  ) {
    throw new Error(
      "the search test set needs a local DATABASE_URL (it writes a throwaway Library)"
    );
  }
  return openDatabase(url);
}

export type Setup = {
  providers: Provider[];
  embedder: Embedder;
  /** One at a time: the order Memories are written in decides ties, so the fake run must repeat exactly. */
  concurrency: number;
};

/** The deterministic providers: no keys, no network, the same answer every run. */
export async function fakeSetup(memories: SampleMemory[]): Promise<Setup> {
  const texts = new Map<string, string>();
  for (const sample of memories) {
    if (sample.text)
      texts.set(
        sample.id,
        (await readLibraryFile(sample.text)).toString("utf8")
      );
  }
  return {
    providers: [replayProvider(memories, texts)],
    embedder: fakeEmbedder(),
    concurrency: 1,
  };
}

/**
 * The real providers, for the owner to run (it spends money). It refuses
 * without the paid-tier flag: user-like content never goes to Gemini's free
 * tier (ADR-0005), and the API cannot tell the two keys apart.
 */
export function realSetup(options: { dimensions?: number } = {}): Setup {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (process.env.GEMINI_PAID_TIER !== "true" || !geminiApiKey) {
    throw new Error(
      "real providers need GEMINI_API_KEY and GEMINI_PAID_TIER=true (a key from a billed Cloud project, ADR-0005)"
    );
  }
  const chain = { geminiApiKey, geminiPaidTier: true };
  const providers = providerChain(chain);
  const embedder =
    options.dimensions && options.dimensions !== EMBEDDING.dimensions
      ? geminiEmbedding({
          apiKey: geminiApiKey,
          paidTier: true,
          dimensions: options.dimensions,
        })
      : embedderFor(chain);
  if (!providers.length || !embedder)
    throw new Error("no real provider is configured");
  return { providers, embedder, concurrency: 2 };
}
