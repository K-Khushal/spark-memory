import { z } from "zod";
import { FREE_ALLOWANCE } from "./allowance";

// The WHATWG URL parser exists in every runtime Spark runs on (browsers,
// Workers, Node); declared here because @spark/core takes no DOM lib.
type WhatwgUrl = {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  pathname: string;
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

/** Only actual YouTube video Sources carry a playback timestamp. */
export function isYouTubeVideo(input: string): boolean {
  const url = parse(input);
  if (!url) return false;
  if (url.hostname === "youtu.be") return /^\/[^/]+\/?$/.test(url.pathname);
  return (
    ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(
      url.hostname
    ) &&
    url.pathname === "/watch" &&
    [...url.searchParams].some(
      ([name, value]) => name === "v" && value.length > 0
    )
  );
}

/**
 * The form two Captures of the same page share (PLAN.md §5.2): http(s)
 * only, host lowercased, default port, fragment and tracking parameters
 * gone, the other parameters sorted. Undefined for anything else.
 */
export function normaliseUrl(input: string): string | undefined {
  const url = parse(input);
  if (!url) return undefined;
  const id = youtubeId(input);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  const post = socialPostUrl(url);
  if (post) return post;
  url.hash = "";
  // Valid 11-character ids were canonicalised above. Legacy watch/youtu.be
  // Sources with other ids still lose their playback timestamp here.
  const video = isYouTubeVideo(input);
  const kept = [...url.searchParams].filter(
    ([name]) => !isTracker(name) && !(video && name === "t")
  );
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  url.search = new URLSearchParams(kept).toString();
  return url.toString();
}

const SOCIAL_HOSTS: [SocialPlatform, RegExp][] = [
  ["x", /^((www|mobile)\.)?(x|twitter)\.com$/],
  ["tiktok", /^((www|m|vm|vt)\.)?tiktok\.com$/],
  ["instagram", /^(www\.)?instagram\.com$/],
];

/** The platforms whose posts get a site reader in the extension and oEmbed on the server. */
export type SocialPlatform = "x" | "tiktok" | "instagram";

/** X, TikTok or Instagram by the URL's real host (never a look-alike), else undefined. */
export function socialPlatform(input: string): SocialPlatform | undefined {
  const url = parse(input);
  return url && SOCIAL_HOSTS.find(([, host]) => host.test(url.hostname))?.[0];
}

/** An Instagram reel's shortcode, from `/reel/`, `/reels/` or `/user/reel/`; undefined for anything else. */
export function instagramReel(input: string): string | undefined {
  const url = parse(input);
  if (!url || socialPlatform(input) !== "instagram") return undefined;
  const code = /^\/(?:[\w.]+\/)?reels?\/([\w-]+)\/?$/.exec(url.pathname)?.[1];
  return code;
}

/**
 * One post, one URL: the same tweet, TikTok or reel shared from the app, the
 * web or an old twitter.com link dedupes to the same Memory. Undefined for
 * any other page on these hosts (and short links, which only redirect).
 */
function socialPostUrl(url: WhatwgUrl): string | undefined {
  const platform = socialPlatform(url.toString());
  const path = url.pathname;
  if (platform === "x") {
    // `/i/web/status/<id>` is the same post as `/i/status/<id>`.
    const m = /^\/(?:(\w{1,15})|i\/web)\/status\/(\d+)(?:\/|$)/.exec(path);
    return m ? `https://x.com/${m[1] ?? "i"}/status/${m[2]}` : undefined;
  }
  if (platform === "tiktok" && /^(www\.|m\.)?tiktok\.com$/.test(url.hostname)) {
    const m = /^\/(@[\w.-]+)\/(video|photo)\/(\d+)\/?$/.exec(path);
    return m ? `https://www.tiktok.com/${m[1]}/${m[2]}/${m[3]}` : undefined;
  }
  // A carousel's `?img_index=` is a place in the post, not another post.
  const post = /^\/(?:[\w.]+\/)?p\/([\w-]+)\/?$/.exec(path)?.[1];
  if (platform === "instagram" && post) {
    return `https://www.instagram.com/p/${post}/`;
  }
  const reel = instagramReel(url.toString());
  return reel ? `https://www.instagram.com/reel/${reel}/` : undefined;
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
  /** Read by a site adapter (X, TikTok, Instagram): what the person saw outranks what the web says. */
  site: z.boolean().optional(),
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
  const put = (
    key: Exclude<keyof LinkMetadata, "video" | "siteRead">,
    value: string | undefined
  ) => {
    const clean = oneLine(value);
    if (clean) metadata[key] = clean;
  };
  put("title", page.title);
  put("description", page.description);
  put("siteName", page.siteName);
  put("author", page.author);
  put("publishedAt", page.publishedAt);
  put("imageUrl", page.imageUrl);
  if (page.site) metadata.siteRead = true;
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
  video?: VideoMetadata;
  /** A site adapter read this Memory's page in the person's browser (precedence in saveGathered). */
  siteRead?: boolean;
  selectionContext?: string;
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

/** Recognised public YouTube URL forms, without trusting look-alike hosts. */
export function youtubeId(input: string): string | undefined {
  const u = parse(input);
  if (!u) return undefined;
  const params = [...u.searchParams];
  const id =
    u.hostname === "youtu.be"
      ? u.pathname.slice(1).split("/")[0]
      : /^(www\.|m\.)?youtube\.com$/.test(u.hostname)
        ? u.pathname === "/watch"
          ? params.find(([k]) => k === "v")?.[1]
          : /^\/(shorts|embed|live)\//.test(u.pathname)
            ? u.pathname.split("/")[2]
            : undefined
        : undefined;
  return id && /^[\w-]{11}$/.test(id) ? id : undefined;
}

export function isVideoUrl(input: string): boolean {
  const url = parse(input);
  return (
    !!youtubeId(input) ||
    !!instagramReel(input) ||
    (!!url &&
      /^(www\.)?vimeo\.com$/.test(url.hostname) &&
      /^\/\d+(?:\/|$)/.test(url.pathname))
  );
}

/** Seconds at Capture, kept in the Source while dedupe ignores the moment. */
export function videoTimestamp(input: string): number {
  const u = parse(input);
  const value =
    u &&
    ([...u.searchParams].find(([k]) => k === "t" || k === "start")?.[1] ??
      u.hash.replace(/^#t=/, ""));
  if (!value) return 0;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value);
  const seconds = m
    ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
    : 0;
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86400
    ? seconds
    : 0;
}

export type TranscriptSegment = { seconds: number; text: string };
export type VideoMetadata = {
  duration?: number;
  transcript: TranscriptSegment[];
  transcriptState: "available" | "unavailable" | "over_allowance";
  /** Written by a model from a user-provided copy (a reel), so AI opt-out removes it; else the video's own captions. */
  transcribedBy?: "model";
};
export const formatTimestamp = (seconds: number) => {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  const minutes = Math.floor(whole / 60) % 60;
  return hours
    ? `${hours}:${pad(minutes)}:${pad(whole % 60)}`
    : `${minutes}:${pad(whole % 60)}`;
};
