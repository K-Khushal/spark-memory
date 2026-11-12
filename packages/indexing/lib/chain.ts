import { INDEXING } from "@spark/core";
import type { Embedder } from "./embedder";
import { fakeEmbedder, fakeProvider } from "./fake";
import { gemini } from "./gemini";
import { fakePdfReader, workersAiPdf, type PdfReader } from "./pdf";
import { geminiEmbedding } from "./gemini-embedding";
import type { Provider } from "./provider";
import { workersAi, type AiBinding } from "./workers-ai";

export type ChainOptions = {
  /** The fake provider alone (local development, smoke tests). */
  fake?: boolean;
  ai?: AiBinding;
  geminiApiKey?: string;
  /** Only `true` lets Gemini in (ADR-0005). */
  geminiPaidTier?: boolean;
};

/** The providers to try, in INDEXING.chain order, from what this environment has. */
export function providerChain(options: ChainOptions): Provider[] {
  if (options.fake) return [fakeProvider()];
  const chain: Provider[] = [];
  for (const name of INDEXING.chain) {
    if (name === "workers-ai" && options.ai) chain.push(workersAi(options.ai));
    if (name === "gemini" && options.geminiApiKey) {
      if (options.geminiPaidTier === true) {
        chain.push(gemini({ apiKey: options.geminiApiKey, paidTier: true }));
      } else {
        console.warn("indexing: Gemini left out, GEMINI_PAID_TIER is not true");
      }
    }
  }
  return chain;
}

/**
 * How this environment reads a PDF's text: the fake reader locally,
 * Workers AI `toMarkdown` where the AI binding has it, else none (every
 * PDF then reads as a scan).
 */
export function pdfReaderFor(options: ChainOptions): PdfReader | undefined {
  if (options.fake) return fakePdfReader();
  const { ai } = options;
  return ai?.toMarkdown
    ? workersAiPdf({ toMarkdown: ai.toMarkdown.bind(ai) })
    : undefined;
}

/**
 * The embedding model this environment has: the fake one locally, Gemini
 * Embedding 2 with a paid-tier key (ADR-0005), else none, and Memories are
 * found by keyword only.
 */
export function embedderFor(options: ChainOptions): Embedder | undefined {
  if (options.fake) return fakeEmbedder();
  if (options.geminiApiKey && options.geminiPaidTier === true) {
    return geminiEmbedding({ apiKey: options.geminiApiKey, paidTier: true });
  }
  return undefined;
}
