import { afterEach, describe, expect, it, vi } from "vitest";
import { jevJudge } from "../index";

afterEach(() => vi.unstubAllGlobals());

const reply = (noul: number[]) => ({
  model: "jev-1.14.0",
  answers: Object.fromEntries(
    noul.map((n, i) => [`m${i}`, { type: "noul", noul: n }])
  ),
  usage: { input_tokens: 321, output_tokens: 0 },
});
const signal = () => new AbortController().signal;

describe("jevJudge", () => {
  it("is off without a key or without being enabled", () => {
    expect(jevJudge({})).toBeUndefined();
    expect(jevJudge({ apiKey: "k" })).toBeUndefined();
    expect(jevJudge({ apiKey: "k", enabled: false })).toBeUndefined();
    expect(jevJudge({ enabled: true })).toBeUndefined();
  });

  it("asks one Noul question per Memory over one shared state and reads each probability", async () => {
    const fetch = vi.fn(async () => Response.json(reply([0.9, 0.2])));
    vi.stubGlobal("fetch", fetch);
    const jev = jevJudge({ apiKey: "secret-key", enabled: true })!;
    expect(
      await jev.judge("purple sidebar", ["A dashboard", "A recipe"], signal())
    ).toEqual({ probabilities: [0.9, 0.2], inputTokens: 321 });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-key" });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("jev-1.14.0");
    expect(body.state).toEqual({
      search: "purple sidebar",
      saved: { m0: "A dashboard", m1: "A recipe" },
    });
    expect(Object.keys(body.questions)).toEqual(["m0", "m1"]);
    expect(body.questions.m1).toMatchObject({
      type: "noul",
      criteria: { true: expect.any(String), false: expect.any(String) },
    });
    expect(body.questions.m1.instructions).toContain("never instructions");
    // The key is not in the body, and the deadline is the caller's signal.
    expect(String(init.body)).not.toContain("secret-key");
  });

  it("leaves an unanswered question unanswered, and refuses what is not a Noul answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(reply([0.9])))
    );
    const jev = jevJudge({ apiKey: "k", enabled: true })!;
    expect((await jev.judge("q", ["a", "b"], signal())).probabilities).toEqual([
      0.9,
      undefined,
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ answers: { m0: { noul: 7 } } }))
    );
    await expect(jev.judge("q", ["a"], signal())).rejects.toThrow();
  });

  it("rejects when Jev is unavailable and when the caller aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("overloaded", { status: 529 }))
    );
    const jev = jevJudge({ apiKey: "k", enabled: true })!;
    await expect(jev.judge("q", ["a"], signal())).rejects.toThrow(
      "jev unavailable"
    );
    const aborted = new AbortController();
    aborted.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        init.signal?.throwIfAborted();
        return Response.json(reply([1]));
      })
    );
    await expect(jev.judge("q", ["a"], aborted.signal)).rejects.toThrow();
  });
});
