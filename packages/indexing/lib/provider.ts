import type { ProviderName } from "@spark/core";

/** The part of the Workers AI binding Markdown Conversion needs (lib/pdf.ts). */
export type MarkdownBinding = {
  toMarkdown(
    files: { name: string; blob: Blob },
    options?: { conversionOptions?: Record<string, unknown> }
  ): Promise<unknown>;
};

/** One Extraction call: the fixed instructions, the Memory as data, maybe its image. */
export type ExtractRequest = {
  system: string;
  /** The Memory, delimited; never part of `system`. */
  user: string;
  image?: { bytes: Uint8Array; mime: string };
  /**
   * A scanned PDF's page images, in order: the reply follows
   * PDF_SCAN_OUTPUT_JSON_SCHEMA, with each page's text. Only providers that
   * `readsPages` are asked.
   */
  pages?: { bytes: Uint8Array; mime: string }[];
  /** Set on the one corrective retry: the answer that failed and why. */
  correction?: { previous: string; errors: string };
};

export type Usage = { inputTokens: number; outputTokens: number };
/**
 * What a call that may still be billed probably used. `imageTokens`, when
 * set, is the part of `inputTokens` that was images (an embedding prices
 * them apart).
 */
export type Estimate = Usage & { imageTokens?: number };
export type ProviderReply = { text: string; usage: Usage };

/** An AI provider behind the chain's seam; adapters live next to this file. */
export type Provider = {
  name: ProviderName;
  model: string;
  /** Reads a scanned PDF's page images in one call (ExtractRequest.pages). */
  readsPages?: boolean;
  extract(request: ExtractRequest): Promise<ProviderReply>;
};

/**
 * Why a provider could not answer: `overflow` (rate or daily limit),
 * `unsupported` (it cannot take this input, such as the image) or `failed`.
 * Every kind moves on to the next provider; only the message's kind is kept.
 */
export class ProviderError extends Error {
  constructor(
    readonly kind: "overflow" | "unsupported" | "failed",
    /** What a call lost after sending (timed out, cut off) may still be billed for. */
    readonly estimate?: Estimate
  ) {
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

/**
 * The most an Extraction call lost after it was sent may be billed: its
 * input guessed from characters (the correction included) plus what the
 * image costs, and every output token it was allowed.
 */
export function lostCall(
  { system, user, image, pages, correction }: ExtractRequest,
  {
    imageTokens,
    maxOutputTokens,
  }: { imageTokens: number; maxOutputTokens: number }
): Usage {
  const chars =
    system.length +
    user.length +
    (correction
      ? correction.previous.length + CORRECTION(correction.errors).length
      : 0);
  return {
    inputTokens:
      guessTokens(chars) +
      ((image ? 1 : 0) + (pages?.length ?? 0)) * imageTokens,
    outputTokens: maxOutputTokens,
  };
}
