import { describe, expect, it } from "vitest";
import { redact } from "../index";

const TOKEN = "XcCJ4u5fRUmtdwxnCVMTYgIIw9AzAF4e";

describe("redact", () => {
  it("keeps a plain-word message and drops its arguments", () => {
    expect(
      redact("Cloudflare Turnstile verification failed", [{ email: "a@b.co" }])
    ).toBe("Cloudflare Turnstile verification failed");
  });

  it("drops a failed query's message and names the database failure", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
      code: "ECONNREFUSED",
    });
    const error = new Error(
      `Failed query: select * from "session" where "token" = $1\nparams: ${TOKEN}`,
      { cause }
    );
    const line = redact(error);
    expect(line).toBe("[redacted] (refused)");
    expect(redact("Error", [error])).not.toContain(TOKEN);
  });

  it("drops messages with addresses, digits or long runs of letters", () => {
    for (const message of [
      "Sent to person@example.com",
      "Code 123456",
      `Session ${TOKEN.replace(/\d/g, "x")}`,
    ]) {
      expect(redact(message)).toBe("[redacted]");
    }
  });
});
