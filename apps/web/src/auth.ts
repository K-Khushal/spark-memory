import { redirect } from "@tanstack/react-router";
import { createSparkAuthClient } from "@spark/auth/client";

export const authClient = createSparkAuthClient();

export type Session = NonNullable<
  Awaited<ReturnType<typeof authClient.getSession>>["data"]
>;

/** The current session from the cookie, or null. Cached by Better Auth's client. */
export async function currentSession(): Promise<Session | null> {
  const { data } = await authClient.getSession();
  return data ?? null;
}

/** Route guard for signed-in screens. */
export async function requireSession() {
  const session = await currentSession();
  if (!session) throw redirect({ to: "/sign-in" });
  return { session };
}

/** Route guard for the sign-in screen: signed-in people go to their Library. */
export async function redirectIfSignedIn() {
  if (await currentSession()) throw redirect({ to: "/" });
}
