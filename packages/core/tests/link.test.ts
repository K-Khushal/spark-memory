import { describe, expect, it } from "vitest";
import {
  displayHost,
  LinkCapture,
  linkFromPaste,
  normaliseUrl,
  sourceHost,
} from "../index";

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
        "https://example.com/p?z=1&mc_cid=1&a=2&igshid=3&msclkid=4&_ga=5&yclid=6&dclid=7&mc_eid=8&twclid=9&si=x&ref_src=tw&mibextid=m&igsh=i"
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

  it("shows an international Latin host in Unicode and stores it unchanged", () => {
    expect(sourceHost("https://www.münchen.de/karte")).toBe("münchen.de");
    expect(sourceHost("https://bücher.de/")).toBe("bücher.de");
    // The key the Library files it under is still ASCII, whatever was pasted.
    expect(normaliseUrl("https://münchen.de/karte")).toContain(
      "xn--mnchen-3ya.de"
    );
    expect(normaliseUrl("https://xn--mnchen-3ya.de/karte")).toBe(
      normaliseUrl("https://münchen.de/karte")
    );
  });

  it("keeps punycode for any other script, so a lookalike never reads as the real host", () => {
    // All Cyrillic: reads as "apple" in many fonts.
    expect(sourceHost("https://аррӏе.com/")).toBe("xn--80ak6aa92e.com");
    // Latin "a" beside a Cyrillic "ԁ".
    expect(sourceHost("https://aԁ.com/")).toBe("xn--a-64b.com");
    expect(sourceHost("https://日本語.jp/")).toBe("xn--wgv71a119e.jp");
  });
});

describe("displayHost", () => {
  it("decodes Latin labels and leaves the rest alone", () => {
    expect(displayHost("xn--bcher-kva.de")).toBe("bücher.de");
    expect(displayHost("xn--mnchen-3ya.de")).toBe("münchen.de");
    expect(displayHost("shop.xn--bcher-kva.example")).toBe(
      "shop.bücher.example"
    );
    expect(displayHost("nytimes.com")).toBe("nytimes.com");
  });

  it("keeps punycode for a label that is not wholly Latin", () => {
    expect(displayHost("xn--80ak6aa92e.com")).toBe("xn--80ak6aa92e.com");
    expect(displayHost("xn--a-64b.com")).toBe("xn--a-64b.com");
    expect(displayHost("xn--pple-43d.com")).toBe("xn--pple-43d.com");
    expect(displayHost("xn--r8jz45g.jp")).toBe("xn--r8jz45g.jp");
  });

  it("keeps the whole host as punycode under a TLD that is not Latin", () => {
    expect(displayHost("xn--e1afmkfd.xn--p1ai")).toBe("xn--e1afmkfd.xn--p1ai");
    // Even a Latin label beside a Cyrillic TLD.
    expect(displayHost("xn--bcher-kva.xn--p1ai")).toBe(
      "xn--bcher-kva.xn--p1ai"
    );
  });

  it("keeps punycode that does not decode", () => {
    expect(displayHost("xn--")).toBe("xn--");
    expect(displayHost("xn--!!.com")).toBe("xn--!!.com");
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
it("ignores playback time only for YouTube video duplicate detection", () => {
  expect(normaliseUrl("https://www.youtube.com/watch?v=abc&t=42s")).toBe(
    "https://www.youtube.com/watch?v=abc"
  );
  expect(normaliseUrl("https://youtu.be/abc?t=99")).toBe(
    "https://youtu.be/abc"
  );
  expect(normaliseUrl("https://youtube.com/@basil?t=99")).toBe(
    "https://youtube.com/@basil?t=99"
  );
  expect(normaliseUrl("https://example.com/watch?v=abc&t=42")).toBe(
    "https://example.com/watch?t=42&v=abc"
  );
});
