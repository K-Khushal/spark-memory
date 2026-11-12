import { SHELL_CACHE_PREFIX } from "./policy";

/** Dev and prod both register it: the share target needs the worker. */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js");
}

/**
 * Sign-out: delete every Cache API entry that is not the app shell. The
 * worker caches nothing of a person's, so this is the belt for anything else.
 */
export function clearUserCaches() {
  if (typeof caches === "undefined") return;
  void caches
    .keys()
    .then((keys) =>
      Promise.all(
        keys
          .filter((key) => !key.startsWith(SHELL_CACHE_PREFIX))
          .map((key) => caches.delete(key))
      )
    )
    .catch(() => {});
}
