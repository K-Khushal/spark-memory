import * as chrono from "chrono-node";

/** Explicit filters are shared by the parser, chips and search adapter. Category can join here later. */
export type QueryFilters = {
  kinds?: ("text" | "image" | "pdf" | "link" | "video")[];
  source?: string;
  after?: string;
  before?: string;
  colour?: string;
};

export const QUERY_COLOURS = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
  black: "#111214",
  white: "#ffffff",
} as const;

/** A wall-clock date in an IANA timezone, including DST at the target date. */
function instant(year: number, month: number, day: number, timezone: string) {
  const wall = Date.UTC(year, month - 1, day);
  let value = wall;
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
      wall -
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

/** Conservative structure extraction: ambiguous words stay available to meaning search. */
export function understandQuery(
  query: string,
  { now = new Date(), timezone = "UTC" }: { now?: Date; timezone?: string } = {}
) {
  let text = query.trim().replace(/\s+/g, " ");
  const filters: QueryFilters = {};
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(now);
  } catch {
    timezone = "UTC";
  }
  const source =
    /\bfrom\s+(instagram|youtube|pinterest|github|reddit|[a-z0-9-]+\.[a-z]{2,})\b/i.exec(
      text
    );
  if (source) {
    const name = source[1]!.toLowerCase();
    filters.source = name.includes(".") ? name : `${name}.com`;
    text = text.replace(source[0], " ");
  }
  const kind = /\b(pdfs|images|screenshots|videos|links|notes)\b/i.exec(text);
  if (kind) {
    const kinds = {
      pdfs: "pdf",
      images: "image",
      screenshots: "image",
      videos: "video",
      links: "link",
      notes: "text",
    } as const;
    filters.kinds = [kinds[kind[1]!.toLowerCase() as keyof typeof kinds]];
    text = text.replace(kind[0], " ");
  }
  // Only date syntax introduced as a filter is consumed; dates in content stay searchable.
  const date =
    /\b(from|since|after|before|on|in)\s+((?:last|this)\s+(?:month|week|year)|yesterday|today|\d{4}-\d{2}-\d{2})\b/i.exec(
      text
    );
  if (date) {
    const local = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    const phrase = date[2]!.toLowerCase();
    const parsed = chrono.parse(phrase, local)[0];
    if (parsed) {
      let start = parsed.start.date();
      let end = parsed.end?.date() ?? new Date(start);
      if (/month|year|week/.test(phrase)) {
        start = new Date(local);
        start.setHours(0, 0, 0, 0);
        const previous = phrase.startsWith("last");
        if (phrase.endsWith("month")) {
          start.setDate(1);
          start.setMonth(start.getMonth() - Number(previous));
          end = new Date(start);
          end.setMonth(end.getMonth() + 1);
        } else if (phrase.endsWith("year")) {
          start = new Date(local.getFullYear() - Number(previous), 0, 1);
          end = new Date(start.getFullYear() + 1, 0, 1);
        } else {
          start.setDate(
            start.getDate() - ((start.getDay() + 6) % 7) - (previous ? 7 : 0)
          );
          end = new Date(start);
          end.setDate(end.getDate() + 7);
        }
      } else {
        end.setDate(end.getDate() + 1);
      }
      const iso = (d: Date) =>
        instant(d.getFullYear(), d.getMonth() + 1, d.getDate(), timezone);
      if (date[1]!.toLowerCase() === "before") filters.before = iso(start);
      else {
        filters.after = iso(start);
        if (!/since|after/i.test(date[1]!)) filters.before = iso(end);
      }
      text = text.replace(date[0], " ");
    }
  }
  if (!date) {
    const introduced = /\b(from|since|after|before)\s+(.+)/i.exec(text);
    const parsed =
      introduced &&
      chrono.parse(
        introduced[2]!,
        new Date(now.toLocaleString("en-US", { timeZone: timezone }))
      )[0];
    if (introduced && parsed && parsed.index === 0) {
      const start = parsed.start.date();
      const end = parsed.end?.date() ?? new Date(start);
      end.setDate(end.getDate() + 1);
      const iso = (d: Date) =>
        instant(d.getFullYear(), d.getMonth() + 1, d.getDate(), timezone);
      if (introduced[1]!.toLowerCase() === "before")
        filters.before = iso(start);
      else {
        filters.after = iso(start);
        if (!/since|after/i.test(introduced[1]!)) filters.before = iso(end);
      }
      text =
        text.slice(0, introduced.index) +
        text.slice(
          introduced.index + introduced[1]!.length + 1 + parsed.text.length
        );
    }
  }
  const colour =
    /\b(red|orange|yellow|green|blue|purple|pink|black|white)\b/i.exec(text);
  if (
    colour &&
    !/\b(red hat|black box|white paper|green card|blue tooth)\b/i.test(text) &&
    text.replace(colour[0], "").trim()
  ) {
    filters.colour =
      QUERY_COLOURS[colour[1]!.toLowerCase() as keyof typeof QUERY_COLOURS];
    text = text.replace(colour[0], " ");
  }
  return { text: text.trim().replace(/\s+/g, " "), filters };
}
