import { describe, expect, it } from "vitest";
import type { Breadcrumb, ErrorEvent } from "@sentry/cloudflare";
import { sentryOptions } from "../src/sentry";

const SENTINEL = "SENTINEL-blue-tent-note";
const options = sentryOptions({
  SENTRY_DSN: "https://k@o1.ingest.sentry.io/1",
  SPARK_ENV: "dev",
});

describe("sentryOptions", () => {
  it("is off without a DSN", () => {
    expect(sentryOptions({})).toBeUndefined();
  });

  it("uses the environment's DSN and name", () => {
    expect(options).toMatchObject({
      dsn: "https://k@o1.ingest.sentry.io/1",
      environment: "dev",
      dataCollection: { httpBodies: [], userInfo: false },
    });
  });

  it("scrubs Memory content through beforeSend", async () => {
    const event: ErrorEvent = {
      type: undefined,
      message: SENTINEL,
      exception: { values: [{ type: "Error", value: SENTINEL }] },
      contexts: { memory: { title: SENTINEL } },
      request: {
        url: `https://spark.example/api?q=${SENTINEL}`,
        data: SENTINEL,
      },
      extra: { note: SENTINEL },
    };
    const sent = await options!.beforeSend!(event, {});
    expect(JSON.stringify(sent)).not.toContain(SENTINEL);
  });

  it("scrubs Memory content through beforeBreadcrumb", () => {
    const crumb: Breadcrumb = {
      category: "console",
      message: SENTINEL,
      data: { arguments: [SENTINEL] },
    };
    const kept = options!.beforeBreadcrumb!(crumb);
    expect(JSON.stringify(kept)).not.toContain(SENTINEL);
  });
});
