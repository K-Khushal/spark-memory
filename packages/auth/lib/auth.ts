import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { captcha, emailOTP } from "better-auth/plugins";
import { DEFAULT_PLAN } from "@spark/core";
import { schema, type Database } from "@spark/db";

/** Configuration and secrets, from the Worker's env (docs/deploy.md). */
export type AuthConfig = {
  secret: string;
  /** Public origin, e.g. https://sparkmemory.xyz. Inferred from the request when unset. */
  baseURL?: string;
  turnstileSecretKey: string;
  google?: { clientId?: string; clientSecret?: string };
  github?: { clientId?: string; clientSecret?: string };
};

export const SOCIAL_PROVIDERS = ["google", "github"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/** The social providers with both a client id and secret configured. */
export function enabledSocialProviders(config: AuthConfig): SocialProvider[] {
  return SOCIAL_PROVIDERS.filter(
    (p) => config[p]?.clientId && config[p]?.clientSecret
  );
}

/** Paths Turnstile guards: every way an account can be created. */
const TURNSTILE_PATHS = ["/email-otp/send-verification-otp", "/sign-in/social"];

/**
 * Better Auth for one request (ADR-0007): email codes and social sign-in, no
 * passwords. `sendSignInCode` must not block: queue it with `waitUntil`.
 */
export function createAuth({
  db,
  config,
  sendSignInCode,
}: {
  db: Database;
  config: AuthConfig;
  sendSignInCode: (email: string, code: string) => void;
}) {
  const socialProviders = Object.fromEntries(
    enabledSocialProviders(config).map((p) => [p, config[p]])
  ) as Record<SocialProvider, { clientId: string; clientSecret: string }>;

  return betterAuth({
    appName: "Spark",
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/api/auth",
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: false },
    socialProviders,
    user: {
      additionalFields: {
        plan: {
          type: "string",
          required: true,
          defaultValue: DEFAULT_PLAN,
          input: false,
        },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    // Per IP, in Postgres so every Worker isolate shares the counters.
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60, max: 3 },
        "/sign-in/email-otp": { window: 60, max: 10 },
        "/sign-in/social": { window: 60, max: 10 },
      },
    },
    advanced: {
      // Set by Cloudflare's edge; clients cannot spoof it there.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    plugins: [
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: config.turnstileSecretKey,
        endpoints: TURNSTILE_PATHS,
      }),
      emailOTP({
        storeOTP: "hashed",
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        sendVerificationOTP: async ({ email, otp }) => {
          sendSignInCode(email, otp);
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
