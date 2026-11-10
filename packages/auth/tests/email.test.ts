import { describe, expect, it } from "vitest";
import { resendSender } from "../index";

function fakeFetch(...statuses: (number | "network")[]) {
  const calls: Request[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push(new Request(input, init));
    const next = statuses.shift() ?? 200;
    if (next === "network") throw new TypeError("fetch failed");
    return new Response("{}", { status: next });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const send = (fetch: typeof globalThis.fetch) =>
  resendSender({ apiKey: "re_test", from: "Spark <a@spark.test>", fetch })(
    "person@example.com",
    "123456"
  );

describe("resendSender", () => {
  it("posts the code to Resend with an Idempotency-Key", async () => {
    const { calls, fetch } = fakeFetch(200);
    await send(fetch);
    expect(calls).toHaveLength(1);
    const [req] = calls;
    expect(req!.url).toBe("https://api.resend.com/emails");
    expect(req!.headers.get("authorization")).toBe("Bearer re_test");
    expect(req!.headers.get("idempotency-key")).toMatch(/^sign-in-code\/.+/);
    const body = (await req!.json()) as { to: string[]; text: string };
    expect(body).toMatchObject({ to: ["person@example.com"] });
    expect(body.text).toContain("123456");
  });

  it("retries once under the same key after a 5xx or network error", async () => {
    for (const failure of [503, "network"] as const) {
      const { calls, fetch } = fakeFetch(failure, 200);
      await send(fetch);
      expect(calls).toHaveLength(2);
      expect(calls[1]!.headers.get("idempotency-key")).toBe(
        calls[0]!.headers.get("idempotency-key")
      );
    }
  });

  it("does not retry a 4xx, and fails without the address or code", async () => {
    const { calls, fetch } = fakeFetch(422);
    const error = await send(fetch).catch((e: Error) => e);
    expect(calls).toHaveLength(1);
    expect(String(error)).toContain("422");
    expect(String(error)).not.toMatch(/person@example\.com|123456/);
  });
});
