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
import { redirectIfSignedIn, requireSession } from "./auth";
import { AdminPage } from "./admin/admin-page";
import { LibraryPage } from "./library/library-page";
import { SignInPage } from "./sign-in/sign-in-page";
import { LibraryPage as PrototypeLibraryPage } from "./prototypes/library";
import { DATA_SETS, type DataSet } from "./prototypes/use-library";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
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
  component: function Admin() {
    const { session } = adminRoute.useRouteContext();
    return <AdminPage session={session} />;
  },
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: (search: Record<string, unknown>): { failed?: 1 } =>
    search.failed ? { failed: 1 } : {},
  beforeLoad: redirectIfSignedIn,
  loader: async () => {
    const res = await api.api["sign-in-options"].$get();
    if (!res.ok) throw new Error(`sign-in options: ${res.status}`);
    return res.json();
  },
  component: function SignIn() {
    const options = signInRoute.useLoaderData();
    const { failed } = signInRoute.useSearch();
    return <SignInPage options={options} failed={failed === 1} />;
  },
});

// Reference only: the chosen design direction on fake data (DESIGN.md →
// Pick). Everything under prototypes/ is deleted once the real Library lands.
// ?data=library|empty|huge switches the break-ui states.
const prototypesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prototypes",
  validateSearch: (search: Record<string, unknown>): { data: DataSet } => ({
    data: DATA_SETS.find((d) => d === search.data) ?? "library",
  }),
  component: function PrototypesPage() {
    const { data } = prototypesRoute.useSearch();
    return <PrototypeLibraryPage key={data} data={data} />;
  },
});

export const router = createRouter({
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
    adminRoute,
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
