import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/cloudflare";
import { scrubEvent, sentryOptions } from "../src/sentry";

const memoryText = "my private note about the blue tent";

function eventWithContent(): ErrorEvent {
  return {
    type: undefined,
    message: "boom",
    exception: { values: [{ type: "Error", value: "boom" }] },
    tags: { route: "/api/memories" },
    request: {
      method: "POST",
      url: `https://spark.example/api/search?q=${encodeURIComponent(memoryText)}#x`,
      query_string: `q=${memoryText}`,
      data: { title: memoryText },
      cookies: { session: "secret" },
      headers: { cookie: "session=secret", "user-agent": "test" },
    },
    user: { id: "u1", email: "a@b.c", ip_address: "1.2.3.4" },
    extra: { memory: memoryText },
    breadcrumbs: [
      { category: "console", message: memoryText, timestamp: 1 },
      {
        category: "fetch",
        type: "http",
        data: { url: `/api/search?q=${memoryText}`, body: memoryText },
        timestamp: 2,
      },
    ],
  };
}

describe("scrubEvent", () => {
  it("removes request bodies, cookies, headers and query strings", () => {
    const { request } = scrubEvent(eventWithContent());
    expect(request).toEqual({
      method: "POST",
      url: "https://spark.example/api/search",
    });
  });

  it("removes Memory content from user, extra and breadcrumbs", () => {
    const scrubbed = scrubEvent(eventWithContent());
    expect(JSON.stringify(scrubbed)).not.toContain("blue tent");
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.breadcrumbs).toEqual([
      { category: "console", timestamp: 1 },
      { category: "fetch", type: "http", timestamp: 2 },
    ]);
  });

  it("keeps what debugging needs", () => {
    const scrubbed = scrubEvent(eventWithContent());
    expect(scrubbed.exception).toEqual(eventWithContent().exception);
    expect(scrubbed.tags).toEqual({ route: "/api/memories" });
  });
});

describe("sentryOptions", () => {
  it("is off without a DSN", () => {
    expect(sentryOptions({})).toBeUndefined();
  });

  it("collects no bodies, cookies, headers, query strings or user info", () => {
    const options = sentryOptions({
      SENTRY_DSN: "https://k@o1.ingest.sentry.io/1",
      SPARK_ENV: "dev",
    });
    expect(options).toMatchObject({
      dsn: "https://k@o1.ingest.sentry.io/1",
      environment: "dev",
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
      },
    });
    expect(options?.beforeSend).toBe(scrubEvent);
  });
});
