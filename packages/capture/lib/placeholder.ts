import { thumbHashToDataURL } from "thumbhash";

const cache = new Map<string, string>();

/** The blurred placeholder for a ThumbHash (base64), as a data URL. */
export function placeholderUrl(thumbhash: string): string | undefined {
  let url = cache.get(thumbhash);
  if (url) return url;
  try {
    const bytes = Uint8Array.from(atob(thumbhash), (c) => c.charCodeAt(0));
    url = thumbHashToDataURL(bytes);
  } catch {
    return undefined;
  }
  cache.set(thumbhash, url);
  return url;
}
