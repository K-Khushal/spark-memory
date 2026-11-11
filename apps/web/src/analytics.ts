import {
  productAnalyticsEnabled,
  productPayload,
  type ProductEvent,
} from "@spark/core";
import { api } from "./api";

type Client = {
  capture: (event: string, properties: Record<string, string | number>) => void;
};

let client: Client | null = null;
let starting = false;

/** Do Not Track, from the browser. "1" and "yes" both mean do not track. */
export function browserDoNotTrack(): string | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { msDoNotTrack?: string };
  const win = window as Window & { doNotTrack?: string };
  return nav.doNotTrack || win.doNotTrack || nav.msDoNotTrack || null;
}

/**
 * Load PostHog only when a key is configured and Do Not Track is off.
 * The module is imported then, so a Library without analytics never downloads it.
 * The person is identified by id, with no email and no traits.
 */
export function startAnalytics(userId: string) {
  if (client || starting) return;
  if (
    !productAnalyticsEnabled({ key: "check", doNotTrack: browserDoNotTrack() })
  ) {
    return;
  }
  starting = true;
  void load(userId);
}

async function load(userId: string) {
  try {
    const res = await api.api.analytics.$get();
    if (!res.ok) return;
    const { key, host } = await res.json();
    if (!productAnalyticsEnabled({ key, doNotTrack: browserDoNotTrack() })) {
      return;
    }
    if (!key) return;
    const { default: posthog } = await import("posthog-js");
    posthog.init(key, {
      api_host: host,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      respect_dnt: true,
      person_profiles: "identified_only",
    });
    posthog.identify(userId);
    client = posthog;
  } catch {
    // Product analytics never blocks the Library.
  }
}

/** A product event, dropped when analytics is off. */
export function track(event: ProductEvent) {
  if (!client) return;
  const payload = productPayload(event);
  client.capture(payload.event, payload.properties);
}
