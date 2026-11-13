import { z } from "zod";
import { CATEGORY_NAMES, type Category } from "./categories";
import type { MemoryKind } from "./memory";

/**
 * The words a search filter is made of, shared by the query parser, the
 * server and the filter chips so they cannot drift apart.
 */

/** Colours people search by, with the pure shade a palette is compared to. */
export const SEARCH_COLOURS = {
  red: "#D8352A",
  orange: "#EE7A1C",
  yellow: "#F2C824",
  green: "#3E9B4F",
  teal: "#1C9C9C",
  blue: "#2F6FE0",
  purple: "#7B4FD6",
  pink: "#E25C9E",
  brown: "#8B5A35",
  black: "#1A1A1A",
  grey: "#9A9A9A",
  white: "#F5F6F8",
} as const;
export type SearchColour = keyof typeof SEARCH_COLOURS;
export const SEARCH_COLOUR_NAMES = Object.keys(SEARCH_COLOURS) as [
  SearchColour,
  ...SearchColour[],
];

/** Where a Memory can come from, by the name people say, and the hosts that name covers. */
export const SEARCH_SOURCES = {
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  pinterest: ["pinterest.com", "pin.it"],
  twitter: ["twitter.com", "x.com"],
  reddit: ["reddit.com", "redd.it"],
  github: ["github.com"],
  tiktok: ["tiktok.com"],
  linkedin: ["linkedin.com"],
  medium: ["medium.com"],
  wikipedia: ["wikipedia.org"],
  behance: ["behance.net"],
  dribbble: ["dribbble.com"],
  figma: ["figma.com"],
} as const;

/** The hosts a Source filter matches: a known name's hosts, or the domain itself. */
export function sourceHosts(source: string): string[] {
  const named = SEARCH_SOURCES[source as keyof typeof SEARCH_SOURCES];
  return named ? [...named] : [source];
}

/**
 * The Source a Memory's URL is filed under: the name from `SEARCH_SOURCES`
 * when its host is one of that name's, else the host without "www.".
 */
export function sourceOf(url: string): string | undefined {
  // The host the way the database reads it (migrations/0022).
  const match = /^https?:\/\/(?:[^/?#@]*@)?([^/:?#]+)/i.exec(url.trim());
  const host = match?.[1]?.toLowerCase().replace(/^www\./, "");
  if (!host?.includes(".")) return undefined;
  for (const [name, hosts] of Object.entries(SEARCH_SOURCES))
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return name;
  return host;
}

/**
 * The kinds a person means by a word. A link includes a saved post. Only
 * kinds with a word appear here, so a filter chip can't ask for the rest.
 */
export const SEARCH_KINDS = {
  image: ["image"],
  pdf: ["pdf"],
  video: ["video"],
  link: ["link", "social_post"],
  note: ["text"],
} as const satisfies Record<string, readonly MemoryKind[]>;
export type SearchKind = keyof typeof SEARCH_KINDS;

const host = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);

/** What a search is narrowed to before it ranks: what the query parser reads and chips choose. */
export type SearchFilters = {
  kinds?: MemoryKind[];
  /** A name from `SEARCH_SOURCES`, or a domain. */
  source?: string;
  /** Captured at or after this ISO instant. */
  after?: string;
  /** Captured before this ISO instant. */
  before?: string;
  colour?: SearchColour;
  /** A Memory has at least one of these. */
  categories?: Category[];
};

/** Time ranges a chip offers, in the words the query parser already reads. */
export const SEARCH_WHEN = [
  "today",
  "this week",
  "this month",
  "last month",
  "this year",
] as const;
export type SearchWhen = (typeof SEARCH_WHEN)[number];

/**
 * One choice per filter chip group, as the dashboard sends it. Dates are worked out on the
 * server, in the person's timezone, by the same parser as typed ones.
 */
export const SearchChips = z
  .object({
    kind: z.enum(Object.keys(SEARCH_KINDS) as [SearchKind, ...SearchKind[]]),
    source: host,
    when: z.enum(SEARCH_WHEN),
    colour: z.enum(SEARCH_COLOUR_NAMES),
    category: z.enum(CATEGORY_NAMES),
  })
  .partial()
  .strict();
export type SearchChips = z.infer<typeof SearchChips>;

/** The most a search query can be. */
export const MAX_QUERY_CHARS = 300;

/** How many results one page of a search holds. */
export const SEARCH_PAGE_SIZE = 40;

/**
 * Where the next page of a search begins, as the server last said it: `c:`
 * and a Memory id (browsing with no words, newest first) or `o:` and how many
 * results came before (ranked results). The client only hands it back.
 */
export const SearchPage = z
  .string()
  .regex(
    /^(?:o:(?:[1-9]\d{0,4})|c:[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i
  );

/**
 * A search as the dashboard sends it, in the body of a POST so what a person
 * typed and chose never travels in a URL (URLs reach request logs).
 */
export const SearchRequest = z
  .object({
    /** Longer queries are cut: nobody types more to find a Memory. */
    q: z
      .string()
      .max(2000)
      .transform((q) => q.slice(0, MAX_QUERY_CHARS))
      .default(""),
    /** `full` (after a pause in typing) also searches by meaning. */
    mode: z.enum(["instant", "full"]).default("instant"),
    /** The person's IANA timezone, for "last month". */
    timezone: z.string().max(64).optional(),
    chips: SearchChips.optional(),
    page: SearchPage.optional(),
    image: z
      .object({
        mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
        data: z
          .string()
          .min(4)
          .max(1_398_104)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/)
          .refine(
            (data) =>
              data.length % 4 === 0 &&
              (data.length / 4) * 3 -
                (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0) <=
                1_048_576
          ),
      })
      .strict()
      .refine(({ mime, data }) => {
        // Check a bounded signature before sending bytes to any provider.
        const alphabet =
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let bits = 0,
          count = 0,
          head = "";
        for (const char of data.slice(0, 16).replace(/=+$/, "")) {
          bits = (bits << 6) | alphabet.indexOf(char);
          count += 6;
          if (count >= 8) {
            count -= 8;
            head += String.fromCharCode((bits >> count) & 255);
          }
        }
        return mime === "image/png"
          ? head.startsWith("\x89PNG\r\n\x1a\n")
          : mime === "image/jpeg"
            ? head.startsWith("\xff\xd8\xff")
            : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
      })
      .optional(),
    memory: z.string().uuid().optional(),
  })
  .strict()
  .refine((v) => !(v.image && v.memory));
export type SearchRequest = z.input<typeof SearchRequest>;

/**
 * A committed search or a click on one of its results, for Recent searches
 * and the product metrics. `position` counts from 1 in the results shown.
 */
export const SearchEvent = z
  .object({
    query: z.string().max(MAX_QUERY_CHARS),
    memoryId: z.uuid().optional(),
    position: z.number().int().min(1).max(100).optional(),
    reformulation: z.boolean().optional(),
  })
  .refine((e) => (e.memoryId === undefined) === (e.position === undefined));
export type SearchEvent = z.infer<typeof SearchEvent>;
