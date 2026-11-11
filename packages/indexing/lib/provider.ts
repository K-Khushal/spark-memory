import type { ProviderName } from "@spark/core";

/** One Extraction call: the fixed instructions, the Memory as data, maybe its image. */
export type ExtractRequest = {
  system: string;
  /** The Memory, delimited; never part of `system`. */
  user: string;
  image?: { bytes: Uint8Array; mime: string };
  /** Set on the one corrective retry: the answer that failed and why. */
  correction?: { previous: string; errors: string };
};

export type Usage = { inputTokens: number; outputTokens: number };
export type ProviderReply = { text: string; usage: Usage };

/** An AI provider behind the chain's seam; adapters live next to this file. */
export type Provider = {
  name: ProviderName;
  model: string;
  extract(request: ExtractRequest): Promise<ProviderReply>;
};

/**
 * Why a provider could not answer: `overflow` (rate or daily limit),
 * `unsupported` (it cannot take this input, such as the image) or `failed`.
 * Every kind moves on to the next provider; only the message's kind is kept.
 */
export class ProviderError extends Error {
  constructor(readonly kind: "overflow" | "unsupported" | "failed") {
    super(`provider ${kind}`);
    this.name = "ProviderError";
  }
}

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Tokens guessed from characters when a provider does not say (about 4 a token). */
export const guessTokens = (chars: number) => Math.ceil(chars / 4);

export const CORRECTION = (errors: string) =>
  `That answer did not match the schema (${errors}). Answer again with only the JSON object.`;
