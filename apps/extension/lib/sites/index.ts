import { toExtract, type SiteAdapter } from "./adapter";
import { instagram } from "./instagram";
import { tiktok } from "./tiktok";
import { x } from "./x";
import type { PageExtract } from "@spark/core";

export type { SiteAdapter } from "./adapter";

const ADAPTERS: SiteAdapter[] = [x, tiktok, instagram];

/** The adapter for a post's page, else undefined (a timeline, a profile, any other site). */
export function adapterFor(href: string): SiteAdapter | undefined {
  try {
    const url = new URL(href);
    return ADAPTERS.find((adapter) => adapter.matches(url));
  } catch {
    return undefined;
  }
}

/**
 * The post on this page as a page extract, or undefined when there is no
 * adapter, the markup is not the one it knows, or anything throws: the
 * Capture then goes on with the generic reader (and a screenshot), never
 * fails (ADR-0006).
 */
export function readSite(doc: Document, href: string): PageExtract | undefined {
  try {
    const adapter = adapterFor(href);
    const post = adapter?.read(doc, new URL(href));
    return adapter && post ? toExtract(adapter, post) : undefined;
  } catch {
    return undefined;
  }
}
