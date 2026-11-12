import { FREE_ALLOWANCE, PageExtract, type SocialPlatform } from "@spark/core";

/** What a site adapter read of the post the person is looking at. */
export type SitePost = {
  text: string;
  /** "Name (@handle)", or whichever of the two the page shows. */
  author?: string;
  publishedAt?: string;
  imageUrl?: string;
};

/**
 * One interface for every site. An adapter reads only what the logged-in
 * person can see, in the page, with no request of its own; the site's
 * origin is requested as an optional host permission the first time it is
 * used (background.ts), and no adapter is injected without it.
 */
export type SiteAdapter = {
  id: SocialPlatform;
  /** The one host the permission is asked for: an origin, never a pattern. */
  origin: string;
  /** A single post's page, not a timeline or a profile. */
  matches(url: URL): boolean;
  /** The post on the page, or undefined when the markup is not the one this knows. */
  read(doc: Document, url: URL): SitePost | undefined;
};

export const SITE_NAMES: Record<SocialPlatform, string> = {
  x: "X",
  tiktok: "TikTok",
  instagram: "Instagram",
};

const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/** A post as a page extract: the words as the description and, long ones, the Preserved text. */
export function toExtract(adapter: SiteAdapter, post: SitePost): PageExtract {
  const text = oneLine(post.text);
  return PageExtract.parse({
    title: text.slice(0, 100),
    description: text.slice(0, 2000),
    author: post.author,
    siteName: SITE_NAMES[adapter.id],
    publishedAt: post.publishedAt,
    imageUrl: post.imageUrl,
    text: text.slice(0, FREE_ALLOWANCE.textMaxChars),
  });
}
