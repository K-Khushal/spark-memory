// The service worker, bundled to /sw.js by the spark-sw Vite plugin.
//
// It caches one thing: the offline page. It never answers a request from a
// cache except that page, so no response (the API, a Memory, a session) can
// be served to the wrong person or go stale. Its second job is the Android
// share-target POST: hold the share in IndexedDB, redirect to the Library.
import { holdShare, shareFromForm, type PendingShare } from "./hold";
import {
  isSharePost,
  judgeShare,
  OFFLINE_PATH,
  refusalPath,
  SHELL_CACHE_PREFIX,
  shellCacheName,
} from "./policy";
import {
  checkShare,
  MAX_HELD_SHARES,
  MAX_SHARE_BYTES,
  type ShareRefusal,
} from "./validate";

declare const __SPARK_SW_VERSION__: string;

type WorkerEvent = Event & {
  waitUntil: (work: Promise<unknown>) => void;
  request: Request;
  respondWith: (response: Response | Promise<Response>) => void;
};

const worker = self as unknown as {
  location: { origin: string };
  skipWaiting: () => Promise<void>;
  clients: { claim: () => Promise<void> };
  addEventListener: (type: string, on: (event: WorkerEvent) => void) => void;
};

const shell = shellCacheName(`${__SPARK_SW_VERSION__}-fonts`);

const fonts = [
  "/fonts/assistant-instrument-sans.woff2",
  "/fonts/assistant-bricolage.woff2",
];

const redirect = (to: string, from: Request) =>
  Response.redirect(new URL(to, from.url).toString(), 303);

/**
 * Holds a share for the Library, or sends the person to a page that says
 * why not. Nothing is stored unless the post could be a share (not another
 * site's form) and fits the Free allowance.
 */
async function receiveShare(request: Request): Promise<Response> {
  const refuse = (reason: ShareRefusal) =>
    redirect(refusalPath(reason), request);
  const verdict = judgeShare(request, worker.location.origin);
  if (verdict === "refuse") return refuse("untrusted");
  if (Number(request.headers.get("content-length")) > MAX_SHARE_BYTES) {
    return refuse("too_large");
  }
  let share: PendingShare;
  try {
    share = shareFromForm(await request.formData(), verdict === "accept");
  } catch {
    return refuse("unreadable");
  }
  const refusal = checkShare(share);
  if (refusal) return refuse(refusal);
  try {
    if (!(await holdShare(share, MAX_HELD_SHARES))) return refuse("storage");
  } catch {
    return refuse("storage");
  }
  return redirect("/", request);
}

async function navigate(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    const offline = await (await caches.open(shell)).match(OFFLINE_PATH);
    return offline ?? Response.error();
  }
}

worker.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(shell)
      .then((cache) =>
        Promise.all(
          [OFFLINE_PATH, ...fonts].map((path) =>
            cache.add(
              new Request(new URL(path, worker.location.origin), {
                cache: "reload",
              })
            )
          )
        )
      )
      .then(() => worker.skipWaiting())
  );
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith(SHELL_CACHE_PREFIX) && key !== shell
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => worker.clients.claim())
  );
});

worker.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method === "GET" &&
    url.origin === worker.location.origin &&
    fonts.includes(url.pathname)
  ) {
    event.respondWith(
      caches
        .open(shell)
        .then(
          async (cache) => (await cache.match(url.pathname)) ?? fetch(request)
        )
    );
  } else if (isSharePost(request, worker.location.origin)) {
    event.respondWith(receiveShare(request));
  } else if (request.mode === "navigate" && request.method === "GET") {
    event.respondWith(navigate(request));
  }
});
