import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { HomePage } from "./home-page";
import { LibraryPage } from "./prototypes/library";
import { DATA_SETS, type DataSet } from "./prototypes/use-library";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
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
    return <LibraryPage key={data} data={data} />;
  },
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, prototypesRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
