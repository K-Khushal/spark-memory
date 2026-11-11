import {
  productAnalyticsEnabled,
  productPayload,
  type ProductEvent,
} from "@spark/core";

type Client = {
  capture: (event: string, properties: Record<string, string | number>) => void;
  identify: (userId: string) => void;
  reset: () => void;
};

/** Do Not Track, from the browser. "1" and "yes" both mean do not track. */
export function browserDoNotTrack(): string | null {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return null;
  }
  const nav = navigator as Navigator & { msDoNotTrack?: string };
  const win = window as Window & { doNotTrack?: string };
  return nav.doNotTrack || win.doNotTrack || nav.msDoNotTrack || null;
}

/**
 * Whether a Capture happening now may be included in product events.
 * The real key still has to be configured on the server; this only records
 * the person's Do Not Track choice, because the browser cannot send that
 * header with the Capture.
 */
export function captureProductAnalytics(): boolean {
  return productAnalyticsEnabled({
    key: "capture",
    doNotTrack: browserDoNotTrack(),
  });
}

/**
 * One analytics session. `load` returns the client, or null when there is
 * nothing to send. A later start identifies the person who just signed in.
 */
export function createAnalytics(
  load: (userId: string) => Promise<Client | null>
) {
  let client: Client | null = null;
  let starting = false;
  let pendingId: string | null = null;

  return {
    stop() {
      client?.reset();
      client = null;
      starting = false;
      pendingId = null;
    },
    start(userId: string) {
      pendingId = userId;
      if (client) {
        client.identify(userId);
        return;
      }
      if (starting) return;
      if (!captureProductAnalytics()) return;
      starting = true;
      void load(userId)
        .then((next) => {
          if (!starting || !pendingId) {
            next?.reset();
            return;
          }
          client = next;
          client?.identify(pendingId);
        })
        .catch(() => {
          // Product analytics never blocks the Library.
        })
        .finally(() => {
          starting = false;
        });
    },
    track(event: ProductEvent) {
      if (!client) return;
      const payload = productPayload(event);
      client.capture(payload.event, payload.properties);
    },
  };
}
