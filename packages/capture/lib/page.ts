import Defuddle from "defuddle";
import { FREE_ALLOWANCE, LINK_MAX_CHARS, PageExtract } from "@spark/core";

/** Local DOM only: never invoke Defuddle's asynchronous network extractors. */
export function extractPage(document: Document, url: string): PageExtract {
  const result = new Defuddle(document.cloneNode(true) as Document, {
    url,
    useAsync: false,
    debug: false,
  }).parse();
  const body = document.createElement("template");
  body.innerHTML = result.content;
  body.content
    .querySelectorAll("script,style,noscript")
    .forEach((node) => node.remove());
  return PageExtract.parse({
    title: result.title?.slice(0, FREE_ALLOWANCE.titleMaxChars),
    description: result.description?.slice(0, 2000),
    author: result.author?.slice(0, 200),
    siteName: result.site?.slice(0, 200),
    publishedAt: result.published?.slice(0, 80),
    imageUrl: result.image?.length <= LINK_MAX_CHARS ? result.image : undefined,
    text: body.content.textContent
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, FREE_ALLOWANCE.textMaxChars),
  });
}
