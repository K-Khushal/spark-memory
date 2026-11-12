import {
  FREE_ALLOWANCE,
  isVideoUrl,
  youtubeId,
  type LinkMetadata,
} from "@spark/core";
import { publicVideo } from "./video";
import { decodeEntities, scanHtml, type ScannedPage } from "./html";
import {
  GATHER,
  isTransient,
  publicFetch,
  type PublicResponse,
  type Resolve,
} from "./public-fetch";

/** What gathering a link kept (GLOSSARY.md → Preservation). */
export type Gathered = {
  metadata: LinkMetadata;
  /** The readable text, the Preserved copy; null keeps the Memory Reference only. */
  text: string | null;
  /** SHA-256 (hex) of `text`, for duplicate detection. */
  contentHash?: string;
  /** Nothing was found because the Source or network was down: worth another attempt. */
  transient: boolean;
};

export type Gatherer = {
  /**
   * `thirdParty` is asked before every request to someone other than the
   * Source (oEmbed, Jina Reader), after that host's name lookup and on
   * each redirect hop (publicFetch's `permitted`); false (AI opt-out, or
   * the run moved on) sends nothing. Third parties are only tried once
   * the Source was confirmed public.
   */
  gather(
    url: string,
    options?: { thirdParty?: () => Promise<boolean> }
  ): Promise<Gathered>;
};

/**
 * oEmbed endpoints of sites whose pages say little to a server (PLAN.md
 * §5.3.1). The only oEmbed calls made: built here from the Source's host,
 * never taken from a page.
 */
const OEMBED: [RegExp, string][] = [
  [
    /^(www\.|m\.)?youtube\.com$|^youtu\.be$/,
    "https://www.youtube.com/oembed?format=json&url=",
  ],
  [
    /^(www\.|mobile\.)?(twitter|x)\.com$/,
    "https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=",
  ],
  [/^(www\.)?tiktok\.com$/, "https://www.tiktok.com/oembed?url="],
  [/^(www\.)?vimeo\.com$/, "https://vimeo.com/api/oembed.json?url="],
  [/^open\.spotify\.com$/, "https://open.spotify.com/oembed?url="],
  [/^(www\.|old\.)?reddit\.com$/, "https://www.reddit.com/oembed?url="],
];

/** What the person can edit later (FREE_ALLOWANCE), so a page title is never too long to keep. */
const MAX_CHARS: Partial<Record<keyof LinkMetadata, number>> = {
  title: FREE_ALLOWANCE.titleMaxChars,
};

const JSON_TYPES = ["application/json", "text/json", "text/javascript"];
const ARTICLE =
  /Article|Posting|Report|Recipe|HowTo|Review|VideoObject|Product/;

type Ld = Record<string, unknown>;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? decodeEntities(v.trim()) : undefined;
const nameOf = (v: unknown): string | undefined => {
  const first = Array.isArray(v) ? v[0] : v;
  return str(first) ?? str((first as Ld | undefined)?.name);
};
const urlOf = (v: unknown): string | undefined => {
  const first = Array.isArray(v) ? v[0] : v;
  return str(first) ?? str((first as Ld | undefined)?.url);
};

/** The most article-like JSON-LD node on the page, if any. */
function jsonLdNode(blocks: string[]): Ld | undefined {
  const nodes: Ld[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || !v || typeof v !== "object") return;
    if (Array.isArray(v))
      return v.slice(0, 50).forEach((x) => walk(x, depth + 1));
    nodes.push(v as Ld);
    walk((v as Ld)["@graph"], depth + 1);
  };
  for (const block of blocks.slice(0, 10)) {
    try {
      walk(JSON.parse(block), 0);
    } catch {
      // Broken JSON-LD is common; the rest of the page still counts.
    }
  }
  const typeOf = (n: Ld) => [n["@type"]].flat().join(" ");
  return (
    nodes.find((n) => ARTICLE.test(typeOf(n))) ?? nodes.find((n) => n.headline)
  );
}

/** Fills only what is still missing: earlier sources win. */
function fill(into: LinkMetadata, from: LinkMetadata) {
  for (const [key, value] of Object.entries(from) as [
    Exclude<keyof LinkMetadata, "video">,
    string | undefined,
  ][]) {
    const clean = value
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CHARS[key] ?? 2000);
    if (clean && !into[key]) into[key] = clean;
  }
}

function fromPage(page: ScannedPage): { metadata: LinkMetadata; text: string } {
  const m = (...keys: string[]) =>
    keys.map((k) => page.meta.get(k)).find((v) => v);
  const ld = jsonLdNode(page.jsonLd);
  const metadata: LinkMetadata = {};
  fill(metadata, {
    title: m("og:title", "twitter:title"),
    description: m("og:description", "twitter:description", "description"),
    siteName: m("og:site_name", "application-name"),
    author: m("author", "article:author"),
    publishedAt: m("article:published_time"),
    imageUrl: m("og:image", "og:image:url", "twitter:image"),
  });
  fill(metadata, {
    title: str(ld?.headline) ?? str(ld?.name),
    description: str(ld?.description),
    author: nameOf(ld?.author),
    publishedAt: str(ld?.datePublished),
    imageUrl: urlOf(ld?.image),
  });
  fill(metadata, { title: page.title });
  const body = str(ld?.articleBody) ?? "";
  return { metadata, text: body.length > page.text.length ? body : page.text };
}

const sha256 = async (text: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const parseJson = (res: PublicResponse): Ld | undefined => {
  if (!res.ok) return undefined;
  try {
    const value: unknown = JSON.parse(res.text);
    return value && typeof value === "object" ? (value as Ld) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Gathers a pasted link on the server (ADR-0006's fallback): the page's
 * Open Graph and JSON-LD metadata and readable text, then oEmbed, then Jina
 * Reader when configured and the text is thin. Every request goes through
 * `publicFetch`; oEmbed endpoints come only from OEMBED. Never throws.
 */
export function createGatherer({
  fetch,
  resolve,
  reader,
}: {
  fetch: typeof globalThis.fetch;
  resolve: Resolve;
  /** Jina Reader: a third party, so off unless configured (an owner decision). */
  reader?: { apiKey?: string };
}): Gatherer {
  const get = (
    url: string,
    opts: Partial<Parameters<typeof publicFetch>[1]> = {}
  ) => publicFetch(url, { fetch, resolve, ...opts });

  async function gather(
    url: string,
    {
      thirdParty = async () => true,
    }: { thirdParty?: () => Promise<boolean> } = {}
  ) {
    const metadata: LinkMetadata = {};
    let text = "";
    const video = isVideoUrl(url);

    const page = await get(url);
    if (page.ok) {
      const found = fromPage(scanHtml(page.text, FREE_ALLOWANCE.textMaxChars));
      fill(metadata, found.metadata);
      text = video ? "" : found.text;
      if (youtubeId(url))
        metadata.video = await publicVideo(page.text, {
          fetch,
          resolve,
          permitted: thirdParty,
        });
      if (page.url !== url) metadata.finalUrl = page.url;
    }
    // Only a Source shown to be public (it answered, or every address on
    // the way checked public) is ever named to a third party. A failed
    // name lookup proves nothing: the link waits for another attempt.
    const confirmed = page.ok || page.confirmed === true;
    const transient = !page.ok && isTransient(page.reason);

    const host = new URL(url).hostname;
    const known = OEMBED.find(([pattern]) => pattern.test(host));
    if (confirmed && known) {
      const o = parseJson(
        await get(known[1] + encodeURIComponent(url), {
          accept: JSON_TYPES,
          maxBytes: GATHER.maxJsonBytes,
          permitted: thirdParty,
        })
      );
      if (o) {
        fill(metadata, {
          title: str(o.title),
          author: str(o.author_name),
          siteName: str(o.provider_name),
          imageUrl: str(o.thumbnail_url),
          // A post's own words (X, Reddit) come in its embed markup.
          description:
            typeof o.html === "string"
              ? scanHtml(o.html, 5000).text
              : undefined,
        });
      }
    }

    if (
      !video &&
      confirmed &&
      reader &&
      text.length < GATHER.minPreservedChars
    ) {
      const res = await get(GATHER.readerUrl + url, {
        accept: ["application/json"],
        timeoutMs: GATHER.readerTimeoutMs,
        permitted: thirdParty,
        headers: {
          "x-return-format": "text",
          "x-retain-images": "none",
          ...(reader.apiKey && { authorization: `Bearer ${reader.apiKey}` }),
        },
      });
      const data = parseJson(res)?.data as Ld | undefined;
      const content = str(data?.content) ?? "";
      if (content.length > text.length) text = content;
      fill(metadata, {
        title: str(data?.title),
        description: str(data?.description),
      });
    }

    if (video) {
      metadata.video ??= { transcript: [], transcriptState: "unavailable" };
      text = metadata.video.transcript.map((s) => s.text).join("\n");
    }
    const kept = text.slice(0, FREE_ALLOWANCE.textMaxChars).trim();
    const preserved =
      metadata.video?.transcriptState === "available" ||
      kept.length >= GATHER.minPreservedChars
        ? kept
        : null;
    return {
      metadata,
      text: preserved,
      ...(preserved && { contentHash: await sha256(preserved) }),
      transient: transient && !preserved && !metadata.title,
    };
  }

  return {
    gather: (url, options) =>
      gather(url, options).catch(() => ({
        metadata: {},
        text: null,
        transient: true,
      })),
  };
}
