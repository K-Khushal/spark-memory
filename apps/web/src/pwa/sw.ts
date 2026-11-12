// The service worker, bundled to /sw.js by the spark-sw Vite plugin.
//
// It caches one thing: the offline page. It never answers a request from a
// cache except that page, so no response (the API, a Memory, a session) can
// be served to the wrong person or go stale. Its second job is the Android
// share-target POST: hold the share in IndexedDB, redirect to the Library.
import { holdShare, shareFromForm } from "./hold";
import {
  isSharePost,
  OFFLINE_PATH,
  SHELL_CACHE_PREFIX,
  shellCacheName,
} from "./policy";

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

const shell = shellCacheName(__SPARK_SW_VERSION__);

async function receiveShare(request: Request): Promise<Response> {
  try {
    await holdShare(shareFromForm(await request.formData()));
  } catch {
    // Open Spark anyway; a failed hold must not strand the share sheet.
  }
  return Response.redirect(new URL("/", request.url).toString(), 303);
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
        cache.add(
          new Request(new URL(OFFLINE_PATH, worker.location.origin), {
            cache: "reload",
          })
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
  if (isSharePost(request, worker.location.origin)) {
    event.respondWith(receiveShare(request));
  } else if (request.mode === "navigate" && request.method === "GET") {
    event.respondWith(navigate(request));
  }
});
