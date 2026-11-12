import type { ShareRefusal } from "./validate";

/** App-shell Cache API prefix. Anything else is treated as user data. */
export const SHELL_CACHE_PREFIX = "spark-shell-";

export const SHARE_PATH = "/share";
export const OFFLINE_PATH = "/offline.html";

/** The page that says why a share was turned away. */
export function refusalPath(reason: ShareRefusal): string {
  return `${SHARE_PATH}?refused=${reason}`;
}

export function shellCacheName(version: string): string {
  return `${SHELL_CACHE_PREFIX}${version}`;
}

/** The Android share-target POST this origin answers. */
export function isSharePost(request: Request, origin: string): boolean {
  if (request.method !== "POST") return false;
  const url = new URL(request.url);
  return url.origin === origin && url.pathname === SHARE_PATH;
}

/** What to do with a share-target POST, by where it came from. */
export type ShareVerdict = "accept" | "confirm" | "refuse";

/**
 * Chromium hides Sec-Fetch-Site from a worker but shows it Origin and the
 * referrer. A cross-site form carries its own site's Origin, so that is
 * refused. But a page can make its Origin "null" (Referrer-Policy:
 * no-referrer, a sandboxed frame, an https page posting to http), and the
 * system share sheet may also send "null": that one is held but not
 * Captured until the person says so. No Origin at all, or ours, cannot come
 * from another site's form, so that is a share.
 */
export function judgeShare(request: Request, own: string): ShareVerdict {
  const origin = request.headers.get("origin");
  if (origin && origin !== "null" && origin !== own) return "refuse";
  const from = request.referrer;
  if (from && from !== "about:client" && new URL(from).origin !== own) {
    return "refuse";
  }
  return origin === "null" ? "confirm" : "accept";
}
