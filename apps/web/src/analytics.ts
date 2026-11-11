import {
  allowOutgoingProductEvent,
  productAnalyticsEnabled,
  publicAnalytics,
  type ProductEvent,
} from "@spark/core";
import { api } from "./api";
import { browserDoNotTrack, createAnalytics } from "./product-analytics";

type Client = {
  capture: (event: string, properties: Record<string, string | number>) => void;
  identify: (userId: string) => void;
  reset: () => void;
};

async function loadPosthog(): Promise<Client | null> {
  const res = await api.api.analytics.$get();
  if (!res.ok) return null;
  const published = publicAnalytics(await res.json());
  if (!published.key || !published.host.startsWith("https://")) return null;
  if (
    !productAnalyticsEnabled({
      key: published.key,
      doNotTrack: browserDoNotTrack(),
    })
  ) {
    return null;
  }
  const { default: posthog } = await import("posthog-js");
  posthog.init(published.key, {
    api_host: published.host,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    enable_heatmaps: false,
    capture_performance: false,
    disable_session_recording: true,
    advanced_disable_flags: true,
    respect_dnt: true,
    person_profiles: "identified_only",
    before_send: allowOutgoingProductEvent,
  });
  return posthog;
}

const analytics = createAnalytics(loadPosthog);

/**
 * Load PostHog only when a key is configured, the host is https, and Do Not
 * Track is off. The module is imported then, so a Library without analytics
 * never downloads it. The person is identified by id, with no email and no traits.
 */
export function startAnalytics(userId: string) {
  analytics.start(userId);
}

/** Forget the signed-in person. The next start identifies whoever signs in. */
export function stopAnalytics() {
  analytics.stop();
}

/** A product event, dropped when analytics is off. */
export function track(event: ProductEvent) {
  analytics.track(event);
}
