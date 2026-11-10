import type { BetterAuthPlugin } from "better-auth";

// Better Auth and its plugins mount many routes Spark must not expose:
// email + password, password resets, account editing. Rather than disabling
// them one by one (and missing the next one a version adds), only these are
// reachable; everything else under /api/auth is 404.
const ROUTES: { method: "GET" | "POST"; path: RegExp }[] = [
  { method: "GET", path: /^\/get-session$/ },
  { method: "POST", path: /^\/sign-out$/ },
  { method: "POST", path: /^\/email-otp\/send-verification-otp$/ },
  { method: "POST", path: /^\/sign-in\/email-otp$/ },
  { method: "POST", path: /^\/sign-in\/social$/ },
  // OAuth providers return here; some (Apple) POST.
  { method: "GET", path: /^\/callback\/[a-z]+$/ },
  { method: "POST", path: /^\/callback\/[a-z]+$/ },
  { method: "GET", path: /^\/error$/ },
];

const SEND_CODE = "/email-otp/send-verification-otp";

export function allowlist(basePath: string): BetterAuthPlugin {
  return {
    id: "spark-allowlist",
    onRequest: async (request) => {
      const path = new URL(request.url).pathname.slice(basePath.length);
      const allowed = ROUTES.some(
        (r) => r.method === request.method && r.path.test(path)
      );
      if (!allowed) return { response: new Response(null, { status: 404 }) };
      // Codes are for signing in only, never resets or email changes.
      if (path === SEND_CODE) {
        const body = (await request
          .clone()
          .json()
          .catch(() => null)) as { type?: unknown } | null;
        if (body?.type !== "sign-in") {
          return {
            response: Response.json(
              { code: "INVALID_OTP_TYPE", message: "Invalid code type" },
              { status: 400 }
            ),
          };
        }
      }
    },
  };
}
