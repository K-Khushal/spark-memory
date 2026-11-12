/** App-shell Cache API prefix. Anything else is treated as user data. */
export const SHELL_CACHE_PREFIX = "spark-shell-";

export const SHARE_PATH = "/share";
export const OFFLINE_PATH = "/offline.html";

export function shellCacheName(version: string): string {
  return `${SHELL_CACHE_PREFIX}${version}`;
}

/** The Android share-target POST this origin answers. */
export function isSharePost(request: Request, origin: string): boolean {
  if (request.method !== "POST") return false;
  const url = new URL(request.url);
  return url.origin === origin && url.pathname === SHARE_PATH;
}
