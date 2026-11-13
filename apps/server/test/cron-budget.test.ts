import { describe, expect, it } from "vitest";
import { CRON_SUBREQUESTS, cronCalls } from "../src/cron-budget";

describe("the hourly cron's call budget", () => {
  it("shares 40 storage and queue calls, and one job cannot spend another's", () => {
    const calls = cronCalls();
    expect(CRON_SUBREQUESTS).toBe(40);
    let uploads = 0;
    while (calls.take("uploads")) uploads += 1;
    expect(uploads).toBe(6);
    expect(calls.take("uploads")).toBe(false);
    expect(calls.remaining("uploads")).toBe(0);
    expect(calls.take("indexing")).toBe(true);
    expect(calls.remaining("accounts")).toBe(6);
    expect(calls.remaining("cleanup")).toBe(4);
    expect(calls.remaining("exports")).toBe(10);
  });
});
