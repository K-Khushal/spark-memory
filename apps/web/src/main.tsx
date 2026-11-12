import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import * as Sentry from "@sentry/react";
import { sentryScrubbing } from "@spark/core/sentry";
import { registerServiceWorker } from "./pwa/register";
import { router } from "./router";
import { followSystemTheme } from "./theme";
import "./styles.css";

// Sentry only when the build has a DSN (docs/deploy.md). sentryScrubbing keeps
// Memory content in the browser (allowlist, tested in @spark/core).
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment:
      (import.meta.env.VITE_SPARK_ENV as string | undefined) ?? "local",
    ...sentryScrubbing,
  });
}

followSystemTheme();
registerServiceWorker();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const logError = (error: unknown) => console.error(error);
createRoot(
  root,
  sentryDsn
    ? {
        onUncaughtError: Sentry.reactErrorHandler(logError),
        onCaughtError: Sentry.reactErrorHandler(logError),
        onRecoverableError: Sentry.reactErrorHandler(logError),
      }
    : undefined
).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
