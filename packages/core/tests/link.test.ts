import { describe, expect, it } from "vitest";
import { LinkCapture, linkFromPaste, normaliseUrl, sourceHost } from "../index";

describe("normaliseUrl", () => {
  it("strips tracking parameters and the fragment", () => {
    expect(
      normaliseUrl(
        "https://Example.com/a?utm_source=x&id=7&fbclid=1&gclid=2&UTM_Medium=y#top"
      )
    ).toBe("https://example.com/a?id=7");
  });

  it("strips every known tracker and keeps the rest in a stable order", () => {
    expect(
      normaliseUrl(
        "https://example.com/p?z=1&mc_cid=1&a=2&igshid=3&msclkid=4&_ga=5&yclid=6&dclid=7&mc_eid=8&twclid=9"
      )
    ).toBe("https://example.com/p?a=2&z=1");
  });

  it("drops default ports, a bare trailing ? and lowercases scheme and host", () => {
    expect(normaliseUrl("HTTP://WWW.Example.COM:80/Path?")).toBe(
      "http://www.example.com/Path"
    );
    expect(normaliseUrl("https://example.com:443")).toBe(
      "https://example.com/"
    );
  });

  it("treats the same page saved twice with different tracking as one", () => {
    expect(normaliseUrl("https://a.com/x?utm_campaign=1")).toBe(
      normaliseUrl("https://a.com/x?fbclid=abc#section")
    );
  });

  it("refuses anything that is not an http or https URL", () => {
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://example.com/",
      "data:text/html,hi",
      "not a url",
      "",
    ]) {
      expect(normaliseUrl(bad)).toBeUndefined();
    }
  });

  it("refuses URLs that carry a username or password", () => {
    expect(normaliseUrl("https://user:pass@example.com/")).toBeUndefined();
  });
});

describe("linkFromPaste", () => {
  it("is the URL when the paste is one link", () => {
    expect(linkFromPaste("  https://example.com/a?b=1 \n")).toBe(
      "https://example.com/a?b=1"
    );
  });

  it("is undefined for text that only contains a link", () => {
    expect(linkFromPaste("read this https://example.com")).toBeUndefined();
    expect(linkFromPaste("https://a.com\nhttps://b.com")).toBeUndefined();
    expect(linkFromPaste("example.com")).toBeUndefined();
    expect(linkFromPaste("mailto:a@b.com")).toBeUndefined();
  });
});

describe("sourceHost", () => {
  it("is the host without www", () => {
    expect(sourceHost("https://www.nytimes.com/2026/a.html")).toBe(
      "nytimes.com"
    );
    expect(sourceHost("nonsense")).toBeUndefined();
  });
});

describe("LinkCapture", () => {
  it("accepts a link and caps its length", () => {
    expect(LinkCapture.safeParse({ url: "https://a.com/" }).success).toBe(true);
    expect(
      LinkCapture.safeParse({ url: `https://a.com/${"x".repeat(5000)}` })
        .success
    ).toBe(false);
    expect(LinkCapture.safeParse({ url: "javascript:1" }).success).toBe(false);
  });
});
