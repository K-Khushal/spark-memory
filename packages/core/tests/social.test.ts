import { describe, expect, it } from "vitest";
import {
  ReelCopy,
  instagramReel,
  isVideoUrl,
  normaliseUrl,
  socialPlatform,
} from "../index";

describe("social posts", () => {
  it("names the platform by its real hosts only", () => {
    expect(socialPlatform("https://x.com/jack/status/20")).toBe("x");
    expect(socialPlatform("https://mobile.twitter.com/jack/status/20")).toBe(
      "x"
    );
    expect(socialPlatform("https://www.tiktok.com/@a/video/1")).toBe("tiktok");
    expect(socialPlatform("https://vm.tiktok.com/ZMabc/")).toBe("tiktok");
    expect(socialPlatform("https://www.instagram.com/p/Cabc/")).toBe(
      "instagram"
    );
    expect(
      socialPlatform("https://x.com.evil.test/a/status/1")
    ).toBeUndefined();
    expect(socialPlatform("https://notinstagram.com/p/a")).toBeUndefined();
    expect(socialPlatform("not a url")).toBeUndefined();
  });

  it("finds a reel's code in each URL form, and nothing else", () => {
    for (const url of [
      "https://www.instagram.com/reel/C1a_b-2/?igsh=x",
      "https://instagram.com/reels/C1a_b-2/",
      "https://www.instagram.com/someone/reel/C1a_b-2/",
    ])
      expect(instagramReel(url)).toBe("C1a_b-2");
    expect(
      instagramReel("https://www.instagram.com/p/C1a_b-2/")
    ).toBeUndefined();
    expect(instagramReel("https://www.instagram.com/reels/")).toBeUndefined();
    expect(
      instagramReel("https://instagram.com.evil.test/reel/C1a_b-2/")
    ).toBeUndefined();
  });

  it("treats a reel as a video, so its transcript can be shown", () => {
    expect(isVideoUrl("https://www.instagram.com/reel/C1a_b-2/")).toBe(true);
    expect(isVideoUrl("https://www.instagram.com/p/C1a_b-2/")).toBe(false);
  });

  it("gives every form of one post one normalised URL", () => {
    expect(normaliseUrl("https://twitter.com/jack/status/20?s=20&t=abc")).toBe(
      "https://x.com/jack/status/20"
    );
    expect(normaliseUrl("https://x.com/jack/status/20/photo/1")).toBe(
      "https://x.com/jack/status/20"
    );
    expect(
      normaliseUrl("https://tiktok.com/@a/video/1?is_from_webapp=1&lang=en")
    ).toBe("https://www.tiktok.com/@a/video/1");
    expect(normaliseUrl("https://instagram.com/u/reel/C1a/?igsh=1")).toBe(
      "https://www.instagram.com/reel/C1a/"
    );
    expect(normaliseUrl("https://instagram.com/reels/C1a")).toBe(
      "https://www.instagram.com/reel/C1a/"
    );
    // The three forms that used to slip through.
    expect(normaliseUrl("https://x.com/i/web/status/20?s=20")).toBe(
      "https://x.com/i/status/20"
    );
    expect(normaliseUrl("https://x.com/i/status/20")).toBe(
      "https://x.com/i/status/20"
    );
    expect(
      normaliseUrl("https://www.tiktok.com/@a/photo/7123?is_from_webapp=1")
    ).toBe("https://www.tiktok.com/@a/photo/7123");
    expect(
      normaliseUrl("https://instagram.com/p/C1a_b-2/?img_index=3&igsh=x")
    ).toBe("https://www.instagram.com/p/C1a_b-2/");
    expect(normaliseUrl("https://instagram.com/ana.bakes/p/C1a_b-2")).toBe(
      "https://www.instagram.com/p/C1a_b-2/"
    );
    // Anything else on these hosts keeps the general rule.
    expect(normaliseUrl("https://x.com/jack?lang=en&utm_source=a")).toBe(
      "https://x.com/jack?lang=en"
    );
  });
});

describe("ReelCopy", () => {
  const ok = {
    bytes: 5_000_000,
    duration: 42,
    frames: [{ seconds: 0, bytes: 40_000, width: 540, height: 960 }],
  };
  it("accepts one video and a few small frames", () => {
    expect(ReelCopy.safeParse(ok).success).toBe(true);
  });
  it("refuses frames that are too many, too big or outside the video", () => {
    const frame = ok.frames[0]!;
    expect(
      ReelCopy.safeParse({ ...ok, frames: Array(9).fill(frame) }).success
    ).toBe(false);
    expect(
      ReelCopy.safeParse({ ...ok, frames: [{ ...frame, bytes: 900_000 }] })
        .success
    ).toBe(false);
    expect(
      ReelCopy.safeParse({ ...ok, frames: [{ ...frame, seconds: 99 }] }).success
    ).toBe(false);
    expect(ReelCopy.safeParse({ ...ok, frames: [] }).success).toBe(false);
  });
  it("leaves the size limit to the Free allowance, which says why", () => {
    expect(ReelCopy.safeParse({ ...ok, bytes: 90_000_000 }).success).toBe(true);
  });
});
