import * as chrono from "chrono-node";
import {
  SEARCH_COLOURS,
  SEARCH_KINDS,
  SEARCH_SOURCES,
  type MemoryKind,
  type SearchColour,
  type SearchFilters,
  type SearchKind,
} from "@spark/core";

/**
 * Reads the structure out of what someone typed: kind, Source, when it was
 * saved and colour. What is left is searched by meaning. A word is taken as
 * a filter only where it reads like one, and kept as content when taking it
 * would leave nothing to search or it is part of a phrase ("red hat").
 */
export function understandQuery(
  query: string,
  { now = new Date(), timezone = "UTC" }: { now?: Date; timezone?: string } = {}
): { text: string; filters: SearchFilters } {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const norm = words.map(normalise);
  const taken = new Set<number>();
  const filters: SearchFilters = {};
  const zone = validZone(timezone, now);

  const date = findDate(norm, civilToday(now, zone));
  if (date) {
    for (let i = date.from; i < date.from + date.length; i++) taken.add(i);
    if (date.after) filters.after = boundary(date.after, zone);
    if (date.before) filters.before = boundary(date.before, zone);
  }

  const source = findSource(norm);
  if (source) {
    taken.add(source.at).add(source.at + 1);
    filters.source = source.name;
  }

  const structural = !!(date || source);
  const kind = findKind(norm, taken, structural);
  if (kind) {
    taken.add(kind.at);
    filters.kinds = [...SEARCH_KINDS[kind.kind]] as MemoryKind[];
  }

  const colour = findColour(norm, taken);
  if (colour) {
    filters.colour = colour.name;
    // A colour word is also what a Memory says ("purple flowers", "red
    // hair"), so it stays in the words. It goes only when the rest is
    // filters and it is all that is left: "orange pdfs from last month".
    const rest = words.some((_, i) => !taken.has(i) && i !== colour.at);
    if (!rest && taken.size) taken.add(colour.at);
  }

  return { text: words.filter((_, i) => !taken.has(i)).join(" "), filters };
}

const normalise = (word: string) =>
  word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

// ── Dates ───────────────────────────────────────────────────────────────

/** A calendar day in the person's timezone, as the UTC midnight of that date. */
type Day = number;
type Range = { start: Day; end: Day };

const DAY = 86_400_000;
const utcDay = (y: number, m: number, d = 1): Day => Date.UTC(y, m - 1, d);

function validZone(timezone: string, now: Date) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(now);
    return timezone;
  } catch {
    return "UTC";
  }
}

function civilToday(now: Date, timezone: string): Day {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)!.value);
  return utcDay(get("year"), get("month"), get("day"));
}

/** Midnight of a calendar day in `timezone`, as an ISO instant (so DST is the day's own). */
function boundary(day: Day, timezone: string) {
  let value = day;
  // The offset can change between the guess and the answer; two passes settle it.
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    }).formatToParts(value);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)!.value);
    value +=
      day -
      Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour"),
        get("minute"),
        get("second")
      );
  }
  return new Date(value).toISOString();
}

const addMonths = (day: Day, months: number): Day => {
  const d = new Date(day);
  return utcDay(d.getUTCFullYear(), d.getUTCMonth() + 1 + months, 1);
};
const mondayOf = (day: Day): Day => {
  const weekday = new Date(day).getUTCDay();
  return day - ((weekday + 6) % 7) * DAY;
};

const UNIT = /^(day|days|week|weeks|month|months|year|years)$/;

/** "yesterday", "last month", "this year", "past 7 days": how many words, and the span. */
function relative(
  norm: string[],
  at: number,
  today: Day
): { length: number; range: Range } | undefined {
  const [a, b, c] = [norm[at], norm[at + 1], norm[at + 2]];
  if (a === "today")
    return { length: 1, range: { start: today, end: today + DAY } };
  if (a === "yesterday")
    return { length: 1, range: { start: today - DAY, end: today } };
  if (a === "this" || a === "last" || a === "previous") {
    const back = a === "this" ? 0 : 1;
    if (b === "week") {
      const start = mondayOf(today) - back * 7 * DAY;
      return { length: 2, range: { start, end: start + 7 * DAY } };
    }
    if (b === "month") {
      const start = addMonths(today, -back);
      return { length: 2, range: { start, end: addMonths(start, 1) } };
    }
    if (b === "year") {
      const year = new Date(today).getUTCFullYear() - back;
      return {
        length: 2,
        range: { start: utcDay(year, 1), end: utcDay(year + 1, 1) },
      };
    }
  }
  if (
    (a === "past" || a === "last") &&
    b &&
    UNIT.test(b) === false &&
    c &&
    UNIT.test(c)
  ) {
    const n = Number(b);
    if (Number.isInteger(n) && n > 0 && n <= 1000) {
      const unit = c.replace(/s$/, "");
      const start =
        unit === "day"
          ? today - n * DAY
          : unit === "week"
            ? today - n * 7 * DAY
            : addMonths(today, -n * (unit === "year" ? 12 : 1));
      return { length: 3, range: { start, end: today + DAY } };
    }
  }
  return undefined;
}

const YEAR = /^(?:19|20)\d{2}$/;

/** A date written out ("March 2025", "June 1 to June 30", "2026-05-03") from word `at` on. */
function absolute(
  words: string[],
  at: number,
  today: Day
): { length: number; range: Range } | undefined {
  const rest = words.slice(at);
  if (!rest.length) return undefined;
  if (YEAR.test(rest[0]!)) {
    const year = Number(rest[0]);
    return {
      length: 1,
      range: { start: utcDay(year, 1), end: utcDay(year + 1, 1) },
    };
  }
  // chrono reads a wall-clock instant; giving it the person's today as UTC
  // keeps every date it returns on that calendar.
  const found = chrono
    .parse(rest.join(" "), { instant: new Date(today + DAY / 2), timezone: 0 })
    .find((r) => r.index === 0);
  if (!found) return undefined;
  const { start, end } = found;
  if (!start.isCertain("month") && !start.isCertain("year")) return undefined;
  // How many words chrono used.
  let length = 0;
  for (let used = 0; used < found.text.length && length < rest.length; length++)
    used += rest[length]!.length + 1;
  const first = start.date();
  let from = utcDay(
    first.getUTCFullYear(),
    first.getUTCMonth() + 1,
    first.getUTCDate()
  );
  let to: Day;
  if (end) {
    const last = end.date();
    to =
      utcDay(last.getUTCFullYear(), last.getUTCMonth() + 1, last.getUTCDate()) +
      DAY;
  } else if (start.isCertain("day")) {
    to = from + DAY;
  } else if (start.isCertain("month")) {
    from = utcDay(first.getUTCFullYear(), first.getUTCMonth() + 1);
    to = addMonths(from, 1);
  } else {
    from = utcDay(first.getUTCFullYear(), 1);
    to = utcDay(first.getUTCFullYear() + 1, 1);
  }
  // "March" in January means the March that has passed.
  if (!start.isCertain("year") && from > today) {
    const shift = (day: Day) => {
      const d = new Date(day);
      return utcDay(
        d.getUTCFullYear() - 1,
        d.getUTCMonth() + 1,
        d.getUTCDate()
      );
    };
    from = shift(from);
    to = shift(to);
  }
  return { length, range: { start: from, end: to } };
}

type Found = { from: number; length: number; after?: Day; before?: Day };

/** The first date phrase: relative ones stand alone, written dates need "from", "since", "after" or "before". */
function findDate(norm: string[], today: Day): Found | undefined {
  for (let i = 0; i < norm.length; i++) {
    const word = norm[i]!;
    const intro = [
      "from",
      "in",
      "on",
      "during",
      "since",
      "after",
      "before",
    ].includes(word)
      ? word
      : undefined;
    const at = intro ? i + 1 : i;
    const span =
      relative(norm, at, today) ??
      (intro && ["from", "since", "after", "before"].includes(intro)
        ? absolute(norm, at, today)
        : undefined);
    if (!span) continue;
    const { start, end } = span.range;
    const found: Found = { from: i, length: (intro ? 1 : 0) + span.length };
    if (intro === "before") found.before = start;
    else if (intro === "since") found.after = start;
    else if (intro === "after") found.after = end;
    else {
      found.after = start;
      found.before = end;
    }
    return found;
  }
  return undefined;
}

// ── Sources ─────────────────────────────────────────────────────────────

/**
 * Endings a Source domain can have. A word with a dot in it is only a
 * domain when its ending is one of these: "next.js" and "config.yaml" are
 * not. Common generic endings and the country codes people save links from.
 */
const TLDS = new Set(
  (
    "com org net io co dev app ai edu gov info biz me tv fm xyz blog news wiki " +
    "page site online tech cloud design art studio media press social " +
    "us uk de fr in jp cn ru br au ca it es nl se no fi dk pl ch at be ie nz " +
    "za kr mx ar pt tr gr cz hu ro il sg hk tw id th vn ph my ae sa eg ng ke " +
    "eu ly gg to sh cc ws is ua"
  ).split(" ")
);
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.([a-z]{2,24})$/;

/** Names that are also ordinary words: a Source only after "from" or "via". */
const WORD_SOURCES = new Set(["medium"]);

function findSource(norm: string[]) {
  for (let i = 0; i + 1 < norm.length; i++) {
    const intro = norm[i]!;
    if (!["from", "on", "via"].includes(intro)) continue;
    const name = norm[i + 1]!;
    if (name in SEARCH_SOURCES) {
      if (WORD_SOURCES.has(name) && intro === "on") continue;
      return { at: i, name };
    }
    const domain = DOMAIN.exec(name);
    if (domain && TLDS.has(domain[2]!)) return { at: i, name };
  }
  return undefined;
}

// ── Kinds ───────────────────────────────────────────────────────────────

const KIND_WORDS: Record<string, SearchKind> = {
  pdfs: "pdf",
  images: "image",
  photos: "image",
  pictures: "image",
  screenshots: "image",
  videos: "video",
  links: "link",
  notes: "note",
  pdf: "pdf",
  image: "image",
  photo: "image",
  picture: "image",
  screenshot: "image",
  video: "video",
  link: "link",
  note: "note",
};
/** Plural words that are rarely anything but a kind. */
const CLEAR_KINDS = new Set([
  "pdfs",
  "images",
  "photos",
  "pictures",
  "screenshots",
  "videos",
]);

function findKind(norm: string[], taken: Set<number>, structural: boolean) {
  for (let i = 0; i < norm.length; i++) {
    const kind = KIND_WORDS[norm[i]!];
    if (!kind || taken.has(i)) continue;
    const others = norm.some((_, j) => j !== i && !taken.has(j));
    // "links" and "notes" only lead a search ("links about sourdough"): after
    // another word they are content ("meeting notes"), and singulars need a
    // date or Source beside them ("pdf from last month" but "pdf rendering").
    const reads =
      CLEAR_KINDS.has(norm[i]!) ||
      structural ||
      (i === 0 && others && ["links", "notes"].includes(norm[i]!));
    if (reads) return { at: i, kind };
  }
  return undefined;
}

// ── Colours ─────────────────────────────────────────────────────────────

const COLOUR_WORDS: Record<string, SearchColour> = {
  ...(Object.fromEntries(
    Object.keys(SEARCH_COLOURS).map((name) => [name, name])
  ) as Record<string, SearchColour>),
  gray: "grey",
};
/** Phrases where the colour is part of a name, not a description. */
const PHRASES =
  /^(red (hat|bull|cross|sea|wine|flag|carpet|dead)|black (friday|hole|box|mirror|widow|panther|market|belt|swan|and)|white (house|noise|paper|board|wine|collar|elephant|rabbit)|green (card|tea|day|house|screen|bean|peace)|blue (cheese|tooth|bottle|jay|print|whale|moon)|orange (county|juice|peel)|pink (floyd|panther)|purple rain|yellow (pages|submarine|fever|stone|brick)|brown (sugar|bear))$/;

function findColour(norm: string[], taken: Set<number>) {
  for (let i = 0; i < norm.length; i++) {
    const name = COLOUR_WORDS[norm[i]!];
    if (!name || taken.has(i)) continue;
    if (PHRASES.test(`${norm[i]} ${norm[i + 1] ?? ""}`)) continue;
    return { at: i, name };
  }
  return undefined;
}
