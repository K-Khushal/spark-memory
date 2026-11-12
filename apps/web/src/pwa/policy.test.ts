import { describe, expect, it } from "vitest";
import { isSharePost, shellCacheName, SHELL_CACHE_PREFIX } from "./policy";

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
