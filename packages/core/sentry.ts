// Entry point @spark/core/sentry: the privacy settings every Sentry SDK in
// Spark spreads into its init options (Worker and dashboard).
import { scrubBreadcrumb, scrubEvent } from "./lib/sentry-scrub";

export const sentryScrubbing = {
  /** Turn off every automatic collection that can carry Memory content. */
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    frameContextLines: 0,
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
  },
  /** Then keep only allowlisted fields of whatever is still sent. */
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
};
