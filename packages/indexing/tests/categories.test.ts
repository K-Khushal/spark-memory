import { afterEach, describe, expect, it, vi } from "vitest";
import { CATEGORY_NAMES, type Category } from "@spark/core";
import {
  categorise,
  jevCategories,
  type CategoryClient,
  type Embedder,
} from "../index";

/** Axis i is Category i; the Memory's own vector is given by the test. */
function embedder(model: string): Embedder & { calls: number } {
  const e: Embedder & { calls: number } = {
    name: "fake",
    model,
    dimensions: CATEGORY_NAMES.length,
    calls: 0,
    async embed(inputs) {
      e.calls++;
      return {
        vectors: inputs.map((_, i) => {
          const v = new Array<number>(CATEGORY_NAMES.length).fill(0);
          v[i] = 1;
          return v;
        }),
        usage: { textTokens: 5, imageTokens: 0 },
      };
    },
  };
  return e;
}
const toward = (...names: Category[]) =>
  CATEGORY_NAMES.map((n) => (names.includes(n) ? 1 : 0));
const yes = async () => true;
const grant = async () => ({ release: async () => {} });
const calls: { provider?: string }[] = [];
const record = async (call: { provider?: string }) => void calls.push(call);
afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("categorise", () => {
  it("checks permission again after loading persisted prototypes", async () => {
    const e = embedder("persisted-permission-fence");
    let allowed = true;
    expect(
      await categorise({
        text: "tart",
        vector: toward("Recipe"),
        embedder: e,
        allow: async () => allowed,
        hold: grant,
        record,
        loadPrototypes: async () => {
          allowed = false;
          return {};
        },
      })
    ).toBeUndefined();
    expect(e.calls).toBe(0);
  });

  describe("holds", () => {
    /** A hold maker that remembers what was asked and what was given back. */
    const holds = () => {
      const log = {
        asked: [] as number[],
        released: 0,
        refuse: false,
      };
      return Object.assign(log, {
        hold: async (micros: number) => {
          log.asked.push(micros);
          return log.refuse
            ? undefined
            : {
                reservation: `hold-${log.asked.length}`,
                release: async () => void log.released++,
              };
        },
      });
    };
    const stored = Object.fromEntries(
      CATEGORY_NAMES.map((name, i) => [
        name,
        CATEGORY_NAMES.map((_, j) => (i === j ? 1 : 0)),
      ])
    );

    it("takes no hold, and calls nothing, when the persisted prototypes are all there is to read", async () => {
      const e = embedder("holds-stored");
      const h = holds();
      expect(
        await categorise({
          text: "tart",
          vector: toward("Recipe"),
          embedder: e,
          allow: yes,
          hold: h.hold,
          record,
          loadPrototypes: async () => stored,
        })
      ).toEqual(["Recipe"]);
      expect(h.asked).toEqual([]);
      expect(e.calls).toBe(0);
    });

    it("holds right before embedding the missing prototypes, settles it with the cost, then lets go of it", async () => {
      const e = embedder("holds-missing");
      const h = holds();
      const recorded: { reservation?: string }[] = [];
      await categorise({
        text: "tart",
        vector: toward("Recipe"),
        embedder: e,
        allow: yes,
        hold: h.hold,
        record: async (call) => void recorded.push(call),
      });
      expect(h.asked).toHaveLength(1);
      expect(h.asked[0]).toBeGreaterThanOrEqual(0);
      expect(e.calls).toBe(1);
      expect(recorded).toEqual([
        expect.objectContaining({ reservation: "hold-1" }),
      ]);
      expect(h.released).toBe(1);
    });

    it("makes no call when no hold is given, and gives back a hold whose call failed", async () => {
      const none = holds();
      none.refuse = true;
      const e = embedder("holds-refused");
      expect(
        await categorise({
          text: "tart",
          vector: toward("Recipe"),
          embedder: e,
          allow: yes,
          hold: none.hold,
          record,
        })
      ).toBeUndefined();
      expect(e.calls).toBe(0);
      const failing = embedder("holds-failing");
      failing.embed = async () => {
        throw new Error("down");
      };
      const h = holds();
      expect(
        await categorise({
          text: "tart",
          vector: toward("Recipe"),
          embedder: failing,
          allow: yes,
          hold: h.hold,
          record,
        })
      ).toBeUndefined();
      expect(h.released).toBe(1);
      expect(calls).toEqual([]);
    });

    it("holds Jev's call at an upper bound by its UTF-8 bytes, and settles then releases it", async () => {
      const e = embedder("holds-jev");
      const h = holds();
      const jev: CategoryClient = {
        model: "jev-1.14.0",
        classify: async () => ({ scores: { Recipe: 0.9 }, inputTokens: 10 }),
      };
      const text = "नींबू का टार्ट ".repeat(500);
      const recorded: { reservation?: string }[] = [];
      await categorise({
        text,
        vector: toward("Recipe"),
        embedder: e,
        jev,
        allow: yes,
        hold: h.hold,
        record: async (call) => void recorded.push(call),
        loadPrototypes: async () => stored,
      });
      // The first hold is Jev's, at its bytes (not characters ÷ 3).
      expect(h.asked[0]).toBeGreaterThan(
        Math.ceil(((text.length / 3 + 800) * 42_000) / 1_000_000)
      );
      expect(recorded[0]).toMatchObject({ reservation: "hold-1" });
      expect(h.released).toBe(h.asked.length);
    });
  });

  it("takes Jev's Categories above the threshold and bills its input tokens", async () => {
    const e = embedder("jev-first");
    const jev: CategoryClient = {
      model: "jev-1.14.0",
      classify: async () => ({
        scores: { Recipe: 0.9, Tutorial: 0.3, Article: 0.1 },
        inputTokens: 1_000_000,
      }),
    };
    expect(
      await categorise({
        text: "tart",
        vector: toward("Code"),
        embedder: e,
        jev,
        allow: yes,
        hold: grant,
        record,
      })
    ).toEqual(["Recipe", "Tutorial"]);
    expect(e.calls).toBe(0);
    expect(calls).toEqual([
      {
        provider: "jev",
        model: "jev-1.14.0",
        usage: { inputTokens: 1_000_000, outputTokens: 0 },
        costMicros: 42_000,
      },
    ]);
  });

  it("counts a Jev call once even when recording it fails", async () => {
    const e = embedder("record-fails");
    const jev: CategoryClient = {
      model: "jev-1.14.0",
      classify: async () => ({ scores: { Recipe: 0.9 }, inputTokens: 10 }),
    };
    const seen: unknown[] = [];
    expect(
      await categorise({
        text: "tart",
        vector: toward("Code"),
        embedder: e,
        jev,
        allow: yes,
        hold: grant,
        record: async (call) => {
          seen.push(call);
          throw new Error("database away");
        },
      })
    ).toEqual(["Recipe"]);
    expect(seen).toHaveLength(1);
    expect(e.calls).toBe(0);
  });

  it("falls back to the prototypes, embedded once for all Memories", async () => {
    const e = embedder("fallback");
    const down: CategoryClient = {
      model: "jev-1.14.0",
      classify: async () => {
        throw new Error("503");
      },
    };
    const run = (vector: number[], jev?: CategoryClient) =>
      categorise({
        text: "x",
        vector,
        embedder: e,
        ...(jev && { jev }),
        allow: yes,
        hold: grant,
        record,
      });
    expect(await run(toward("Recipe"), down)).toEqual(["Recipe"]);
    expect(await run(toward("Place", "Video"))).toEqual(["Video", "Place"]);
    expect(await run(toward("Code", "Tutorial", "Quote", "Idea"))).toEqual([
      "Code",
      "Tutorial",
      "Quote",
    ]);
    expect(e.calls).toBe(1);
    // An unavailable Jev still counts as a possible bill, once.
    expect(calls.filter((c) => c.provider === "jev")).toEqual([
      expect.objectContaining({ estimated: true }),
    ]);
  });

  it("is Other when nothing is near, or the vector is unusable", async () => {
    const e = embedder("far");
    const run = (vector: number[]) =>
      categorise({
        text: "x",
        vector,
        embedder: e,
        allow: yes,
        hold: grant,
        record,
      });
    expect(await run(new Array<number>(CATEGORY_NAMES.length).fill(0))).toEqual(
      ["Other"]
    );
    expect(await run([1, 2, 3])).toEqual(["Other"]);
  });

  it("decides nothing when the embedder fails", async () => {
    const e = embedder("broken");
    e.embed = async () => {
      throw new Error("down");
    };
    expect(
      await categorise({
        text: "x",
        vector: toward("Recipe"),
        embedder: e,
        allow: yes,
        hold: grant,
        record,
      })
    ).toBeUndefined();
  });

  it("sends and spends nothing when the gate says no", async () => {
    const e = embedder("gated");
    const jev: CategoryClient = {
      model: "jev-1.14.0",
      classify: async () => {
        throw new Error("must not be called");
      },
    };
    expect(
      await categorise({
        text: "secret",
        vector: toward("Recipe"),
        embedder: e,
        jev,
        allow: async () => false,
        hold: grant,
        record: async () => {
          throw new Error("must not record");
        },
      })
    ).toBeUndefined();
    expect(e.calls).toBe(0);
  });
});

describe("jevCategories", () => {
  const reply = {
    model: "jev-1.14.0",
    answers: {
      category: {
        type: "choice",
        choice: "Recipe",
        confidence: 0.9,
        probabilities: { Recipe: 0.9, Other: 0.1 },
      },
    },
    usage: { input_tokens: 42, output_tokens: 0 },
  };

  it("is off without a key or without being enabled", () => {
    expect(jevCategories({})).toBeUndefined();
    expect(jevCategories({ apiKey: "k" })).toBeUndefined();
    expect(jevCategories({ enabled: true })).toBeUndefined();
    expect(jevCategories({ apiKey: "k", enabled: false })).toBeUndefined();
  });

  it("asks one Choice question about the text alone and reads the probabilities", async () => {
    const fetch = vi.fn(async () => Response.json(reply));
    vi.stubGlobal("fetch", fetch);
    const jev = jevCategories({ apiKey: "secret-key", enabled: true })!;
    expect(await jev.classify("a lemon tart", CATEGORY_NAMES)).toEqual({
      scores: { Recipe: 0.9, Other: 0.1 },
      inputTokens: 42,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer secret-key",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "jev-1.14.0",
      state: "a lemon tart",
      questions: { category: { type: "choice" } },
    });
    expect(Object.keys(body.questions.category.criteria)).toEqual([
      ...CATEGORY_NAMES,
    ]);
    expect(body.assets).toBeUndefined();
  });

  it("throws for an error status or a reply it cannot trust", async () => {
    const jev = jevCategories({ apiKey: "k", enabled: true })!;
    vi.stubGlobal(
      "fetch",
      async () => new Response("slow down", { status: 429 })
    );
    await expect(jev.classify("x", CATEGORY_NAMES)).rejects.toThrow();
    vi.stubGlobal("fetch", async () => Response.json({ answers: {} }));
    await expect(jev.classify("x", CATEGORY_NAMES)).rejects.toThrow();
  });
});
