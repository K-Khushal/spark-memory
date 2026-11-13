import { describe, expect, it } from "vitest";
import {
  budgetWindow,
  DEEP_FETCH,
  engineFor,
  isThin,
  modelCostMicros,
  retryDelaySeconds,
  secondsToNextUtcDay,
} from "../index";

const readable = "word ".repeat(100);

describe("isThin", () => {
  it("is thin when a link has no readable text, and only then", () => {
    const image = { imageUrl: "https://example.com/a.png" };
    expect(isThin({ kind: "link", text: null, metadata: image })).toBe(true);
    expect(isThin({ kind: "link", text: null, metadata: {} })).toBe(true);
    // A missing image alone never triggers a Deep fetch.
    expect(isThin({ kind: "link", text: readable, metadata: {} })).toBe(false);
    expect(isThin({ kind: "link", text: readable, metadata: image })).toBe(
      false
    );
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

it("retries after one hour, then 24 hours, then stops, in three attempts", () => {
  expect(retryDelaySeconds(1)).toBe(3600);
  expect(retryDelaySeconds(2)).toBe(86400);
  expect(retryDelaySeconds(3)).toBeUndefined();
  expect(DEEP_FETCH.maxAttempts).toBe(DEEP_FETCH.retryDelaysSeconds.length + 1);
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

describe("modelCostMicros", () => {
  it("prices audio input with its own price, and text with the input price", () => {
    const flashLite = "gemini-3.5-flash-lite";
    expect(
      modelCostMicros(flashLite, { inputTokens: 1_000_000, outputTokens: 0 })
    ).toBe(300_000);
    expect(
      modelCostMicros(flashLite, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        audio: true,
      })
    ).toBe(300_000 + 2_500_000);
  });
  it("charges audio as text where a model has no audio price, and nothing for an unknown model", () => {
    expect(
      modelCostMicros("gemini-3.1-flash-lite", {
        inputTokens: 1_000_000,
        outputTokens: 0,
        audio: true,
      })
    ).toBe(250_000);
    expect(modelCostMicros("nope", { inputTokens: 5, outputTokens: 5 })).toBe(
      0
    );
  });
});
