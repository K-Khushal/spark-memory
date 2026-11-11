import type { MemoryKind } from "./memory";

/**
 * Product events for the PRD's success metrics (PLAN.md §9). One module owns
 * the names and the properties. Properties are counts, kinds and durations:
 * never a Memory's content, title, Capture note, a search query, or an email.
 */
export const PRODUCT_EVENTS = {
  saveSuccess: "save_success",
  timeToSearchable: "time_to_searchable",
  searchSuccess: "search_success",
  reformulation: "search_reformulated",
  timeToFind: "time_to_find",
} as const;

export type ProductEvent =
  | { event: "save_success"; properties: { kind: "text" | "image" | "link" } }
  | {
      event: "time_to_searchable";
      properties: { kind: MemoryKind; milliseconds: number };
    }
  | {
      event: "search_success";
      properties: { direct: number; related: number };
    }
  | { event: "search_reformulated"; properties: Record<string, never> }
  | { event: "time_to_find"; properties: { milliseconds: number } };

export type ProductPayload = {
  event: (typeof PRODUCT_EVENTS)[keyof typeof PRODUCT_EVENTS];
  properties: Record<string, string | number>;
};

/** The wire payload: only the fields each event is allowed to carry. */
export function productPayload(event: ProductEvent): ProductPayload {
  switch (event.event) {
    case "save_success":
      return {
        event: PRODUCT_EVENTS.saveSuccess,
        properties: { kind: event.properties.kind },
      };
    case "time_to_searchable":
      return {
        event: PRODUCT_EVENTS.timeToSearchable,
        properties: {
          kind: event.properties.kind,
          milliseconds: event.properties.milliseconds,
        },
      };
    case "search_success":
      return {
        event: PRODUCT_EVENTS.searchSuccess,
        properties: {
          direct: event.properties.direct,
          related: event.properties.related,
        },
      };
    case "search_reformulated":
      return { event: PRODUCT_EVENTS.reformulation, properties: {} };
    case "time_to_find":
      return {
        event: PRODUCT_EVENTS.timeToFind,
        properties: { milliseconds: event.properties.milliseconds },
      };
  }
}

/** No key, or Do Not Track ("1" / "yes"): do not load or send anything. */
export function productAnalyticsEnabled(options: {
  key?: string | null;
  doNotTrack?: string | null;
}): boolean {
  if (!options.key) return false;
  const dnt = options.doNotTrack;
  return dnt !== "1" && dnt !== "yes";
}

const DEFAULT_HOST = "https://us.i.posthog.com";

const EVENT_PROPERTIES: Record<ProductPayload["event"], readonly string[]> = {
  save_success: ["kind"],
  time_to_searchable: ["kind", "milliseconds"],
  search_success: ["direct", "related"],
  search_reformulated: [],
  time_to_find: ["milliseconds"],
};

/**
 * What the dashboard may learn about analytics. A host that is not https
 * never carries a key, so the client cannot initialise against it.
 */
export function publicAnalytics(options: {
  key?: string | null;
  host?: string | null;
}): { key: string | null; host: string } {
  const host = options.host || DEFAULT_HOST;
  if (!host.startsWith("https://")) return { key: null, host };
  return { key: options.key || null, host };
}

/**
 * The last gate on an outgoing event. PostHog adds the current URL, the
 * referrer, campaign parameters and the browser on its own, and a URL can
 * hold a query string. Keep the event's own properties, the distinct id and
 * the project token (PostHog drops an event whose token was removed).
 * Anything else, including a dead click and its element text, is dropped.
 */
export function allowOutgoingProductEvent<
  T extends {
    uuid?: string;
    event: string;
    properties?: Record<string, unknown> | null;
    timestamp?: Date;
  },
>(event: T | null): T | null {
  if (!event) return null;
  if (!Object.hasOwn(EVENT_PROPERTIES, event.event)) return null;
  const allowed = EVENT_PROPERTIES[event.event as ProductPayload["event"]];
  const source = event.properties ?? {};
  const properties: Record<string, unknown> = {};
  if (typeof source.token === "string") properties.token = source.token;
  if (typeof source.distinct_id === "string") {
    properties.distinct_id = source.distinct_id;
  }
  for (const key of allowed) {
    const value = source[key];
    if (typeof value === "string" || typeof value === "number") {
      properties[key] = value;
    }
  }
  return {
    uuid: event.uuid,
    event: event.event,
    properties,
    timestamp: event.timestamp,
  } as T;
}

/** The slice of fetch this call needs. The timeout signal is attached by the caller. */
export type CaptureFetch = (
  url: string,
  init: {
    method: "POST";
    headers: { "content-type": "application/json" };
    body: string;
  }
) => Promise<{ ok: boolean }>;

/**
 * POST one event to PostHog's capture API. No key, a non-https host, or a
 * rejected call (the caller's signal timed out) is a no-op: nothing is
 * thrown and nothing is logged. The caller passes `fetch` and a signal that
 * aborts after 2 seconds.
 */
export async function sendProductEvent(options: {
  key?: string;
  host?: string;
  distinctId: string;
  event: ProductEvent;
  fetch: CaptureFetch;
  signal?: unknown;
}): Promise<boolean> {
  if (!options.key) return false;
  const base = (options.host || DEFAULT_HOST).replace(/\/$/, "");
  if (!base.startsWith("https://")) return false;
  const payload = productPayload(options.event);
  try {
    const res = await options.fetch(`${base}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: options.key,
        event: payload.event,
        distinct_id: options.distinctId,
        properties: payload.properties,
      }),
      // The caller's abort signal. Kept off CaptureFetch so this package
      // does not depend on the DOM lib; every runtime fetch accepts it.
      signal: options.signal,
    } as Parameters<CaptureFetch>[1]);
    return res.ok;
  } catch {
    return false;
  }
}
