import { describe, expect, it } from "vitest";
import {
  budgetWindow,
  engineFor,
  isThin,
  retryDelaySeconds,
  secondsToNextUtcDay,
} from "../index";

const readable = "word ".repeat(100);

describe("isThin", () => {
  it("is thin when a link has no readable text, or no image", () => {
    const metadata = { imageUrl: "https://example.com/a.png" };
    expect(isThin({ kind: "link", text: null, metadata })).toBe(true);
    expect(isThin({ kind: "link", text: readable, metadata: {} })).toBe(true);
    expect(isThin({ kind: "link", text: readable, metadata })).toBe(false);
  });
  it("is thin for a video only when it has no transcript to give", () => {
    const video = (
      transcriptState: "available" | "unavailable" | "over_allowance"
    ) => ({
      kind: "video" as const,
      text: null,
      metadata: { video: { transcript: [], transcriptState } },
    });
    expect(isThin(video("unavailable"))).toBe(true);
    expect(isThin(video("available"))).toBe(false);
    expect(isThin(video("over_allowance"))).toBe(false);
  });
  it("never applies to other kinds", () => {
    expect(isThin({ kind: "text", text: null, metadata: {} })).toBe(false);
    expect(engineFor("pdf")).toBeUndefined();
    expect(engineFor("link")).toBe("page");
    expect(engineFor("video")).toBe("media");
  });
});

it("retries after one hour, then 24 hours, then stops", () => {
  expect(retryDelaySeconds(1)).toBe(3600);
  expect(retryDelaySeconds(2)).toBe(86400);
  expect(retryDelaySeconds(3)).toBeUndefined();
});

it("counts the seconds to the next UTC day", () => {
  expect(secondsToNextUtcDay(new Date("2026-11-30T23:59:30Z"))).toBe(30);
  expect(secondsToNextUtcDay(new Date("2026-11-30T00:00:00Z"))).toBe(86400);
});

describe("budgetWindow", () => {
  const now = new Date("2026-11-30T23:00:00Z");
  it("counts pages by UTC day and media by month", () => {
    expect(budgetWindow("page", now)).toEqual({
      key: "2026-11-30",
      secondsToNext: 3600,
    });
    expect(budgetWindow("media", now)).toEqual({
      key: "2026-11",
      secondsToNext: 3600,
    });
    expect(budgetWindow("media", new Date("2026-12-31T00:00:00Z")).key).toBe(
      "2026-12"
    );
  });
});
