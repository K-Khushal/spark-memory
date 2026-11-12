import { describe, expect, it, vi } from "vitest";
import {
  DAILY_BUDGET_MAX_MICROS,
  INDEXING,
  budgetPaused,
  effectiveDailyBudgetMicros,
  allowOutgoingProductEvent,
  isAdmin,
  isVerifiedAdmin,
  parseDailyBudgetMicros,
  productAnalyticsEnabled,
  productPayload,
  publicAnalytics,
  rolesFor,
  sendProductEvent,
} from "../index";

describe("admin role", () => {
  it("grants admin only to addresses in the configured list", () => {
    const list = " Owner@Example.com , other@example.com ";
    expect(isAdmin("owner@example.com", list)).toBe(true);
    expect(isAdmin("OTHER@example.com", list)).toBe(true);
    expect(rolesFor("owner@example.com", list)).toEqual(["admin"]);
    expect(isAdmin("person@example.com", list)).toBe(false);
    expect(rolesFor("person@example.com", list)).toEqual([]);
  });

  it("requires a verified address as well as the list", () => {
    const list = "owner@example.com";
    expect(
      isVerifiedAdmin({ email: "owner@example.com", emailVerified: true }, list)
    ).toBe(true);
    expect(
      isVerifiedAdmin(
        { email: "owner@example.com", emailVerified: false },
        list
      )
    ).toBe(false);
    expect(
      isVerifiedAdmin({ email: "other@example.com", emailVerified: true }, list)
    ).toBe(false);
  });

  it("grants nobody when the list is missing or empty", () => {
    expect(isAdmin("owner@example.com", undefined)).toBe(false);
    expect(isAdmin("owner@example.com", "")).toBe(false);
    expect(isAdmin("owner@example.com", " , ")).toBe(false);
  });
});

describe("daily budget", () => {
  it("uses the stored integer, and $1 when nothing usable is stored", () => {
    expect(effectiveDailyBudgetMicros(null)).toBe(INDEXING.dailyBudgetMicros);
    expect(effectiveDailyBudgetMicros(undefined)).toBe(
      INDEXING.dailyBudgetMicros
    );
    expect(effectiveDailyBudgetMicros("2500000")).toBe(2_500_000);
    expect(effectiveDailyBudgetMicros("0")).toBe(0);
    expect(effectiveDailyBudgetMicros("nope")).toBe(INDEXING.dailyBudgetMicros);
    expect(effectiveDailyBudgetMicros("-5")).toBe(INDEXING.dailyBudgetMicros);
  });

  it("clamps a stored value above the cap to $20", () => {
    expect(effectiveDailyBudgetMicros("20000001")).toBe(20_000_000);
    expect(effectiveDailyBudgetMicros("100000000000")).toBe(20_000_000);
  });

  it("caps the editable budget at $20 a day", () => {
    expect(DAILY_BUDGET_MAX_MICROS).toBe(20_000_000);
  });

  it("accepts an integer from $0 up to the cap", () => {
    expect(parseDailyBudgetMicros(0)).toEqual({ ok: true, micros: 0 });
    expect(parseDailyBudgetMicros(1_500_000)).toEqual({
      ok: true,
      micros: 1_500_000,
    });
    expect(parseDailyBudgetMicros(DAILY_BUDGET_MAX_MICROS)).toEqual({
      ok: true,
      micros: DAILY_BUDGET_MAX_MICROS,
    });
    expect(parseDailyBudgetMicros(-1).ok).toBe(false);
    expect(parseDailyBudgetMicros(1.5).ok).toBe(false);
    expect(parseDailyBudgetMicros("1000000").ok).toBe(false);
    expect(parseDailyBudgetMicros(DAILY_BUDGET_MAX_MICROS + 1).ok).toBe(false);
  });

  it("pauses once spend reaches the limit", () => {
    expect(budgetPaused(999_999, 1_000_000)).toBe(false);
    expect(budgetPaused(1_000_000, 1_000_000)).toBe(true);
    expect(budgetPaused(0, 0)).toBe(true);
  });
});

describe("product events", () => {
  it("sends the activation event with no properties, whatever it is given", () => {
    expect(
      productPayload({
        event: "first_successful_search",
        properties: { query: "secret" } as unknown as Record<string, never>,
      })
    ).toEqual({ event: "first_successful_search", properties: {} });
  });
  it("sends only the allowed properties for each event", () => {
    expect(
      productPayload({ event: "save_success", properties: { kind: "text" } })
    ).toEqual({ event: "save_success", properties: { kind: "text" } });
    expect(
      productPayload({
        event: "time_to_searchable",
        properties: { kind: "image", milliseconds: 1200 },
      })
    ).toEqual({
      event: "time_to_searchable",
      properties: { kind: "image", milliseconds: 1200 },
    });
    expect(
      productPayload({
        event: "search_success",
        properties: { direct: 2, related: 1 },
      })
    ).toEqual({
      event: "search_success",
      properties: { direct: 2, related: 1 },
    });
    expect(
      productPayload({ event: "search_reformulated", properties: {} })
    ).toEqual({ event: "search_reformulated", properties: {} });
    expect(
      productPayload({
        event: "time_to_find",
        properties: { milliseconds: 800 },
      })
    ).toEqual({ event: "time_to_find", properties: { milliseconds: 800 } });
  });

  it("keeps only the event's own keys, the distinct id and the token", () => {
    const sentAt = new Date("2026-11-11T00:00:00.000Z");
    const kept = allowOutgoingProductEvent({
      uuid: "evt-1",
      event: "time_to_searchable",
      timestamp: sentAt,
      properties: {
        token: "phc_test",
        distinct_id: "user-1",
        kind: "text",
        milliseconds: 1200,
        $current_url: "https://app.example/library?q=secret+lemon",
        $referrer: "https://campaign.example/?utm=1",
        $browser: "Chrome",
        utm_campaign: "spring",
        $el_text: "private lemon tart text",
      },
    });
    expect(kept).toEqual({
      uuid: "evt-1",
      event: "time_to_searchable",
      timestamp: sentAt,
      properties: {
        token: "phc_test",
        distinct_id: "user-1",
        kind: "text",
        milliseconds: 1200,
      },
    });
    expect(JSON.stringify(kept)).not.toContain("lemon");
    expect(JSON.stringify(kept)).not.toContain("utm");
    expect(
      allowOutgoingProductEvent({
        event: "$dead_click",
        properties: { $el_text: "private lemon tart text" },
      })
    ).toBeNull();
    expect(
      allowOutgoingProductEvent({ event: "$pageview", properties: {} })
    ).toBeNull();
    expect(
      allowOutgoingProductEvent({ event: "toString", properties: {} })
    ).toBeNull();
    expect(
      allowOutgoingProductEvent({ event: "constructor", properties: {} })
    ).toBeNull();
  });

  it("withholds the key unless the host is https", () => {
    expect(
      publicAnalytics({ key: "phc_test", host: "http://evil.example" })
    ).toEqual({ key: null, host: "http://evil.example" });
    expect(
      publicAnalytics({ key: "phc_test", host: "https://eu.i.posthog.com" })
    ).toEqual({ key: "phc_test", host: "https://eu.i.posthog.com" });
    expect(publicAnalytics({ key: null })).toEqual({
      key: null,
      host: "https://us.i.posthog.com",
    });
  });

  it("stays off without a key and when Do Not Track is set", () => {
    expect(productAnalyticsEnabled({ key: null, doNotTrack: null })).toBe(
      false
    );
    expect(productAnalyticsEnabled({ key: "", doNotTrack: null })).toBe(false);
    expect(productAnalyticsEnabled({ key: "phc_test", doNotTrack: "1" })).toBe(
      false
    );
    expect(
      productAnalyticsEnabled({ key: "phc_test", doNotTrack: "yes" })
    ).toBe(false);
    expect(productAnalyticsEnabled({ key: "phc_test", doNotTrack: "0" })).toBe(
      true
    );
    expect(productAnalyticsEnabled({ key: "phc_test", doNotTrack: null })).toBe(
      true
    );
  });

  it("posts the capture payload and never throws when the call fails", async () => {
    const fetch = vi.fn(async (_url: string, _init: { body: string }) => ({
      ok: true,
    }));
    const event = {
      event: "save_success" as const,
      properties: { kind: "image" as const },
    };
    expect(
      await sendProductEvent({
        key: "phc_test",
        distinctId: "user-1",
        event,
        fetch,
      })
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://us.i.posthog.com/capture/");
    expect(JSON.parse(init.body)).toEqual({
      api_key: "phc_test",
      event: "save_success",
      distinct_id: "user-1",
      properties: { kind: "image" },
    });

    expect(
      await sendProductEvent({
        key: undefined,
        distinctId: "user-1",
        event,
        fetch,
      })
    ).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);

    expect(
      await sendProductEvent({
        key: "phc_test",
        host: "http://evil.example",
        distinctId: "user-1",
        event,
        fetch,
      })
    ).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async () => {
      throw new Error("timed out");
    });
    expect(
      await sendProductEvent({
        key: "phc_test",
        distinctId: "user-1",
        event,
        fetch: failing,
      })
    ).toBe(false);
  });
});
