/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { linkLayout, tileHeight, tileLayout } from "./memory-tile";
import type { WallMemory } from "./use-library";

const note = (over: Partial<WallMemory> = {}) =>
  ({
    id: "n",
    kind: "text",
    title: null,
    body: "Call the plumber before Friday.",
    sourceUrl: null,
    description: null,
    pageTitle: null,
    indexTitle: null,
    indexState: "searchable",
    preservation: "preserved",
    image: null,
    sample: false,
    ...over,
  }) as WallMemory;
const link = (over: Partial<WallMemory> = {}) =>
  note({
    kind: "link",
    title: "Linear: Planning",
    body: "Short cycles, a calm backlog.",
    sourceUrl: "https://linear.app/method",
    description: "Short cycles, a calm backlog and a rule.",
    ...over,
  });

describe("a text tile's layout", () => {
  it("starts an untitled note at the padding: no blank band for a title", () => {
    const { title, body, height } = tileLayout(note(), 300);
    expect(title).toBe(0);
    // 16 + 16 padding, one 20px line, 8 and 24 for the badge row.
    expect(height).toBe(32 + body * 20);
  });

  it("reserves a badge row only when it is rendered", () => {
    const plain = tileLayout(note(), 300).height;
    expect(tileLayout(note({ sample: true }), 300).height - plain).toBe(32);
    expect(
      tileLayout(note({ indexState: "indexing" }), 300).height - plain
    ).toBe(32);
  });

  it("gives a one-line title one line and a long one two, never three", () => {
    const short = tileLayout(note({ title: "Plumber" }), 221);
    const long = tileLayout(
      note({ title: "The Case for Keeping Everything In One Place Always" }),
      221
    );
    expect(short.title).toBe(1);
    expect(long.title).toBe(2);
    expect(long.height - short.height).toBe(26);
  });

  it("uses 12px padding and a smaller title on a phone lane", () => {
    const phone = tileLayout(note({ title: "Plumber" }), 179);
    expect(phone.height).toBe(24 + 24 + 8 + phone.body * 20);
  });
});

describe("a link tile's layout", () => {
  it("is as tall as what it says: no reserved footer pair", () => {
    const { badge, height, body } = linkLayout(link(), 300);
    expect(badge).toBe(false);
    // padding, one title line, text, 12 + the 16px Source line.
    expect(height).toBe(32 + 26 + 8 + body * 20 + 12 + 16);
  });

  it("adds the badge line only while a badge shows", () => {
    const plain = linkLayout(link(), 300);
    const indexing = linkLayout(link({ indexState: "indexing" }), 300);
    const reference = linkLayout(link({ preservation: "reference_only" }), 300);
    expect(indexing.height - plain.height).toBe(32);
    expect(reference.height - plain.height).toBe(32);
  });

  it("is the tile height for links, videos and social posts alike", () => {
    for (const kind of ["link", "video", "social_post"] as const)
      expect(tileHeight(link({ kind }), 300)).toBe(
        linkLayout(link({ kind }), 300).height
      );
  });
});

it("uses Text for a visible passage whose highlighted query terms are separated", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Highlighted, passageIsHighlighted } = await import("./memory-tile");
  const text = "Garden storage keeps the hand tools dry.";
  expect(
    renderToStaticMarkup(Highlighted({ text, query: "garden tools" }))
  ).toContain("<mark>Garden</mark>");
  expect(
    renderToStaticMarkup(Highlighted({ text, query: "garden tools" }))
  ).toContain("<mark>tools</mark>");
  expect(passageIsHighlighted(text, "garden tools")).toBe(true);
  const { WhyChip } = await import("./why");
  expect(
    renderToStaticMarkup(
      WhyChip({
        found: {
          ...note({ body: text }),
          part: { kind: "passage", field: "body", start: 0, end: text.length },
        },
        direct: true,
        visiblePassage: passageIsHighlighted(text, "garden tools"),
      })
    )
  ).toContain("<span>Text</span>");
  expect(
    passageIsHighlighted("Gardener stores toolshed plans", "garden tools")
  ).toBe(true);
  expect(passageIsHighlighted("The garden has stools", "garden tools")).toBe(
    false
  );
  expect(passageIsHighlighted(text, "a I")).toBe(false);
});
