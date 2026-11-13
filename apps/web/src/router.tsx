import { signInReturnTo } from "./sign-in/return-to";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Button } from "@spark/ui";
import { api } from "./api";
import { currentSession, requireSession } from "./auth";
import { LibraryPage } from "./library/library-page";
import { isShareRefusal } from "./pwa/refusal";
import { ShareRefused } from "./pwa/share-refused";
import type { ShareRefusal } from "./pwa/validate";
import { DATA_SETS, type DataSet } from "./prototypes/data-sets";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/share",
  validateSearch: (
    search: Record<string, unknown>
  ): { refused?: ShareRefusal } =>
    isShareRefusal(search.refused) ? { refused: search.refused } : {},
  beforeLoad: ({ search }) => {
    if (!search.refused) throw redirect({ to: "/" });
  },
  component: function Share() {
    const { refused } = shareRoute.useSearch();
    return refused ? <ShareRefused reason={refused} /> : null;
  },
});

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (
    search: Record<string, unknown>
  ): { desk?: "capture" | "search" } =>
    search.desk === "capture" || search.desk === "search"
      ? { desk: search.desk }
      : {},
  beforeLoad: () => requireSession(),
  component: function Library() {
    const { session, admin } = libraryRoute.useRouteContext();
    return <LibraryPage session={session} admin={admin} />;
  },
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  beforeLoad: async () => {
    const { session, admin } = await requireSession({ freshAdmin: true });
    if (!admin) throw redirect({ to: "/" });
    return { session };
  },
}).lazy(() => import("./admin/route").then((m) => m.Route));

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  beforeLoad: () => requireSession(),
}).lazy(() => import("./settings/route").then((m) => m.Route));

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: (
    search: Record<string, unknown>
  ): { failed?: 1; returnTo?: string } => ({
    ...(search.failed ? { failed: 1 as const } : {}),
    ...(signInReturnTo(search.returnTo) && {
      returnTo: signInReturnTo(search.returnTo),
    }),
  }),
  beforeLoad: async ({ search }) => {
    if (await currentSession())
      throw redirect({ href: search.returnTo ?? "/" });
  },
  loader: async () => {
    const res = await api.api["sign-in-options"].$get();
    if (!res.ok) throw new Error(`sign-in options: ${res.status}`);
    return res.json();
  },
}).lazy(() => import("./sign-in/route").then((m) => m.Route));

// Reference only: the chosen design direction on fake data (DESIGN.md →
// Pick). Everything under prototypes/ is deleted once the real Library lands.
// ?data=library|empty|huge switches the break-ui states.
const prototypesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prototypes",
  validateSearch: (search: Record<string, unknown>): { data: DataSet } => ({
    data: DATA_SETS.find((d) => d === search.data) ?? "library",
  }),
}).lazy(() => import("./prototypes/route").then((m) => m.Route));

export const router = createRouter({
  // Slow chunk loads wait 1s, then a blank canvas: no spinner for a fast
  // click from the Library (DESIGN.md → no flashing chrome).
  defaultPendingMs: 1000,
  defaultPendingMinMs: 0,
  defaultPendingComponent: () => <div className="min-h-dvh bg-canvas" />,
  defaultErrorComponent: ({ error, reset }) => (
    <Notice
      title={
        error instanceof TypeError
          ? "Spark Is Unreachable"
          : "Something Went Wrong"
      }
    >
      <Button
        variant="outline"
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        Try Again
      </Button>
    </Notice>
  ),
  defaultNotFoundComponent: () => (
    <Notice title="Page Not Found">
      <Button variant="outline" asChild>
        <Link to="/">Go to Library</Link>
      </Button>
    </Notice>
  ),
  routeTree: rootRoute.addChildren([
    libraryRoute,
    shareRoute,
    adminRoute,
    settingsRoute,
    signInRoute,
    prototypesRoute,
  ]),
});

/** A whole-screen message with one way forward. */
function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-4">
      <div className="flex flex-col items-center gap-4">
        <h1 className="font-display text-lg font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
