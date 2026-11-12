import { describe, expect, it } from "vitest";
import type { SearchFilters } from "@spark/core";
import { understandQuery } from "../index";

// Thursday 12 November 2026, noon UTC.
const NOW = new Date("2026-11-12T12:00:00Z");
const parse = (query: string, timezone = "UTC", now = NOW) =>
  understandQuery(query, { now, timezone });

/** [query, what is left to search by meaning, the filters it became] */
const table: [string, string, SearchFilters][] = [
  // The issue's own examples.
  [
    "pdfs from last month",
    "",
    {
      kinds: ["pdf"],
      after: "2026-10-01T00:00:00.000Z",
      before: "2026-11-01T00:00:00.000Z",
    },
  ],
  ["from instagram", "", { source: "instagram" }],
  ["orange animations", "orange animations", { colour: "orange" }],

  // Kinds.
  ["screenshots of error messages", "of error messages", { kinds: ["image"] }],
  [
    "links about sourdough",
    "about sourdough",
    { kinds: ["link", "social_post"] },
  ],
  ["videos", "", { kinds: ["video"] }],
  [
    "pdf from last month",
    "",
    {
      kinds: ["pdf"],
      after: "2026-10-01T00:00:00.000Z",
      before: "2026-11-01T00:00:00.000Z",
    },
  ],

  // Sources.
  ["videos from youtube", "", { kinds: ["video"], source: "youtube" }],
  ["recipes from nytimes.com", "recipes", { source: "nytimes.com" }],
  ["sourdough from reddit", "sourdough", { source: "reddit" }],
  ["articles from medium", "articles", { source: "medium" }],
  ["tutorials via medium", "tutorials", { source: "medium" }],
  ["tutorials on youtube", "tutorials", { source: "youtube" }],
  [
    "docs from developer.mozilla.org",
    "docs",
    { source: "developer.mozilla.org" },
  ],
  ["recipes from bbc.co.uk", "recipes", { source: "bbc.co.uk" }],
  [
    "from instagram last week",
    "",
    {
      source: "instagram",
      after: "2026-11-02T00:00:00.000Z",
      before: "2026-11-09T00:00:00.000Z",
    },
  ],

  // Dates: relative phrases stand alone, absolute ones need an introducer.
  [
    "yesterday",
    "",
    {
      after: "2026-11-11T00:00:00.000Z",
      before: "2026-11-12T00:00:00.000Z",
    },
  ],
  [
    "logo ideas from this year",
    "logo ideas",
    {
      after: "2026-01-01T00:00:00.000Z",
      before: "2027-01-01T00:00:00.000Z",
    },
  ],
  ["invoices since March", "invoices", { after: "2026-03-01T00:00:00.000Z" }],
  [
    "from March 2025",
    "",
    {
      after: "2025-03-01T00:00:00.000Z",
      before: "2025-04-01T00:00:00.000Z",
    },
  ],
  ["before 2026", "", { before: "2026-01-01T00:00:00.000Z" }],
  [
    "from 2026-05-03",
    "",
    {
      after: "2026-05-03T00:00:00.000Z",
      before: "2026-05-04T00:00:00.000Z",
    },
  ],
  [
    "notes from June 1 to June 30",
    "",
    {
      kinds: ["text"],
      after: "2026-06-01T00:00:00.000Z",
      before: "2026-07-01T00:00:00.000Z",
    },
  ],
  [
    "past 7 days",
    "",
    {
      after: "2026-11-05T00:00:00.000Z",
      before: "2026-11-13T00:00:00.000Z",
    },
  ],
  [
    "stuff from last week",
    "stuff",
    {
      after: "2026-11-02T00:00:00.000Z",
      before: "2026-11-09T00:00:00.000Z",
    },
  ],
  [
    "photos from this week",
    "",
    {
      kinds: ["image"],
      after: "2026-11-09T00:00:00.000Z",
      before: "2026-11-16T00:00:00.000Z",
    },
  ],

  // A colour is a hint and also a word Memories use ("red hair"), so it stays
  // in the words unless nothing else is left to search by.
  ["red car", "red car", { colour: "red" }],
  ["dark purple sidebar", "dark purple sidebar", { colour: "purple" }],
  ["orange", "orange", { colour: "orange" }],
  [
    "orange cat staring at me from a couch",
    "orange cat staring at me from a couch",
    { colour: "orange" },
  ],
  [
    "orange pdfs from last month",
    "",
    {
      colour: "orange",
      kinds: ["pdf"],
      after: "2026-10-01T00:00:00.000Z",
      before: "2026-11-01T00:00:00.000Z",
    },
  ],
];

describe("understandQuery", () => {
  it.each(table)("%s", (query, text, filters) => {
    expect(parse(query)).toEqual({ text, filters });
  });

  // Words that look like a filter but are what the person is looking for.
  it.each([
    "red hat linux",
    "black friday sale",
    "blue cheese dressing",
    "pdf rendering",
    "meeting notes",
    "notes",
    "links",
    "passport appointment on 3 May",
    "the meeting on 20 June about planning",
    "flight on the 9th of April from Delhi to Bengaluru",
    "that dashboard screenshot with the dark sidebar",
    "from a couch",
    "last year's taxes",
    "नानी की दाल",
    "from report.pdf",
    // A domain is a Source only when its ending is a real one.
    "talks from next.js conf",
    "meetup talks from vue.js",
    "setup from config.yaml",
    // A name that is also a word is a Source only after "from" or "via".
    "steak on medium heat",
    "a medium sized cake",
    "",
    "   ",
  ])("keeps %j as it is", (query) => {
    const { text, filters } = parse(query);
    expect(text).toBe(query.trim().replace(/\s+/g, " "));
    expect(filters).not.toHaveProperty("after");
    expect(filters).not.toHaveProperty("source");
    expect(filters).not.toHaveProperty("kinds");
  });

  it("does not treat a colour name inside a phrase as a colour", () => {
    expect(parse("red hat linux").filters).toEqual({});
    expect(parse("black friday sale").filters).toEqual({});
    // ... but still reads a colour outside the phrase.
    expect(parse("blue red hat").filters).toEqual({ colour: "blue" });
  });

  it("reads days in the person's timezone, across the date line", () => {
    const early = new Date("2026-11-12T01:00:00Z");
    // 06:30 on the 12th in Kolkata.
    expect(parse("yesterday", "Asia/Kolkata", early).filters).toEqual({
      after: "2026-11-10T18:30:00.000Z",
      before: "2026-11-11T18:30:00.000Z",
    });
    // 17:00 on the 11th in Los Angeles.
    expect(parse("yesterday", "America/Los_Angeles", early).filters).toEqual({
      after: "2026-11-10T08:00:00.000Z",
      before: "2026-11-11T08:00:00.000Z",
    });
  });

  it("uses the offset in force on each boundary, across daylight saving", () => {
    expect(
      parse(
        "pdfs from last month",
        "America/New_York",
        new Date("2026-04-12T12:00:00Z")
      ).filters
    ).toEqual({
      kinds: ["pdf"],
      after: "2026-03-01T05:00:00.000Z",
      before: "2026-04-01T04:00:00.000Z",
    });
  });

  it("falls back to UTC for a timezone it does not know", () => {
    expect(parse("yesterday", "Mars/Olympus").filters).toEqual(
      parse("yesterday", "UTC").filters
    );
  });

  it("looks back for a month with no year", () => {
    // March has not come round yet this year, so it means last March.
    const january = new Date("2026-01-20T12:00:00Z");
    expect(parse("from March", "UTC", january).filters).toEqual({
      after: "2025-03-01T00:00:00.000Z",
      before: "2025-04-01T00:00:00.000Z",
    });
  });

  it("is deterministic and never throws on odd input", () => {
    for (const q of [
      "from",
      "from from from",
      "last",
      "from last",
      "since",
      "videos videos videos",
      "x".repeat(2000),
      "from 99999-99-99",
      "\u0000 from ‮",
    ]) {
      expect(() => parse(q)).not.toThrow();
      expect(parse(q)).toEqual(parse(q));
    }
  });
});
