// Browser entry point of @spark/auth: the Better Auth client for the dashboard
// (and later the extension). Same-origin by default.
import { createAuthClient } from "better-auth/react";
import {
  emailOTPClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";

export function createSparkAuthClient(baseURL?: string) {
  return createAuthClient({
    baseURL,
    basePath: "/api/auth",
    plugins: [
      emailOTPClient(),
      inferAdditionalFields({ user: { plan: { type: "string" } } }),
    ],
  });
}

export type SparkAuthClient = ReturnType<typeof createSparkAuthClient>;
