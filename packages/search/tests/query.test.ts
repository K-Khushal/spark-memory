import { expect, it } from "vitest";
import { understandQuery } from "../index";

it("understands structured queries without consuming ambiguous content", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  for (const [query, text, filters] of [
    [
      "pdfs from last month",
      "",
      {
        kinds: ["pdf"],
        after: "2026-10-01T00:00:00.000Z",
        before: "2026-11-01T00:00:00.000Z",
      },
    ],
    ["from instagram", "", { source: "instagram.com" }],
    ["orange animations", "animations", { colour: "#f97316" }],
    ["red hat linux", "red hat linux", {}],
    ["orange", "orange", {}],
    ["pdf rendering", "pdf rendering", {}],
    ["passport appointment on 3 May", "passport appointment on 3 May", {}],
  ] as const) {
    expect(understandQuery(query, { now, timezone: "UTC" }), query).toEqual({
      text,
      filters,
    });
  }
});

it("uses local calendar boundaries across DST and accepts date ranges", () => {
  expect(
    understandQuery("pdfs from last month", {
      now: new Date("2026-04-12T12:00:00Z"),
      timezone: "America/New_York",
    }).filters
  ).toEqual({
    kinds: ["pdf"],
    after: "2026-03-01T05:00:00.000Z",
    before: "2026-04-01T04:00:00.000Z",
  });
  expect(
    understandQuery("notes from June 1 to June 30", {
      now: new Date("2026-11-12T12:00:00Z"),
      timezone: "UTC",
    })
  ).toEqual({
    text: "",
    filters: {
      kinds: ["text"],
      after: "2026-06-01T00:00:00.000Z",
      before: "2026-07-01T00:00:00.000Z",
    },
  });
});
