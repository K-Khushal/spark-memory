import { describe, expect, it } from "vitest";
import {
  isSharePost,
  judgeShare,
  refusalPath,
  shellCacheName,
  SHELL_CACHE_PREFIX,
} from "./policy";

const origin = "https://spark.example";
const request = (url: string, method: string) => new Request(url, { method });

describe("isSharePost", () => {
  it("is the share-target action on this origin", () => {
    expect(isSharePost(request(`${origin}/share`, "POST"), origin)).toBe(true);
  });

  it.each([
    [`${origin}/share`, "GET"],
    [`${origin}/api/share`, "POST"],
    [`${origin}/`, "POST"],
    ["https://other.example/share", "POST"],
  ])("is not %s %s", (url, method) => {
    expect(isSharePost(request(url, method), origin)).toBe(false);
  });
});

describe("shellCacheName", () => {
  it("is versioned and prefixed, so user data can be told apart", () => {
    expect(shellCacheName("abc")).toBe(`${SHELL_CACHE_PREFIX}abc`);
  });
});

describe("judgeShare", () => {
  const post = (headers: Record<string, string>, referrer?: string) =>
    new Request(`${origin}/share`, { method: "POST", headers, referrer });

  it("accepts a share with no Origin (the share sheet) or our own", () => {
    expect(judgeShare(post({}), origin)).toBe("accept");
    expect(judgeShare(post({ origin }), origin)).toBe("accept");
    expect(judgeShare(post({}, `${origin}/library`), origin)).toBe("accept");
  });

  it("refuses an attacker's Origin, so a cross-site form is never held", () => {
    for (const attacker of [
      "https://evil.example",
      "http://spark.example",
      "https://spark.example.evil.example",
    ]) {
      expect(judgeShare(post({ origin: attacker }), origin), attacker).toBe(
        "refuse"
      );
    }
  });

  it("refuses a post from a page on another site", () => {
    expect(judgeShare(post({}, "https://evil.example/page"), origin)).toBe(
      "refuse"
    );
  });

  it("asks before Capturing a post whose Origin is hidden, which a form can fake", () => {
    expect(judgeShare(post({ origin: "null" }), origin)).toBe("confirm");
  });
});

describe("refusalPath", () => {
  it("is the page that says why a share was turned away", () => {
    expect(refusalPath("too_large")).toBe("/share?refused=too_large");
  });
});
