// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { PageExtract } from "@spark/core";
import { adapterFor, readSite } from "../lib/sites";
import xStatus from "./fixtures/x-status.html?raw";
import xRedesigned from "./fixtures/x-redesigned.html?raw";
import tiktokVideo from "./fixtures/tiktok-video.html?raw";
import tiktokDom from "./fixtures/tiktok-dom-only.html?raw";
import instagramReel from "./fixtures/instagram-reel.html?raw";
import instagramRedesigned from "./fixtures/instagram-redesigned.html?raw";

const dom = (html: string) => {
  document.documentElement.innerHTML = html;
  return document;
};

describe("adapterFor", () => {
  it.each([
    ["https://x.com/anaperez/status/1850000000000000001", "x"],
    ["https://www.tiktok.com/@cook/video/7123456789", "tiktok"],
    ["https://www.instagram.com/reel/C1a_b2/", "instagram"],
    ["https://www.instagram.com/ana.bakes/reel/C1a_b2/", "instagram"],
    ["https://www.instagram.com/p/C1a_b2/", "instagram"],
  ])("reads the post at %s", (url, id) => {
    expect(adapterFor(url)?.id).toBe(id);
  });

  it.each([
    "https://x.com/home",
    "https://x.com/anaperez",
    "https://www.tiktok.com/@cook",
    "https://www.instagram.com/",
    "https://www.instagram.com/ana.bakes/",
    "https://x.com.evil.test/a/status/1",
    "https://twitter.com/anaperez/status/1850000000000000001",
    "https://mobile.twitter.com/anaperez/status/1850000000000000001",
    "https://example.com/post/1",
    "chrome://extensions",
  ])("leaves %s to the generic reader", (url) => {
    expect(adapterFor(url)).toBeUndefined();
  });

  it("asks for exactly one host each, on first use", () => {
    expect(adapterFor("https://x.com/a/status/1")?.origin).toBe(
      "https://x.com"
    );
    expect(adapterFor("https://www.tiktok.com/@a/video/1")?.origin).toBe(
      "https://www.tiktok.com"
    );
    expect(adapterFor("https://www.instagram.com/reel/a/")?.origin).toBe(
      "https://www.instagram.com"
    );
  });
});

describe("what each adapter reads from a saved page", () => {
  it("X: the post in the URL, not the replies below it", () => {
    const post = readSite(
      dom(xStatus),
      "https://x.com/anaperez/status/1850000000000000001"
    );
    expect(post).toEqual({
      title:
        "Shipped the new onboarding today. Two screens, no tour, and the activation rate doubled. #design",
      description:
        "Shipped the new onboarding today. Two screens, no tour, and the activation rate doubled. #design",
      text: "Shipped the new onboarding today. Two screens, no tour, and the activation rate doubled. #design",
      author: "Ana Pérez (@anaperez)",
      siteName: "X",
      publishedAt: "2026-11-09T10:15:00.000Z",
      imageUrl: "https://pbs.twimg.com/media/abc?format=jpg&name=small",
    });
    expect(PageExtract.safeParse(post).success).toBe(true);
    const reply = readSite(
      dom(xStatus),
      "https://x.com/ben/status/1850000000000000002"
    );
    expect(reply?.description).toBe("A reply that is not the post.");
  });

  it("TikTok: the page's own data first, then the visible description", () => {
    const url = "https://www.tiktok.com/@cook/video/7123456789";
    expect(readSite(dom(tiktokVideo), url)).toMatchObject({
      title: "Five minute noodles with chili crisp #noodles #dinner",
      description: "Five minute noodles with chili crisp #noodles #dinner",
      author: "The Cook (@cook)",
      siteName: "TikTok",
      imageUrl: "https://p16.tiktokcdn.com/cover.jpg",
    });
    expect(readSite(dom(tiktokDom), url)).toMatchObject({
      description: "Five minute noodles with chili crisp #noodles",
      author: "@cook",
      siteName: "TikTok",
    });
  });

  it("Instagram: the caption, the author and when", () => {
    expect(
      readSite(dom(instagramReel), "https://www.instagram.com/reel/C1a_b2/")
    ).toEqual({
      title: "Sourdough in 60 seconds. Save this for Sunday. #bread",
      description: "Sourdough in 60 seconds. Save this for Sunday. #bread",
      text: "Sourdough in 60 seconds. Save this for Sunday. #bread",
      author: "@ana.bakes",
      siteName: "Instagram",
      publishedAt: "2026-11-09T08:00:00.000Z",
      imageUrl: "https://scontent.cdninstagram.com/v/cover.jpg",
    });
  });
});

describe("failing soft", () => {
  it("finds nothing, and says so, when a site's markup changes", () => {
    expect(
      readSite(
        dom(xRedesigned),
        "https://x.com/anaperez/status/1850000000000000001"
      )
    ).toBeUndefined();
    expect(
      readSite(
        dom(tiktokDom.replace(/data-e2e/g, "data-x")),
        "https://www.tiktok.com/@cook/video/7"
      )
    ).toBeUndefined();
  });

  it("falls back to the page's Open Graph caption on a redesigned Instagram", () => {
    expect(
      readSite(
        dom(instagramRedesigned),
        "https://www.instagram.com/reel/C1a_b2/"
      )
    ).toMatchObject({
      description: "Sourdough in 60 seconds",
      author: "@ana.bakes",
    });
  });

  it("never throws for a page it cannot read, or a URL that is not a post", () => {
    const broken = {
      querySelectorAll: () => {
        throw new Error("detached");
      },
      querySelector: () => {
        throw new Error("detached");
      },
    } as unknown as Document;
    expect(readSite(broken, "https://x.com/a/status/1")).toBeUndefined();
    expect(readSite(dom(xStatus), "not a url")).toBeUndefined();
    expect(readSite(dom(xStatus), "https://example.com/a")).toBeUndefined();
  });

  it("keeps a very long post within what a Memory can hold", () => {
    const long = "word ".repeat(1000);
    document.body.innerHTML = `<article data-testid="tweet"><div data-testid="tweetText">${long}</div><a href="/a/status/9"><time datetime="2026-01-01T00:00:00Z"></time></a></article>`;
    const post = readSite(document, "https://x.com/a/status/9")!;
    expect(post.description!.length).toBeLessThanOrEqual(2000);
    expect(post.title!.length).toBeLessThanOrEqual(100);
    expect(post.text!.length).toBeGreaterThan(2000);
  });
});
