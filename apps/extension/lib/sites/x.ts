import type { SiteAdapter } from "./adapter";

const STATUS = /^\/\w{1,15}\/status\/(\d+)/;

/** x.com/<handle>/status/<id>: the post in the URL, not the replies beneath it. */
export const x: SiteAdapter = {
  id: "x",
  origin: "https://x.com",
  matches: (url) => url.hostname === "x.com" && STATUS.test(url.pathname),
  read(doc, url) {
    const id = STATUS.exec(url.pathname)?.[1];
    const articles = [
      ...doc.querySelectorAll<HTMLElement>('article[data-testid="tweet"]'),
    ];
    const post =
      articles.find((a) =>
        [...a.querySelectorAll("a[href]")].some((l) =>
          l.getAttribute("href")?.endsWith(`/status/${id}`)
        )
      ) ?? articles[0];
    const text = post
      ?.querySelector('[data-testid="tweetText"]')
      ?.textContent?.trim();
    if (!post || !text) return undefined;
    const names = post.querySelector('[data-testid="User-Name"]')?.textContent;
    const handle = names?.match(/@\w{1,15}/)?.[0];
    const name = names?.replace(handle ?? "", "").trim();
    return {
      text,
      author:
        name && handle
          ? `${name} (${handle})`
          : (handle ?? (name || undefined)),
      publishedAt:
        post.querySelector("time[datetime]")?.getAttribute("datetime") ??
        undefined,
      imageUrl:
        post.querySelector<HTMLImageElement>('[data-testid="tweetPhoto"] img')
          ?.src ||
        post.querySelector<HTMLVideoElement>("video[poster]")?.poster ||
        undefined,
    };
  },
};
