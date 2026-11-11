import { redirect } from "@tanstack/react-router";
import { createSparkAuthClient } from "@spark/auth/client";
import { api } from "./api";

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

let gate: { session: AppSession; admin: boolean } | null = null;

/** Drop the cached admin flag. Sign-out calls this with the analytics reset. */
export function clearAdminCache() {
  gate = null;
}

/**
 * Route guard for signed-in screens. The admin flag is read once per person
 * and reused by later routes, so opening the Library and then Admin does
 * not ask `/api/me` again.
 */
export async function requireSession() {
  const session = await currentSession();
  if (!session) {
    gate = null;
    throw redirect({ to: "/sign-in" });
  }
  if (gate && gate.session.user.id === session.user.id) return gate;
  const res = await api.api.me.$get();
  const admin = res.ok ? (await res.json()).admin === true : false;
  gate = {
    session: {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      },
    },
    admin,
  };
  return gate;
}

/** Route guard for the sign-in screen: signed-in people go to their Library. */
export async function redirectIfSignedIn() {
  if (await currentSession()) throw redirect({ to: "/" });
}
