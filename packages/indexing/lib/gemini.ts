import { INDEXING, INDEXING_OUTPUT_JSON_SCHEMA } from "@spark/core";
import {
  base64,
  CORRECTION,
  guessTokens,
  ProviderError,
  type Provider,
} from "./provider";

export type GeminiOptions = {
  apiKey: string;
  /**
   * Must be `true`: the key belongs to a Cloud project with active billing.
   * Google uses free-tier content to train and lets reviewers read it, and
   * the API cannot tell the tiers apart, so this is our only guard (ADR-0005).
   */
  paidTier: boolean;
  model?: string;
  fetch?: typeof fetch;
};

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
    async extract({ system, user, image, correction }) {
      const parts: unknown[] = [{ text: user }];
      if (image) {
        parts.push({
          inlineData: { mimeType: image.mime, data: base64(image.bytes) },
        });
      }
      const contents: unknown[] = [{ role: "user", parts }];
      if (correction) {
        contents.push(
          { role: "model", parts: [{ text: correction.previous }] },
          { role: "user", parts: [{ text: CORRECTION(correction.errors) }] }
        );
      }
      let res: Response;
      try {
        res = await send(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents,
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: INDEXING_OUTPUT_JSON_SCHEMA,
              maxOutputTokens: 4096,
              thinkingConfig: { thinkingLevel: "MINIMAL" },
            },
          }),
        });
      } catch {
        throw new ProviderError("failed");
      }
      if (res.status === 429) throw new ProviderError("overflow");
      if (res.status === 400 || res.status === 413) {
        throw new ProviderError(image ? "unsupported" : "failed");
      }
      if (!res.ok) throw new ProviderError("failed");
      const reply = (await res.json()) as Reply;
      const text = (reply.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("");
      const usage = reply.usageMetadata;
      return {
        text,
        usage: {
          inputTokens:
            usage?.promptTokenCount ?? guessTokens(system.length + user.length),
          outputTokens:
            (usage?.candidatesTokenCount ?? guessTokens(text.length)) +
            (usage?.thoughtsTokenCount ?? 0),
        },
      };
    },
  };
}
