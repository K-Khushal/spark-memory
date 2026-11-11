import { EMBEDDING } from "@spark/core";
import type { Embedder } from "./embedder";
import { base64, guessTokens, ProviderError } from "./provider";

type Reply = {
  embeddings?: { values?: number[] }[];
  usageMetadata?: { promptTokenCount?: number };
};

/** About what one image costs in tokens; the reply may not say (docs/research/embeddings.md). */
const IMAGE_TOKENS = 258;

/**
 * Gemini Embedding 2 on the paid tier, one vector per input through
 * batchEmbedContents. Like Extraction's Gemini, it refuses to exist without
 * the paid-tier flag: user content never reaches the free tier (ADR-0005).
 */
export function geminiEmbedding({
  apiKey,
  paidTier,
  model = EMBEDDING.model,
  dimensions = EMBEDDING.dimensions,
  fetch: send = fetch,
}: {
  apiKey: string;
  paidTier: boolean;
  model?: string;
  dimensions?: number;
  fetch?: typeof fetch;
}): Embedder {
  if (paidTier !== true) {
    throw new Error(
      "Gemini Embedding runs only on the paid tier (ADR-0005): set GEMINI_PAID_TIER=true for a key from a billed Cloud project"
    );
  }
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`;
  return {
    name: "gemini",
    model,
    dimensions,
    async embed(inputs, { timeoutMs = EMBEDDING.timeoutMs } = {}) {
      let textChars = 0;
      let images = 0;
      const requests = inputs.map((input) => {
        if ("text" in input) textChars += input.text.length;
        else images++;
        return {
          model: `models/${model}`,
          content: {
            parts: [
              "text" in input
                ? { text: input.text }
                : {
                    inline_data: {
                      mime_type: input.image.mime,
                      data: base64(input.image.bytes),
                    },
                  },
            ],
          },
          output_dimensionality: dimensions,
        };
      });
      const estimate = {
        textTokens: guessTokens(textChars),
        imageTokens: images * IMAGE_TOKENS,
      };
      let res: Response;
      try {
        res = await send(url, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({ requests }),
        });
      } catch {
        // Timed out or cut off: it may still be billed.
        throw new ProviderError("failed", {
          inputTokens: estimate.textTokens + estimate.imageTokens,
          outputTokens: 0,
        });
      }
      if (res.status === 429) throw new ProviderError("overflow");
      if (res.status === 400 || res.status === 413) {
        throw new ProviderError(images ? "unsupported" : "failed");
      }
      if (!res.ok) throw new ProviderError("failed");
      const reply = (await res.json()) as Reply;
      const vectors = (reply.embeddings ?? []).map((e) => e.values ?? []);
      if (
        vectors.length !== inputs.length ||
        vectors.some((v) => v.length !== dimensions)
      ) {
        throw new ProviderError("failed");
      }
      const reported = reply.usageMetadata?.promptTokenCount;
      return {
        vectors,
        usage:
          reported === undefined
            ? estimate
            : {
                textTokens: Math.max(0, reported - estimate.imageTokens),
                imageTokens: estimate.imageTokens,
              },
      };
    },
  };
}
