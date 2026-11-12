// A small, linear HTML scanner for gathering a link inside the Worker's CPU
// budget: one pass with indexOf, no DOM and no backtracking regexes over
// the page. It keeps the head's metadata, JSON-LD blocks and the page's
// readable text (an <article> or <main> when there is one).

/** What one page says about itself. */
export type ScannedPage = {
  title?: string;
  /** `property` or `name` (lowercased) → content; the first one wins. */
  meta: Map<string, string>;
  jsonLd: string[];
  text: string;
};

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

export const decodeEntities = (s: string) =>
  s.replace(/&(#\d{1,7}|#x[\da-f]{1,6}|[a-z]{2,8});/gi, (all, code: string) => {
    if (code[0] !== "#") return NAMED[code.toLowerCase()] ?? all;
    const n =
      code[1] === "x" || code[1] === "X"
        ? parseInt(code.slice(2), 16)
        : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  });

/** Elements whose text is never part of what the page says. */
const SKIP = new Set([
  "nav",
  "header",
  "footer",
  "aside",
  "button",
  "select",
  "template",
  "svg",
  "iframe",
  "object",
  "dialog",
  "menu",
  "figure",
]);
/** Raw-text elements: their content is not markup. */
const RAW = new Set([
  "script",
  "style",
  "title",
  "textarea",
  "noscript",
  "xmp",
]);
const BLOCK = new Set([
  "p",
  "div",
  "br",
  "li",
  "ul",
  "ol",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "tr",
  "td",
  "th",
  "dd",
  "dt",
  "section",
  "article",
  "main",
  "figcaption",
  "table",
  "hr",
]);

const ATTRIBUTE = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function attributesOf(source: string) {
  const out = new Map<string, string>();
  for (const m of source.matchAll(ATTRIBUTE)) {
    const name = m[1]!.toLowerCase();
    if (!out.has(name)) {
      out.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ""));
    }
  }
  return out;
}

/** Where a tag starting at `from` ends ('>' outside a quoted value), or -1. */
function tagEnd(html: string, from: number) {
  let quote = 0;
  let afterEquals = false;
  for (let i = from; i < html.length; i++) {
    const c = html.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
    } else if ((c === 34 || c === 39) && afterEquals) {
      quote = c;
    } else if (c === 62) {
      return i;
    }
    if (!quote && c !== 32 && c !== 9 && c !== 10 && c !== 13) {
      afterEquals = c === 61;
    }
  }
  // An unterminated quote: read the tag as ending at the next '>' instead.
  return quote ? html.indexOf(">", from) : -1;
}

const NAME = /[a-zA-Z][\w:-]*/y;
const NO_ATTRIBUTES = new Map<string, string>();

/** Paragraphs of collected text, whitespace folded. */
class Text {
  private parts: string[] = [];
  private size = 0;
  constructor(private readonly max: number) {}
  add(s: string) {
    if (this.size < this.max) {
      this.parts.push(s);
      this.size += s.length;
    }
  }
  break() {
    if (this.parts.at(-1) !== "\n") this.parts.push("\n");
  }
  toString() {
    return this.parts
      .join("")
      .split("\n")
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
  }
}

/** Scans a page once. Text is collected up to `maxText` characters per region. */
export function scanHtml(html: string, maxText = 200_000): ScannedPage {
  const meta = new Map<string, string>();
  const jsonLd: string[] = [];
  const page: ScannedPage = { meta, jsonLd, text: "" };
  const all = new Text(maxText);
  const article = new Text(maxText);
  const main = new Text(maxText);
  const open = new Map<string, number>();
  const depth = (name: string) => open.get(name) ?? 0;
  let skipping = 0;
  let pos = 0;

  const addText = (raw: string) => {
    if (skipping || !raw.trim()) return;
    const text = decodeEntities(raw);
    all.add(text);
    if (depth("article")) article.add(text);
    if (depth("main")) main.add(text);
  };
  const addBreak = () => {
    all.break();
    article.break();
    main.break();
  };

  while (pos < html.length) {
    const lt = html.indexOf("<", pos);
    if (lt < 0) {
      addText(html.slice(pos));
      break;
    }
    if (lt > pos) addText(html.slice(pos, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      pos = end < 0 ? html.length : end + 3;
      continue;
    }
    const closing = html[lt + 1] === "/";
    NAME.lastIndex = lt + (closing ? 2 : 1);
    const nameMatch = NAME.exec(html);
    if (!nameMatch) {
      // "<!doctype", "<?xml" or a stray "<": skip to its end, or keep as text.
      if (/[!?]/.test(html[lt + 1] ?? "")) {
        const end = html.indexOf(">", lt);
        pos = end < 0 ? html.length : end + 1;
      } else {
        addText("<");
        pos = lt + 1;
      }
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    const end = tagEnd(html, NAME.lastIndex);
    if (end < 0) break;
    pos = end + 1;
    if (BLOCK.has(name)) addBreak();

    if (closing) {
      if (depth(name)) {
        open.set(name, depth(name) - 1);
        if (SKIP.has(name)) skipping--;
      }
      continue;
    }
    // Only these tags carry anything that is kept.
    const attrs =
      name === "meta" || name === "script"
        ? attributesOf(html.slice(NAME.lastIndex, end))
        : NO_ATTRIBUTES;

    if (RAW.has(name)) {
      const close = new RegExp(`</${name}[\\s/>]`, "gi");
      close.lastIndex = pos;
      const found = close.exec(html);
      const content = html.slice(pos, found ? found.index : html.length);
      pos = found
        ? tagEnd(html, found.index + 2) + 1 || html.length
        : html.length;
      if (name === "title" && page.title === undefined) {
        page.title = decodeEntities(content).replace(/\s+/g, " ").trim();
      } else if (
        name === "script" &&
        attrs.get("type")?.toLowerCase() === "application/ld+json"
      ) {
        jsonLd.push(content);
      }
      continue;
    }
    if (name === "meta") {
      const key = (attrs.get("property") ?? attrs.get("name"))?.toLowerCase();
      const content = attrs.get("content")?.trim();
      if (key && content && !meta.has(key)) meta.set(key, content);
      continue;
    }
    // An oEmbed link the page names is never followed (gather.ts), so a
    // <link> carries nothing kept.
    if (name === "link") continue;
    // Void and self-closed elements never open a region.
    if (
      html[end - 1] === "/" ||
      name === "br" ||
      name === "hr" ||
      name === "img"
    ) {
      continue;
    }
    open.set(name, depth(name) + 1);
    if (SKIP.has(name)) skipping++;
  }

  const enough = (t: string) => t.length >= 500;
  const [a, m, rest] = [article.toString(), main.toString(), all.toString()];
  page.text = enough(a) ? a : enough(m) ? m : rest;
  return page;
}
