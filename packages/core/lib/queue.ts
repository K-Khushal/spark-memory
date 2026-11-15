/** Cloudflare Queues accepts integer delays from zero through twelve hours. */
export const queueDelaySeconds = (seconds: number): number =>
  Math.min(43_200, Math.max(0, Math.ceil(seconds) || 0));
