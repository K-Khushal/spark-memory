import { z } from "zod";
import { FREE_ALLOWANCE } from "./allowance";

// The WHATWG URL parser exists in every runtime Spark runs on (browsers,
// Workers, Node); declared here because @spark/core takes no DOM lib.
type WhatwgUrl = {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  hash: string;
  search: string;
  searchParams: Iterable<[string, string]>;
  toString(): string;
};
declare const URL: new (input: string) => WhatwgUrl;
declare const URLSearchParams: new (init: [string, string][]) => {
  toString(): string;
};

/** The longest link Spark keeps; longer ones are almost always tracking junk. */
export const LINK_MAX_CHARS = 2048;

/** Query parameters that only say who sent the click, never what the page is. */
const TRACKERS = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "igshid",
  "igsh",
  "si",
  "ref_src",
  "mibextid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "oly_anon_id",
  "oly_enc_id",
  "vero_id",
  "rb_clickid",
  "s_cid",
]);
const isTracker = (name: string) => {
  const key = name.toLowerCase();
  return key.startsWith("utm_") || TRACKERS.has(key);
};

/** An http(s) URL with no username or password, parsed; undefined otherwise. */
function parse(input: string): WhatwgUrl | undefined {
  let url: WhatwgUrl;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password || !url.hostname) return undefined;
  return url;
}

/**
 * The form two Captures of the same page share (PLAN.md §5.2): http(s)
 * only, host lowercased, default port, fragment and tracking parameters
 * gone, the other parameters sorted. Undefined for anything else.
 */
export function normaliseUrl(input: string): string | undefined {
  const url = parse(input);
  if (!url) return undefined;
  url.hash = "";
  const kept = [...url.searchParams].filter(([name]) => !isTracker(name));
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = new URLSearchParams(kept).toString();
  return url.toString();
}

/** The link when a paste is exactly one http(s) URL, else undefined (it is text). */
export function linkFromPaste(text: string): string | undefined {
  const trimmed = text.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return undefined;
  return parse(trimmed) ? trimmed : undefined;
}

/** A Source's host as people say it: no `www.`. */
export function sourceHost(url: string): string | undefined {
  const parsed = parse(url);
  return parsed?.hostname.replace(/^www\./, "");
}

/**
 * Shorter readable text than this is a login wall or an app shell, not a
 * Preserved copy. The same bar as server gathering (`GATHER.minPreservedChars`).
 */
export const MIN_PRESERVED_CHARS = 280;

/** A visible-area screenshot is a small JPEG, never a full upload. */
export const SCREENSHOT_MAX_BYTES = 400_000;

const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => s || undefined);

/** An http(s) URL with no credentials, or undefined. */
function httpUrl(input: string | undefined): string | undefined {
  if (!input) return undefined;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    return input;
  } catch {
    return undefined;
  }
}

/**
 * What the extension read on the page (ADR-0006): the page's own metadata
 * and its readable text. Empty strings are dropped. A bad image URL is
 * dropped rather than refusing the Capture.
 */
export const PageExtract = z.object({
  title: line(FREE_ALLOWANCE.titleMaxChars).optional(),
  description: line(2000).optional(),
  siteName: line(200).optional(),
  author: line(200).optional(),
  publishedAt: line(80).optional(),
  imageUrl: z
    .string()
    .trim()
    .max(LINK_MAX_CHARS)
    .optional()
    .transform((value) => httpUrl(value)),
  text: line(FREE_ALLOWANCE.textMaxChars).optional(),
});
export type PageExtract = z.output<typeof PageExtract>;

const oneLine = (value: string | undefined) =>
  value?.replace(/\s+/g, " ").trim() || undefined;

/**
 * The part of a page extract worth keeping. Undefined when there is nothing
 * (no metadata and no Preserved text), so a pasted link still gathers on
 * the server. Text shorter than {@link MIN_PRESERVED_CHARS} is not a
 * Preserved copy; metadata alone still counts, so a page the person could
 * see is not fetched again.
 */
export function keptPage(
  page: PageExtract
): { metadata: LinkMetadata; text: string | null } | undefined {
  const metadata: LinkMetadata = {};
  const put = (key: keyof LinkMetadata, value: string | undefined) => {
    const clean = oneLine(value);
    if (clean) metadata[key] = clean;
  };
  put("title", page.title);
  put("description", page.description);
  put("siteName", page.siteName);
  put("author", page.author);
  put("publishedAt", page.publishedAt);
  put("imageUrl", page.imageUrl);
  const text = oneLine(page.text) ?? "";
  const preserved = text.length >= MIN_PRESERVED_CHARS ? text : null;
  if (!preserved && Object.keys(metadata).length === 0) return undefined;
  return { metadata, text: preserved };
}

/** A link Capture (paste, paste box, or the extension). `id` lets clients insert optimistically and retry safely. */
export const LinkCapture = z.object({
  id: z.uuid().optional(),
  url: z
    .string()
    .trim()
    .max(LINK_MAX_CHARS)
    .refine((url) => normaliseUrl(url) !== undefined),
  captureNote: z
    .string()
    .trim()
    .max(FREE_ALLOWANCE.captureNoteMaxChars)
    .transform((s) => s || null)
    .nullable()
    .optional(),
  /** As for a text Capture: time to Searchable is sent only when true. */
  productAnalytics: z.boolean().optional(),
  /** Present when the client already read the page (the extension). */
  page: PageExtract.optional(),
});
export type LinkCapture = z.input<typeof LinkCapture>;

/**
 * What gathering a link found about its Source (PLAN.md §5.3.1), kept as
 * the Memory's metadata. Every field is the page's own words, never a model's.
 */
export type LinkMetadata = {
  title?: string;
  description?: string;
  siteName?: string;
  author?: string;
  publishedAt?: string;
  /** Not loaded by the dashboard (no third-party requests); kept for a later Preserved thumbnail. */
  imageUrl?: string;
  /** Where the link's redirects ended, when somewhere else. */
  finalUrl?: string;
};
