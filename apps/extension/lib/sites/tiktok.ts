import type { SiteAdapter, SitePost } from "./adapter";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v !== null && typeof v === "object" ? (v as Json) : {};
const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/** The page's own data: the video's description and author, as TikTok sends them to its app. */
function fromData(doc: Document): SitePost | undefined {
  const raw = doc.querySelector(
    "script#__UNIVERSAL_DATA_FOR_REHYDRATION__"
  )?.textContent;
  if (!raw) return undefined;
  let item: Json;
  try {
    item = obj(
      obj(obj(obj(JSON.parse(raw)).__DEFAULT_SCOPE__)["webapp.video-detail"])
        .itemInfo
    );
  } catch {
    return undefined;
  }
  const video = obj(item.itemStruct);
  const text = str(video.desc);
  if (!text) return undefined;
  const author = obj(video.author);
  const handle = str(author.uniqueId);
  const name = str(author.nickname);
  const created = Number(video.createTime);
  return {
    text,
    author:
      name && handle ? `${name} (@${handle})` : handle ? `@${handle}` : name,
    publishedAt:
      Number.isFinite(created) && created > 0
        ? new Date(created * 1000).toISOString()
        : undefined,
    imageUrl: str(obj(video.video).cover),
  };
}

/** What is on screen, by the attributes TikTok's own tests use. */
function fromScreen(doc: Document): SitePost | undefined {
  const text = doc
    .querySelector('[data-e2e="browse-video-desc"]')
    ?.textContent?.trim();
  if (!text) return undefined;
  const user = doc
    .querySelector('[data-e2e="browse-username"]')
    ?.textContent?.trim();
  return { text, author: user && (user.startsWith("@") ? user : `@${user}`) };
}

/** tiktok.com/@<user>/video/<id>. */
export const tiktok: SiteAdapter = {
  id: "tiktok",
  origin: "https://www.tiktok.com",
  matches: (url) =>
    url.hostname === "www.tiktok.com" &&
    /^\/@[^/]+\/video\/\d+/.test(url.pathname),
  read: (doc) => fromData(doc) ?? fromScreen(doc),
};
