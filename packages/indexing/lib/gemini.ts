import {
  INDEXING,
  INDEXING_OUTPUT_JSON_SCHEMA,
  maxTokens,
  PDF_SCAN_OUTPUT_JSON_SCHEMA,
} from "@spark/core";
import {
  base64,
  CORRECTION,
  lostCall,
  overInlineLimit,
  ProviderError,
  type GeminiLike,
  type Provider,
} from "./provider";

const MAX_OUTPUT_TOKENS = INDEXING.maxOutputTokens;
/** An image at Gemini 3's default (high) media resolution (docs/research/enrichment.md). */
const IMAGE_TOKENS = 1120;

export type GeminiOptions = GeminiLike;

type Reply = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

/** Gemini Flash-Lite on the paid tier: overflow, invalid output and images Gemma cannot take. */
export function gemini({
  apiKey,
  paidTier,
  model = INDEXING.models.gemini,
  fetch: send = fetch,
  timeoutMs = INDEXING.providerTimeoutMs,
}: GeminiOptions): Provider {
  if (paidTier !== true) {
    throw new Error(
      "Gemini runs only on the paid tier (ADR-0005): set GEMINI_PAID_TIER=true for a key from a billed Cloud project"
    );
  }
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return {
    name: "gemini",
    model,
    readsPages: true,
    async extract(request) {
      const { system, user, image, pages, correction } = request;
      const maxOutputTokens = pages
        ? INDEXING.scanMaxOutputTokens
        : MAX_OUTPUT_TOKENS;
      // Lost after sending (timed out, the connection dropped, the reply
      // cut off): Google may still bill it, so the budget counts it at its
      // most, like a Workers AI timeout.
      const lost = () =>
        new ProviderError(
          "failed",
          lostCall(request, {
            imageTokens: IMAGE_TOKENS,
            maxOutputTokens,
          })
        );
      // Too big to send, as its sizes alone say: refused before encoding it.
      if (overInlineLimit([...(image ? [image] : []), ...(pages ?? [])])) {
        throw new ProviderError("unsupported");
      }
      const parts: unknown[] = [{ text: user }];
      if (image) {
        parts.push({
          inlineData: { mimeType: image.mime, data: base64(image.bytes) },
        });
      }
      // Each page image after its number, so the reply's pages line up.
      pages?.forEach((page, i) => {
        parts.push(
          { text: `Page ${i + 1}` },
          { inlineData: { mimeType: page.mime, data: base64(page.bytes) } }
        );
      });
      const contents: unknown[] = [{ role: "user", parts }];
      if (correction) {
        contents.push(
          { role: "model", parts: [{ text: correction.previous }] },
          { role: "user", parts: [{ text: CORRECTION(correction.errors) }] }
        );
      }
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: pages
            ? PDF_SCAN_OUTPUT_JSON_SCHEMA
            : INDEXING_OUTPUT_JSON_SCHEMA,
          maxOutputTokens,
          thinkingConfig: { thinkingLevel: "MINIMAL" },
        },
      });
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
        throw lost();
      }
      // A gateway timeout: Google stopped waiting on its own side, and the
      // model may have run. Any other error status is an answer: nothing
      // was generated or billed.
      if (res.status === 504) throw lost();
      if (res.status === 429) throw new ProviderError("overflow");
      if (res.status === 400 || res.status === 413) {
        throw new ProviderError(image || pages ? "unsupported" : "failed");
      }
      if (!res.ok) throw new ProviderError("failed");
      let reply: Reply;
      try {
        reply = (await res.json()) as Reply;
      } catch {
        throw lost();
      }
      const text = (reply.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
      const usage = reply.usageMetadata;
      return {
        text,
        usage: {
          inputTokens:
            usage?.promptTokenCount ?? maxTokens(system) + maxTokens(user),
          outputTokens:
            (usage?.candidatesTokenCount ?? maxTokens(text)) +
            (usage?.thoughtsTokenCount ?? 0),
        },
      };
    },
  };
}
