import { describe, expect, it } from "vitest";
import { sharedFlight, type Flight } from "./shared-flight";

/** A request the test settles by hand; its signal says whether anyone still wants it. */
function setup() {
  const flights = new Map<string, Flight<string>>();
  const started: {
    signal: AbortSignal;
    answer: (v: string) => void;
    fail: () => void;
  }[] = [];
  const start = (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) =>
      started.push({
        signal,
        answer: resolve,
        fail: () => reject(new Error("offline")),
      })
    );
  const join = (key: string, signal = new AbortController().signal) =>
    sharedFlight(flights, key, start, signal);
  return { started, join, flights };
}

describe("sharedFlight", () => {
  it("sends one request for two askers of the same key, and answers both", async () => {
    const s = setup();
    const a = s.join("q:boom|full");
    const b = s.join("q:boom|full");
    expect(s.started).toHaveLength(1);
    s.started[0]!.answer("hits");
    await expect(Promise.all([a, b])).resolves.toEqual(["hits", "hits"]);
    expect(s.flights.size).toBe(0);
  });

  it("sends separate requests for different keys", () => {
    const s = setup();
    void s.join("q:boom|instant");
    void s.join("q:boom|full");
    expect(s.started).toHaveLength(2);
  });

  it("asks again once the request has settled, so a failure is never reused", async () => {
    const s = setup();
    const first = s.join("k");
    s.started[0]!.fail();
    await expect(first).rejects.toThrow("offline");
    void s.join("k");
    expect(s.started).toHaveLength(2);
  });

  it("keeps the request going while one asker still wants it, and stops it when none do", async () => {
    const s = setup();
    const one = new AbortController();
    const two = new AbortController();
    const a = s.join("k", one.signal);
    const b = s.join("k", two.signal);
    one.abort();
    await expect(a).rejects.toThrow();
    expect(s.started[0]!.signal.aborted).toBe(false);
    two.abort();
    await expect(b).rejects.toThrow();
    expect(s.started[0]!.signal.aborted).toBe(true);
    // Nobody is left to share it with: the next asker starts afresh.
    void s.join("k");
    expect(s.started).toHaveLength(2);
  });
});
