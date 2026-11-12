// `pnpm --filter @spark/evals assemble`: rebuilds library/ (files, texts and
// manifest.json) from scripts/sources.json, scripts/notes.json and
// scripts/screens.ts. Fetches Wikimedia Commons, Wikipedia and Project
// Gutenberg (politely: one request at a time), refuses any image licence
// that is not CC0, public domain or CC BY, renders the screenshots, and works
// out each image's size, hash, ThumbHash and palette the way Capture does
// (a browser decodes; @spark/capture's own palette code runs on the pixels).
// Run by hand when the sample Library changes; CI never runs it.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { rgbaToThumbHash } from "thumbhash";
import { dominantColours } from "@spark/capture";
import type { SampleMemory } from "../src/manifest";
import { SCREENS } from "./screens";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "library");
/** Where our own Memories live, for their source link. */
const REPO = "https://github.com/K-Khushal/spark-memory/blob/main/evals/";
const UA = "spark-evals-sample-library/1.0 (open-licence sample set)";
const FREE = /^(cc0|public domain|pd\b|cc[- ]by[- ]\d)/i;

type Sources = {
  commons: {
    id: string;
    file: string;
    tags: string[];
    ocr?: string;
    description?: string;
  }[];
  wikipedia: {
    id: string;
    title: string;
    lang?: string;
    intro: boolean;
    tags?: string[];
  }[];
  gutenberg: {
    id: string;
    book: number;
    title: string;
    author: string;
    from: string;
    to?: string;
    tags: string[];
    max?: number;
  }[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(url: string) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    await sleep(700);
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return res;
    await sleep(4000 * attempt);
  }
  throw new Error(`could not fetch ${new URL(url).hostname}`);
}
const json = async (url: string) => (await get(url)).json();
const plain = (html?: string) =>
  (html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
const write = async (path: string, data: string | Uint8Array) => {
  await mkdir(dirname(join(lib, path)), { recursive: true });
  await writeFile(join(lib, path), data);
};

const sources: Sources = JSON.parse(
  await readFile(join(root, "scripts/sources.json"), "utf8")
);
const notes: {
  id: string;
  title: string;
  body: string;
  captureNote?: string;
  language?: string;
  tags: string[];
}[] = JSON.parse(await readFile(join(root, "scripts/notes.json"), "utf8"));

await rm(lib, { recursive: true, force: true });
const memories: SampleMemory[] = [];
const text = async (id: string, body: string) => {
  await write(`texts/${id}.txt`, body.trim() + "\n");
  return `texts/${id}.txt`;
};

for (const n of notes) {
  memories.push({
    id: n.id,
    kind: "text",
    title: n.title,
    text: await text(n.id, n.body),
    ...(n.captureNote && { captureNote: n.captureNote }),
    tags: n.tags,
    language: n.language ?? "en",
    source: {
      type: "original",
      url: `${REPO}library/texts/${n.id}.txt`,
      licence: "CC0 1.0",
      attribution: "Written for this sample Library",
    },
  });
}

for (const w of sources.wikipedia) {
  const lang = w.lang ?? "en";
  const q = new URLSearchParams({
    action: "query",
    format: "json",
    titles: w.title,
    prop: "extracts|revisions",
    explaintext: "1",
    exsectionformat: "plain",
    rvprop: "ids",
    redirects: "1",
    ...(w.intro && { exintro: "1" }),
  });
  const page = Object.values(
    (await json(`https://${lang}.wikipedia.org/w/api.php?${q}`)).query.pages
  )[0] as {
    title: string;
    extract: string;
    revisions: { revid: number }[];
  };
  const url = `https://${lang}.wikipedia.org/w/index.php?title=${encodeURIComponent(page.title.replaceAll(" ", "_"))}&oldid=${page.revisions[0]!.revid}`;
  memories.push({
    id: w.id,
    kind: "text",
    title: page.title,
    text: await text(w.id, page.extract),
    tags: w.tags ?? [],
    language: lang,
    source: {
      type: "wikipedia",
      url,
      licence: "CC BY-SA 4.0",
      licenceUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      attribution: `Wikipedia contributors, "${page.title}"`,
    },
  });
}

for (const g of sources.gutenberg) {
  const full = await (
    await get(`https://www.gutenberg.org/cache/epub/${g.book}/pg${g.book}.txt`)
  ).text();
  const start = full.indexOf(g.from, full.indexOf("*** START"));
  const end = g.to ? full.indexOf(g.to, start + g.from.length) : full.length;
  if (start < 0 || end < 0)
    throw new Error(`markers not found in book ${g.book}`);
  const body = full
    .slice(start, end)
    .replace(/\r/g, "")
    .slice(0, g.max ?? 30_000);
  memories.push({
    id: g.id,
    kind: "text",
    title: g.title,
    text: await text(g.id, body),
    tags: g.tags,
    language: "en",
    source: {
      type: "gutenberg",
      url: `https://www.gutenberg.org/ebooks/${g.book}`,
      licence: "Public domain",
      attribution: `${g.author}, ${g.title} (Project Gutenberg)`,
    },
  });
}

type Raw = {
  sample: Omit<SampleMemory, "image">;
  bytes: Uint8Array;
  mime: "image/jpeg" | "image/png";
};
const raws: Raw[] = [];
for (const c of sources.commons) {
  const q = new URLSearchParams({
    action: "query",
    format: "json",
    titles: c.file,
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "640",
  });
  const page = Object.values(
    (await json(`https://commons.wikimedia.org/w/api.php?${q}`)).query.pages
  )[0] as {
    imageinfo: {
      thumburl: string;
      descriptionurl: string;
      extmetadata: Record<string, { value: string }>;
    }[];
  };
  const info = page.imageinfo[0]!;
  const meta = info.extmetadata;
  const licence = meta.LicenseShortName?.value ?? "";
  if (!FREE.test(licence))
    throw new Error(
      `${c.id}: licence "${licence}" is not CC0, public domain or CC BY`
    );
  const res = await get(info.thumburl);
  const mime = res.headers.get("content-type")?.startsWith("image/png")
    ? "image/png"
    : "image/jpeg";
  const description =
    c.description ??
    (plain(meta.ImageDescription?.value).slice(0, 300) ||
      c.file.replace(/^File:|\.\w+$/g, "").replaceAll("_", " "));
  raws.push({
    mime,
    bytes: new Uint8Array(await res.arrayBuffer()),
    sample: {
      id: c.id,
      kind: "image",
      tags: c.tags,
      language: "en",
      file: `files/${c.id}.${mime === "image/png" ? "png" : "jpg"}`,
      source: {
        type: "commons",
        url: info.descriptionurl,
        licence,
        ...(meta.LicenseUrl?.value && { licenceUrl: meta.LicenseUrl.value }),
        attribution: [plain(meta.Artist?.value), plain(meta.Credit?.value)]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 200),
      },
      extraction: {
        title: c.file
          .replace(/^File:|\.\w+$/g, "")
          .replaceAll("_", " ")
          .slice(0, 120),
        description,
        ocrText: c.ocr ?? "",
        tags: c.tags,
        language: "en",
      },
    },
  });
}

const browser = await chromium.launch();
const view = await browser.newPage();
for (const s of SCREENS) {
  await view.setViewportSize({ width: s.width, height: s.height });
  await view.setContent(`<!doctype html><meta charset="utf-8">${s.html}`);
  const ocr = ((await view.evaluate("document.body.innerText")) as string)
    .replace(/\n{2,}/g, "\n")
    .trim();
  raws.push({
    mime: "image/png",
    bytes: await view.screenshot({ type: "png" }),
    sample: {
      id: s.id,
      kind: "image",
      tags: s.tags,
      language: "en",
      file: `files/${s.id}.png`,
      source: {
        type: "original",
        url: `${REPO}scripts/screens.ts`,
        licence: "CC0 1.0",
        attribution: "Drawn for this sample Library (evals/scripts/screens.ts)",
      },
      extraction: {
        title: s.title,
        description: s.description,
        ocrText: ocr,
        tags: s.tags,
        language: "en",
      },
    },
  });
}

// What Capture sends with an image: size, hash, ThumbHash and palette.
for (const { sample, bytes, mime } of raws) {
  await write(sample.file!, bytes);
  const px = await view.evaluate(
    async (url) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const scale = Math.min(1, 100 / Math.max(bitmap.width, bitmap.height));
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.round(bitmap.width * scale)),
        Math.max(1, Math.round(bitmap.height * scale))
      );
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const { data, width, height } = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );
      return {
        data: [...data],
        width,
        height,
        fullWidth: bitmap.width,
        fullHeight: bitmap.height,
      };
    },
    `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`
  );
  const rgba = Uint8Array.from(px.data);
  memories.push({
    ...sample,
    image: {
      mime,
      bytes: bytes.length,
      width: px.fullWidth,
      height: px.fullHeight,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      thumbhash: Buffer.from(
        rgbaToThumbHash(px.width, px.height, rgba)
      ).toString("base64"),
      palette: dominantColours(rgba),
    },
  });
}
await browser.close();

memories.sort((a, b) => a.id.localeCompare(b.id));
const ids = new Set(memories.map((i) => i.id));
if (ids.size !== memories.length) throw new Error("duplicate ids");
await write("manifest.json", JSON.stringify(memories, null, 1) + "\n");
console.log(`assembled ${memories.length} Memories`);
