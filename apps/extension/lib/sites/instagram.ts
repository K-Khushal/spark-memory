import type { SiteAdapter } from "./adapter";

const POST = /^\/(?:[\w.]+\/)?(?:p|reels?)\/[\w-]+/;

const meta = (doc: Document, property: string) =>
  doc.querySelector(`meta[property="${property}"]`)?.getAttribute("content") ??
  undefined;

/** Instagram's own caption line: `N likes - handle on Date: "caption".` */
const shared = /-\s+([\w.]+)\s+on\s+[^:]+:\s+["“](.+?)["”]\.?\s*$/s;

/** instagram.com/p/<code>, /reel/<code> and /<user>/reel/<code>. */
export const instagram: SiteAdapter = {
  id: "instagram",
  origin: "https://www.instagram.com",
  matches: (url) =>
    url.hostname === "www.instagram.com" && POST.test(url.pathname),
  read(doc) {
    const caption = doc
      .querySelector("article h1, main h1")
      ?.textContent?.trim();
    const fallback = shared.exec(meta(doc, "og:description") ?? "");
    const text = caption || fallback?.[2]?.trim();
    if (!text) return undefined;
    const user = doc
      .querySelector('article header a[href^="/"], main header a[href^="/"]')
      ?.textContent?.trim();
    const handle = user || fallback?.[1];
    return {
      text,
      author: handle && (handle.startsWith("@") ? handle : `@${handle}`),
      publishedAt:
        doc
          .querySelector("article time[datetime], main time[datetime]")
          ?.getAttribute("datetime") ?? undefined,
      imageUrl: meta(doc, "og:image"),
    };
  },
};
