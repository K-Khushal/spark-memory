import { describe, expect, it } from "vitest";
import { searchList } from "./search-list";
import type { Found, Results } from "./use-search";

const found = (id: string) => ({ id }) as Found;
const answer = (
  direct: string[],
  related: string[],
  settled: boolean
): Results => ({
  direct: direct.map(found),
  related: related.map(found),
  mode: settled ? "full" : "instant",
  settled,
  key: "q:ab",
});

describe("the ⌘K list", () => {
  it("never says nothing matched while only the instant answer is in, and it is empty", () => {
    const before = answer(["a"], [], false);
    const empty = answer([], [], false);
    const shown = searchList(empty, before);
    expect(shown.note).toBeUndefined();
    expect(shown.rows).toBe(before);
    expect(shown.busy).toBe(true);
    // Then the full answer lands with results: the note was never drawn.
    const full = answer(["b"], [], true);
    expect(searchList(full, before)).toEqual({ rows: full, busy: false });
  });

  it("says No Memories Match once the full answer is empty too, or the full search failed", () => {
    expect(searchList(answer([], [], true), undefined)).toMatchObject({
      note: "No Memories Match",
      busy: false,
    });
  });

  it("says No Direct Matches only once settled", () => {
    expect(
      searchList(answer([], ["r"], false), undefined).note
    ).toBeUndefined();
    expect(searchList(answer([], ["r"], true), undefined).note).toBe(
      "No Direct Matches"
    );
  });
});
