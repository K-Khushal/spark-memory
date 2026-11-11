/**
 * What ends with a session, as one call: every way a session ends (sign-out
 * here, sign-out everywhere, account deletion) runs the same cleanups, so
 * none can be forgotten. One failing cleanup never stops the others.
 */
export function createEndSession(cleanups: (() => void)[]) {
  return () => {
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch {
        // The rest still run; the page is leaving for sign-in anyway.
      }
    }
  };
}
