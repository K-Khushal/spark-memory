import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import * as Sentry from "@sentry/react";
import { router } from "./router";
import "./styles.css";

// Sentry only when the build has a DSN (docs/deploy.md). Nothing that can carry
// Memory content leaves the browser: no bodies, headers, cookies, query strings
// (search queries describe Memories), user info, or breadcrumb text.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment:
      (import.meta.env.VITE_SPARK_ENV as string | undefined) ?? "local",
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeBreadcrumb: ({ message: _message, data: _data, ...crumb }) => crumb,
    beforeSend: (event) => {
      delete event.user;
      delete event.extra;
      const url = event.request?.url?.split(/[?#]/)[0];
      if (url) event.request = { url };
      else delete event.request;
      return event;
    },
  });
}

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
