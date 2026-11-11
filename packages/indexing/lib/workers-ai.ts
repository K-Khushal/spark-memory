import { INDEXING, INDEXING_OUTPUT_JSON_SCHEMA } from "@spark/core";
import {
  base64,
  CORRECTION,
  guessTokens,
  lostCall,
  ProviderError,
  type Provider,
} from "./provider";

/** The part of the Workers AI binding (`env.AI`) this adapter uses. */
export type AiBinding = {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
};

type Reply = {
  choices?: { message?: { content?: unknown } }[];
  response?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

// Cloudflare's error codes: 3036 daily free neurons used, 3040 capacity,
// 429 rate limited; 3006 / 413 request too large (docs/research/indexing-providers.md).
const OVERFLOW = /\b(3036|3040|429)\b|daily free allocation|capacity/i;
const TOO_LARGE = /\b(3006|413)\b|too large/i;
const JSON_MODE = /json mode/i;

/** The binding takes no signal: a call that outlives `ms` is given up on. */
class TimedOut extends Error {}

function withTimeout<T>(ms: number, call: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    call,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimedOut()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const MAX_OUTPUT_TOKENS = 4096;

/**
 * Gemma 4 on Workers AI (ADR-0005): first in the chain, zero data
 * retention. Output is asked for in JSON mode with the schema, but Gemma 4
 * is not on Cloudflare's JSON-mode list, so the chain validates it anyway.
 */
export function workersAi(
  ai: AiBinding,
  model: string = INDEXING.models["workers-ai"],
  timeoutMs: number = INDEXING.providerTimeoutMs
): Provider {
  return {
    name: "workers-ai",
    model,
    async extract(request) {
      const { system, user, image, correction } = request;
      const content = image
        ? [
            { type: "text", text: user },
            {
              type: "image_url",
              image_url: {
                url: `data:${image.mime};base64,${base64(image.bytes)}`,
              },
            },
          ]
        : user;
      const messages: unknown[] = [
        { role: "system", content: system },
        { role: "user", content },
      ];
      if (correction) {
        messages.push(
          { role: "assistant", content: correction.previous },
          { role: "user", content: CORRECTION(correction.errors) }
        );
      }
      let reply: Reply;
      try {
        reply = (await withTimeout(
          timeoutMs,
          ai.run(model, {
            messages,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "memory_index",
                schema: INDEXING_OUTPUT_JSON_SCHEMA,
                strict: true,
              },
            },
            max_completion_tokens: MAX_OUTPUT_TOKENS,
            // Thinking is on by default and billed as output: Extraction needs none.
            chat_template_kwargs: { enable_thinking: false },
          })
        )) as Reply;
      } catch (error) {
        // The call runs on, and is billed, after we stop waiting: estimate
        // it at its most (every output token) so the budget counts it.
        if (error instanceof TimedOut) {
          throw new ProviderError(
            "failed",
            lostCall(request, {
              imageTokens: 1000,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
            })
          );
        }
        const message = error instanceof Error ? error.message : "";
        // "JSON Mode couldn't be met" is invalid output: the chain corrects it.
        if (JSON_MODE.test(message)) {
          return { text: "", usage: { inputTokens: 0, outputTokens: 0 } };
        }
        if (OVERFLOW.test(message)) throw new ProviderError("overflow");
        if (TOO_LARGE.test(message)) throw new ProviderError("unsupported");
        throw new ProviderError("failed");
      }
      const raw = reply.choices?.[0]?.message?.content ?? reply.response;
      const text =
        typeof raw === "string" ? raw : raw == null ? "" : JSON.stringify(raw);
      return {
        text,
        usage: {
          inputTokens:
            reply.usage?.prompt_tokens ??
            guessTokens(system.length + user.length) + (image ? 1000 : 0),
          outputTokens:
            reply.usage?.completion_tokens ?? guessTokens(text.length),
        },
      };
    },
  };
}
