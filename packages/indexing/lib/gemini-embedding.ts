import { EMBEDDING, INDEXING, maxTokens } from "@spark/core";
import type { Embedder } from "./embedder";
import { base64, overInlineLimit, ProviderError } from "./provider";

type Reply = {
  embeddings?: { values?: number[] }[];
  usageMetadata?: { promptTokenCount?: number };
};

/** The largest magnitude halfvec stores (IEEE half precision); also rules out NaN and Infinity. */
const HALF_MAX = 65504;

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
      // Too big to send, as its sizes alone say: refused before encoding it.
      if (
        overInlineLimit(
          // As serialised below: an input's text, when it has one, is what is sent.
          inputs.flatMap((i) => ("text" in i ? [] : [i.image]))
        )
      ) {
        throw new ProviderError("unsupported");
      }
      // An upper bound, as the hold is: a text at its UTF-8 bytes, cut at the
      // model's input limit. Used when the reply does not say, or is lost.
      let textTokens = 0;
      let images = 0;
      const requests = inputs.map((input) => {
        if ("text" in input)
          textTokens += Math.min(
            maxTokens(input.text),
            EMBEDDING.maxInputTokens
          );
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
        textTokens,
        imageTokens: images * IMAGE_TOKENS,
      };
      // Timed out, cut off or unreadable: it may still be billed.
      const billed = () =>
        new ProviderError("failed", {
          inputTokens: estimate.textTokens + estimate.imageTokens,
          outputTokens: 0,
          imageTokens: estimate.imageTokens,
        });
      const body = JSON.stringify({ requests });
      // Past the inline limit Gemini refuses it anyway: not sent, not billed.
      // In bytes, as Gemini counts it (UTF-8), not characters.
      if (
        new TextEncoder().encode(body).byteLength > INDEXING.inlineRequestBytes
      ) {
        throw new ProviderError("unsupported");
      }
      let res: Response;
      try {
        res = await send(url, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body,
        });
      } catch {
        throw billed();
      }
      if (res.status === 429) throw new ProviderError("overflow");
      if (res.status === 400 || res.status === 413) {
        throw new ProviderError(images ? "unsupported" : "failed");
      }
      if (!res.ok) throw new ProviderError("failed");
      let reply: Reply;
      try {
        reply = (await res.json()) as Reply;
      } catch {
        throw billed();
      }
      const vectors = Array.isArray(reply?.embeddings)
        ? reply.embeddings.map((e) => e?.values)
        : [];
      // Exactly one vector per input, each of finite numbers within
      // halfvec's range at the size asked for: anything else would break
      // the halfvec cast in search.
      if (
        vectors.length !== inputs.length ||
        !vectors.every(
          (v): v is number[] =>
            Array.isArray(v) &&
            v.length === dimensions &&
            v.every((x) => typeof x === "number" && Math.abs(x) <= HALF_MAX)
        )
      ) {
        throw billed();
      }
      const count = reply.usageMetadata?.promptTokenCount;
      const reported =
        typeof count === "number" && Number.isFinite(count) ? count : undefined;
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
