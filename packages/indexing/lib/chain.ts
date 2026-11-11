import { INDEXING } from "@spark/core";
import { fakeProvider } from "./fake";
import { gemini } from "./gemini";
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
