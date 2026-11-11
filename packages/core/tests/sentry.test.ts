import { describe, expect, it } from "vitest";
import { sentryScrubbing } from "../sentry";

const SENTINEL = "SENTINEL-blue-tent-note";

/** An event with the sentinel in every field Sentry can carry. */
function sentinelEvent() {
  const frame = {
    filename: "app.js",
    function: "save",
    lineno: 10,
    colno: 4,
    vars: { note: SENTINEL },
    context_line: SENTINEL,
    pre_context: [SENTINEL],
    post_context: [SENTINEL],
    abs_path: `https://spark.example/app.js?q=${SENTINEL}`,
  };
  return {
    event_id: "abc123",
    timestamp: 1,
    level: "error" as const,
    platform: "javascript",
    environment: "dev",
    release: "1.0.0",
    message: SENTINEL,
    logentry: { message: SENTINEL, params: [SENTINEL] },
    transaction: `/memories/${SENTINEL}`,
    fingerprint: [SENTINEL],
    server_name: SENTINEL,
    dist: SENTINEL,
    exception: {
      values: [
        {
          type: "TypeError",
          value: SENTINEL,
          module: SENTINEL,
          mechanism: { type: "generic", handled: false, data: { x: SENTINEL } },
          stacktrace: { frames: [frame] },
        },
      ],
    },
    tags: { route: "/api/health" },
    contexts: {
      runtime: { name: "cloudflare", version: "1", extra: SENTINEL },
      os: { name: "linux", version: "6", build: SENTINEL },
      memory: { title: SENTINEL },
      response: { body: SENTINEL },
    },
    request: {
      method: "POST",
      url: `https://spark.example/api/search?q=${SENTINEL}#${SENTINEL}`,
      query_string: SENTINEL,
      data: { title: SENTINEL },
      cookies: { s: SENTINEL },
      headers: { "x-note": SENTINEL },
      env: { REMOTE_ADDR: SENTINEL },
    },
    user: { id: SENTINEL, email: SENTINEL, ip_address: SENTINEL },
    extra: { memory: SENTINEL },
    modules: { [SENTINEL]: "1" },
    breadcrumbs: [
      {
        type: "http",
        category: "fetch",
        level: "info" as const,
        timestamp: 2,
        message: SENTINEL,
        data: { url: `/api?q=${SENTINEL}`, body: SENTINEL },
      },
    ],
  };
}

describe("sentryScrubbing.beforeSend", () => {
  it("lets no sentinel through, from any field", () => {
    const scrubbed = sentryScrubbing.beforeSend(sentinelEvent());
    expect(JSON.stringify(scrubbed)).not.toContain(SENTINEL);
  });

  it("keeps only the allowlisted fields", () => {
    expect(sentryScrubbing.beforeSend(sentinelEvent())).toEqual({
      event_id: "abc123",
      timestamp: 1,
      level: "error",
      platform: "javascript",
      environment: "dev",
      release: "1.0.0",
      message: "[redacted]",
      exception: {
        values: [
          {
            type: "TypeError",
            value: "TypeError",
            mechanism: { type: "generic", handled: false },
            stacktrace: {
              frames: [
                { filename: "app.js", function: "save", lineno: 10, colno: 4 },
              ],
            },
          },
        ],
      },
      tags: { route: "/api/health" },
      request: { method: "POST", url: "/api/search" },
      breadcrumbs: [
        { type: "http", category: "fetch", level: "info", timestamp: 2 },
      ],
    });
  });

  it("keeps only the host of a Memory file URL, never its owner's or Memory's ids", () => {
    const user = "user-8f2c";
    const memory = "0b8e5a52-7d3c-4f4e-9a59-2f8f6d0c1e11";
    const urls = [
      `https://acct.r2.cloudflarestorage.com/spark-files-prod/users/${user}/${memory}/original?X-Amz-Signature=abc`,
      `http://localhost:8787/api/local-files/users/${user}/${memory}/thumbnail?sig=abc`,
      `/api/local-files/users/${user}/${memory}/original`,
    ];
    const kept = urls.map(
      (url) =>
        (
          sentryScrubbing.beforeSend({ request: { method: "PUT", url } }) as {
            request: { url: string };
          }
        ).request.url
    );
    expect(kept).toEqual([
      "acct.r2.cloudflarestorage.com",
      "/api/local-files",
      "/api/local-files",
    ]);
  });

  it("replaces a captured message with a fixed string", () => {
    const scrubbed = sentryScrubbing.beforeSend({
      message: SENTINEL,
      level: "info" as const,
    });
    expect(scrubbed).toEqual({ level: "info", message: "[redacted]" });
  });

  const SENTENCE = "My note: the blue tent, by the lake (2019)!";

  it("replaces an exception type built from content with Error", () => {
    const scrubbed = sentryScrubbing.beforeSend({
      exception: { values: [{ type: SENTENCE, value: SENTENCE }] },
    });
    expect(JSON.stringify(scrubbed)).not.toContain("blue tent");
    expect(scrubbed).toEqual({
      exception: { values: [{ type: "Error", value: "Error" }] },
    });
  });

  it("drops contexts entirely, including prose in runtime/os names", () => {
    const prose = "My private note about the blue tent";
    const scrubbed = sentryScrubbing.beforeSend({
      level: "error" as const,
      contexts: {
        runtime: { name: prose, version: SENTENCE },
        os: { name: SENTINEL, version: prose },
        memory: { title: prose },
      },
    });
    expect(JSON.stringify(scrubbed)).not.toContain("blue tent");
    expect(JSON.stringify(scrubbed)).not.toContain(SENTINEL);
    expect(scrubbed).not.toHaveProperty("contexts");
    expect(scrubbed).toEqual({ level: "error" });
  });

  it("is also the transaction scrubber", () => {
    expect(sentryScrubbing.beforeSendTransaction).toBe(
      sentryScrubbing.beforeSend
    );
  });
});

describe("sentryScrubbing.beforeBreadcrumb", () => {
  it("keeps the breadcrumb kind and time, and none of its text", () => {
    const crumb = sentinelEvent().breadcrumbs[0]!;
    const scrubbed = sentryScrubbing.beforeBreadcrumb(crumb);
    expect(JSON.stringify(scrubbed)).not.toContain(SENTINEL);
    expect(scrubbed).toEqual({
      type: "http",
      category: "fetch",
      level: "info",
      timestamp: 2,
    });
  });
});

describe("sentryScrubbing.dataCollection", () => {
  it("collects no bodies, cookies, headers, query strings or user info", () => {
    expect(sentryScrubbing.dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
  });
});
