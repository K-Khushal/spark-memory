import type { Memory } from "../src/library/use-library";

// Fixtures for the UI tour (ui-tour.screenshots.ts): a mixed Library of 42
// Memories with fixed ids and dates, so every run draws the same wall. Images
// and PDF pages are generated SVGs served from /tour/*; nothing leaves the
// machine and nothing is random.

const BASE = Date.parse("2026-11-14T12:00:00.000Z");
const MINUTE = 60_000;

export const LONG_TITLE =
  "Designing a Personal Library Across Languages, Devices, and Years: Notes From a Long Afternoon";
export const RTL_TITLE = "نور الهدى عبد الرحمن: كيف نحفظ الذكريات عبر السنين";
export const HINDI_TITLE = "नमस्ते दुनिया, यादों की लाइब्रेरी";
export const JAPANESE_TITLE = "日本語のデザイン資料と読書メモ";
export const EMOJI_TITLE = "👩🏽‍💻 Garden 🌱🌻 notes 🧠📚";

const PARAGRAPH =
  "The garden wall faces south and holds the heat of the afternoon. Basil does well against it, mint needs a pot of its own, and the tomatoes lean towards the light like everything else.";
const ARTICLE = Array.from(
  { length: 6 },
  (_, i) => `Paragraph ${i + 1}. ${PARAGRAPH} ${PARAGRAPH}`
).join("\n\n");

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

export const TRANSCRIPT = Array.from({ length: 48 }, (_, i) => ({
  seconds: i * 37,
  text:
    i % 9 === 4
      ? RTL_TITLE
      : `Segment ${i + 1}. Heliotropism turns leaves towards sunlight across the day, and the stems follow.`,
}));

/** Seeded, so a scene is the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PALETTES = [
  ["#F6C177", "#EB6F92", "#31748F", "#26233A"],
  ["#9CCFD8", "#C4A7E7", "#524F67", "#191724"],
  ["#A7C080", "#DBBC7F", "#475258", "#2B3339"],
  ["#FFB4A2", "#E5989B", "#6D597A", "#355070"],
  ["#CAD2C5", "#84A98C", "#52796F", "#2F3E46"],
  ["#FFD6A5", "#FDFFB6", "#9BF6FF", "#A0C4FF"],
  ["#E9D8A6", "#EE9B00", "#CA6702", "#005F73"],
  ["#D8E2DC", "#FFCAD4", "#B0D0D3", "#C08497"],
];

/** A soft landscape, still life or abstract scene in `w` by `h`. */
export function sceneSvg(index: number, w: number, h: number) {
  const r = rng(index * 7919 + 17);
  const [a, b, c, d] = PALETTES[index % PALETTES.length]!;
  const kind = index % 4;
  let shapes = "";
  if (kind === 0) {
    shapes += `<circle cx="${w * (0.25 + r() * 0.5)}" cy="${h * 0.32}" r="${Math.min(w, h) * 0.12}" fill="${b}"/>`;
    for (let layer = 0; layer < 3; layer++) {
      const y = h * (0.5 + layer * 0.14);
      let path = `M0 ${h} L0 ${y}`;
      for (let x = 0; x <= w; x += w / 6)
        path += ` L${x} ${y - r() * h * 0.14}`;
      shapes += `<path d="${path} L${w} ${h} Z" fill="${[c, d, a][layer]}" opacity="${0.9 - layer * 0.1}"/>`;
    }
  } else if (kind === 1) {
    for (let i = 0; i < 7; i++)
      shapes += `<circle cx="${r() * w}" cy="${r() * h}" r="${(0.06 + r() * 0.2) * Math.min(w, h)}" fill="${[a, b, c, d][i % 4]}" opacity="0.8"/>`;
  } else if (kind === 2) {
    const n = 8;
    for (let i = 0; i < n; i++)
      shapes += `<rect x="${(w / n) * i}" y="${h * (0.2 + r() * 0.4)}" width="${w / n - 4}" height="${h}" fill="${[b, c, d, a][i % 4]}"/>`;
  } else {
    for (let i = 0; i < 5; i++) {
      const y = h * (0.15 + i * 0.17);
      shapes += `<path d="M0 ${y} C ${w * 0.3} ${y - h * 0.15}, ${w * 0.6} ${y + h * 0.15}, ${w} ${y}" stroke="${[a, b, c, d, a][i]}" stroke-width="${Math.min(w, h) * 0.05}" fill="none"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${d}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>${shapes}</svg>`;
}

/** A document page: a heading, rules and paragraphs, in greys. */
export function pageSvg(n: number, title = "Garden Report") {
  const r = rng(n * 31 + 5);
  let lines = "";
  for (let i = 0; i < 26; i++) {
    const width = 420 + Math.floor(r() * 130);
    lines += `<rect x="64" y="${190 + i * 22}" width="${i % 7 === 6 ? width / 2 : width}" height="7" rx="3" fill="#C9CBD0"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="612" height="792" viewBox="0 0 612 792"><rect width="612" height="792" fill="#FFFFFF"/><text x="64" y="96" font-family="Helvetica, Arial, sans-serif" font-size="28" font-weight="700" fill="#111214">${title}</text><text x="64" y="132" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#5E6066">Page ${n}</text><rect x="64" y="152" width="484" height="2" fill="#E5E6EA"/>${lines}</svg>`;
}

type Shape = { w: number; h: number };
export const SHAPES: Shape[] = [
  { w: 1200, h: 800 },
  { w: 800, h: 1000 },
  { w: 1000, h: 1000 },
  { w: 1600, h: 900 },
  { w: 700, h: 1100 },
  { w: 1200, h: 900 },
];

let n = 0;
function make(extra: Partial<Memory>): Memory {
  n += 1;
  const at = new Date(BASE - n * 37 * MINUTE).toISOString();
  return {
    sample: false,
    id: uuid(n),
    kind: "text",
    title: null,
    body: null,
    captureNote: null,
    preservation: "preserved",
    indexState: "searchable",
    revision: 1,
    categories: ["Other"],
    categoriesLocked: false,
    // Categorised once Searchable; the Indexing ones are still being sorted.
    categoriesVersion: extra.indexState === "indexing" ? null : 1,
    deepFetch: null,
    aiOptOut: false,
    indexError: null,
    indexTitle: null,
    capturedAt: at,
    lastSavedAt: at,
    updatedAt: at,
    sourceUrl: null,
    video: null,
    pageTitle: null,
    description: null,
    pages: null,
    hasVectors: true,
    image: null,
    ...extra,
  } as Memory;
}

const note = (
  title: string | null,
  body: string,
  extra: Partial<Memory> = {}
) => make({ kind: "text", title, body, ...extra });
const link = (
  host: string,
  title: string,
  description: string,
  extra: Partial<Memory> = {}
) =>
  make({
    kind: "link",
    sourceUrl: `https://${host}/${encodeURIComponent(title.slice(0, 24).toLowerCase().replace(/\s+/g, "-"))}`,
    pageTitle: title,
    title,
    description,
    body: `${description}\n\n${ARTICLE}`,
    categories: ["Article"],
    ...extra,
  });
const image = (
  index: number,
  title: string | null,
  extra: Partial<Memory> = {}
) => {
  const shape = SHAPES[index % SHAPES.length]!;
  return make({
    kind: "image",
    title,
    categories: ["Design Reference"],
    image: {
      width: shape.w,
      height: shape.h,
      thumbhash: null,
      url: `/tour/image-${index}.svg`,
      thumbnailUrl: `/tour/image-${index}.svg`,
    } as unknown as Memory["image"],
    ...extra,
  });
};
const pdf = (
  title: string | null,
  pages: number,
  extra: Partial<Memory> = {}
) =>
  make({
    kind: "pdf",
    title,
    pages,
    categories: ["Receipt or Document"],
    image: {
      width: 612,
      height: 792,
      thumbhash: null,
      url: `/tour/page-1.svg`,
      thumbnailUrl: `/tour/page-1.svg`,
    } as unknown as Memory["image"],
    ...extra,
  });
const video = (
  title: string,
  sourceUrl: string,
  state: "available" | "unavailable" | "over_allowance",
  extra: Partial<Memory> = {}
) =>
  make({
    kind: "video",
    title,
    sourceUrl,
    pageTitle: title,
    categories: ["Video"],
    video: {
      transcriptState: state,
      transcript: state === "available" ? TRANSCRIPT : [],
    } as Memory["video"],
    ...extra,
  });

/** The mixed Library: 42 Memories, newest first. */
export function tourMemories(): Memory[] {
  n = 0;
  const list: Memory[] = [
    note(
      "Cardamom Buns",
      "Cardamom buns with orange zest.\n\n500 g flour, 80 g sugar, 10 g cardamom, a long cold rise overnight.",
      { categories: ["Recipe"], captureNote: "Saturday morning project" }
    ),
    image(0, "Harbour at Dusk", { categories: ["Place"] }),
    link(
      "www.theatlantic.com",
      "The Case for Keeping Everything",
      "Why a personal archive beats a perfect filing system, and what it takes to find things again.",
      { categories: ["Article"] }
    ),
    note(
      null,
      "Call the plumber before Friday. Ask about the radiator in the back room and whether the quote includes the valve."
    ),
    video(
      "How Plants Follow the Sun",
      "https://www.youtube.com/watch?v=aBcDeFgHiJk&t=30s",
      "available"
    ),
    image(1, "Studio Window"),
    note(LONG_TITLE, ARTICLE, { categories: ["Idea"] }),
    link(
      "linear.app",
      "Linear: Planning Cycles That Actually Ship",
      "Short cycles, a calm backlog and a rule that nothing is added mid-cycle.",
      { categories: ["Design Reference"] }
    ),
    note("J", "Single letter title, for the one-letter edge.", {
      categories: ["Other"],
    }),
    image(2, null, { indexState: "indexing", categories: ["Screenshot"] }),
    pdf("Garden Report 2026", 12, { indexTitle: "Garden Report" }),
    link(
      "x.com",
      "Ana Pérez on X",
      "Shipped the new onboarding today. Two screens, no tour, and the activation rate doubled.",
      {
        sourceUrl: "https://x.com/anaperez/status/1850000000000000001",
        categories: ["Social Post"],
        body: "Shipped the new onboarding today. Two screens, no tour, and the activation rate doubled.",
      }
    ),
    note(HINDI_TITLE, `${HINDI_TITLE}\n\nयादों को सहेजना और फिर ढूँढ़ना।`, {
      categories: ["Quote"],
    }),
    image(3, "Ridge Walk, Late Light", { categories: ["Place"] }),
    link(
      "example.com",
      "A Thin Page",
      "A page that gave Spark very little to keep.",
      {
        preservation: "reference_only",
        deepFetch: "waiting",
        categories: ["Article"],
      }
    ),
    video(
      "Short Film About Tomatoes",
      "https://www.youtube.com/watch?v=tOmAtOeS123",
      "unavailable"
    ),
    note(
      JAPANESE_TITLE,
      "デザイン資料の読書メモ。余白、行間、文字の大きさについて。",
      {
        categories: ["Idea"],
      }
    ),
    image(4, "Tall Poster, Spring Show", { categories: ["Design Reference"] }),
    link(
      "www.instagram.com",
      "Reel by @urbangardener",
      "Balcony tomatoes, week six.",
      {
        sourceUrl: "https://www.instagram.com/reel/Cabc123xyz/",
        categories: ["Social Post"],
      }
    ),
    note(
      "Reading List",
      "1. The Timeless Way of Building\n2. A Pattern Language\n3. Seeing Like a State\n4. The Design of Everyday Things",
      { categories: ["Idea"] }
    ),
    image(5, "Receipt From the Hardware Store", {
      categories: ["Receipt or Document"],
      indexState: "failed",
      indexError: "unavailable",
    }),
    link(
      "www.bücher.example",
      "Ein Buchladen mit Katze",
      "Ein stiller Ort zum Lesen, mit einer Katze im Fenster.",
      {
        sourceUrl: "https://www.xn--bcher-kva.example/laden",
        categories: ["Place"],
      }
    ),
    note(
      "Meeting Notes",
      "Agenda: onboarding, pricing, the Library wall.\n\n- Onboarding: one step at a time\n- Pricing: free tier stays generous\n- Wall: keep tiles quiet",
      { categories: ["Idea"], captureNote: "From the Tuesday call" }
    ),
    video(
      "Long Lecture on Urban Gardening",
      "https://www.youtube.com/watch?v=lOnGlEcTuRe",
      "over_allowance"
    ),
    pdf("Complete Field Guide to Kitchen Gardens, Second Edition", 240, {
      indexTitle: "Field Guide",
      categories: ["Tutorial"],
    }),
    note(RTL_TITLE, `${RTL_TITLE}\n\n${RTL_TITLE}`, { categories: ["Quote"] }),
    image(6, "Bookshop Cat", { categories: ["Place"] }),
    link(
      "www.tiktok.com",
      "Sourdough in 60 Seconds",
      "Short video of a scoring pattern that actually works.",
      {
        sourceUrl: "https://www.tiktok.com/@baker/video/7000000000000000001",
        categories: ["Social Post"],
      }
    ),
    note(EMOJI_TITLE, `${EMOJI_TITLE}\n\nSow now, thin later.`, {
      categories: ["Idea"],
    }),
    link(
      "stripe.com",
      "Designing Docs That People Read",
      "A visual guide to API documentation that reads like a story.",
      { categories: ["Design Reference"], indexState: "indexing" }
    ),
    image(7, "Concrete Stairs", { categories: ["Design Reference"] }),
    note(
      "Packing",
      "Passport, charger, the grey jumper, headphones, a paperback.",
      { categories: ["Other"], indexState: "failed", indexError: "unavailable" }
    ),
    link(
      "failed.example",
      "Deep Fetch Failed Page",
      "Spark could not read more of this page.",
      { preservation: "reference_only", deepFetch: "failed" }
    ),
    image(8, "Sunday Market", { categories: ["Place"] }),
    pdf(null, 3, { categories: ["Receipt or Document"] }),
    link("bare.example", "", "", {
      title: null,
      pageTitle: null,
      description: null,
      body: null,
      sourceUrl: "https://bare.example/x",
      preservation: "reference_only",
    }),
    video(
      "Reel of a Slow Morning",
      "https://www.instagram.com/reel/Cdef456uvw/",
      "available",
      { categories: ["Social Post"] }
    ),
    note(
      "Ideas",
      "A tool that reads old notebooks.\nA bookshelf that knows what is on it.\nA walk with no phone.",
      { categories: ["Idea"], aiOptOut: true }
    ),
    image(9, "Morning Ceramics", { categories: ["Product"] }),
    note(
      "Gift Ideas",
      "Ceramic bowl, a good knife, a plant that is hard to kill.",
      { categories: ["Product"] }
    ),
    link(
      "news.ycombinator.com",
      "Show: A Library for Everything You Meant to Read Later",
      "A discussion about personal knowledge, retrieval and the cost of keeping things.",
      { categories: ["Article"] }
    ),
    image(10, "Hotel Lobby", { categories: ["Place"] }),
  ];
  return list;
}

/** Which Memory is which, for the steps that open one of each kind. */
export function pick(memories: Memory[]) {
  const find = (test: (m: Memory) => boolean) => memories.find(test)!;
  return {
    note: find((m) => m.title === "Cardamom Buns"),
    longNote: find((m) => m.title === LONG_TITLE),
    link: find((m) => m.pageTitle === "The Case for Keeping Everything"),
    image: find((m) => m.title === "Harbour at Dusk"),
    pdf: find((m) => m.title === "Garden Report 2026"),
    longPdf: find((m) => m.pages === 240),
    video: find((m) => m.title === "How Plants Follow the Sun"),
    social: find((m) => m.title === "Ana Pérez on X"),
    failed: find((m) => m.title === "Packing"),
    indexing: find((m) => m.title === "Designing Docs That People Read"),
    reference: find((m) => m.title === "A Thin Page"),
  };
}
