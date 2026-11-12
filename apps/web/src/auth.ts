import { redirect } from "@tanstack/react-router";
import { createSparkAuthClient } from "@spark/auth/client";
import { api } from "./api";
import { stopAnalytics } from "./analytics";
import { clearSearchCache } from "./library/search-session";
import { clearHeldShares } from "./pwa/hold";
import { clearUserCaches } from "./pwa/register";
import { createEndSession } from "./session-end";
import { createSessionGate } from "./session-gate";

export const authClient = createSparkAuthClient();

export type Session = NonNullable<
  Awaited<ReturnType<typeof authClient.getSession>>["data"]
>;

/** The signed-in person the dashboard needs. Admin comes from the same read. */
export type AppSession = {
  user: { id: string; email: string; name: string };
};

/** The current session from the cookie, or null. Cached by Better Auth's client. */
export async function currentSession(): Promise<Session | null> {
  const { data } = await authClient.getSession();
  return data ?? null;
}

const gate = createSessionGate({
  currentSession: async () => {
    const session = await currentSession();
    if (!session) return null;
    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
    };
  },
  readAdmin: async () => {
    const res = await api.api.me.$get();
    if (!res.ok) return null;
    return (await res.json()).admin === true;
  },
});

/** Drop the cached admin flag. Sign-out calls this with the analytics reset. */
export function clearAdminCache() {
  gate.clear();
}

/**
 * Forgets the person who was signed in: analytics, the admin flag and
 * every search answer. Call it on every way a session ends.
 */
export const endSession = createEndSession([
  stopAnalytics,
  clearAdminCache,
  clearSearchCache,
  clearHeldShares,
  clearUserCaches,
]);

/** An admin route answered 403: the stored flag is no longer trustworthy. */
export function noteAdminStatus(status: number) {
  gate.noteStatus(status);
}

/**
 * Route guard for signed-in screens. The Library reuses the admin flag.
 * Admin passes `freshAdmin` so a person who lost the role is turned away.
 * A failed `/api/me` is not stored.
 */
export async function requireSession(options?: { freshAdmin?: boolean }) {
  const result = await gate.require(options);
  if (!result) throw redirect({ to: "/sign-in" });
  return result;
}

/** Route guard for the sign-in screen: signed-in people go to their Library. */
export async function redirectIfSignedIn() {
  if (await currentSession()) throw redirect({ to: "/" });
}
